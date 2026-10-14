// Tests signing in (backend/src/session.js) and who may use which part of the API (routes/index.js).
// Run with: npm test  (no database needed: the logins come from a stand-in for the APP_LOGIN table)
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import {
  cookieValue, hashPassword, makeToken, readToken, sessionSecretFromEnv, signedInAgent, verifyPassword,
} from '../src/session.js';

const SECRET = 'a-test-secret-of-enough-length';
let server;
let base;
const logins = {};

before(async () => {
  const passwordHash = await hashPassword('demo1234');
  logins.james = { loginId: 4, username: 'james', passwordHash, role: 'CUSTOMER', customerId: 6, agentId: null, name: 'James Anderson' };
  logins.alice = { loginId: 2, username: 'alice', passwordHash, role: 'AGENT', customerId: null, agentId: 1, name: 'Alice Smith', agentStatus: 'ACTIVE', branchName: 'Central Branch' };
  logins.dave = { loginId: 8, username: 'dave', passwordHash, role: 'AGENT', customerId: null, agentId: 4, name: 'David Kim', agentStatus: 'ON_LEAVE' };
  logins.admin = { loginId: 1, username: 'admin', passwordHash, role: 'ADMIN', customerId: null, agentId: null, name: 'Bank administrator' };
  const app = await createApp({
    log: () => {},
    login: null,
    sessionSecret: SECRET,
    findLogin: async (username) => logins[username] ?? null,
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function signIn(body, headers = {}) {
  return fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function cookieFor(username) {
  const response = await signIn({ username, password: 'demo1234' });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

test('a password is stored only as a salted hash, and only the right password matches it', async () => {
  const one = await hashPassword('demo1234');
  const two = await hashPassword('demo1234');
  assert.match(one, /^scrypt\$16384\$8\$1\$/);
  assert.notEqual(one, two); // a new salt every time
  assert.doesNotMatch(one, /demo1234/);
  assert.equal(await verifyPassword('demo1234', one), true);
  assert.equal(await verifyPassword('demo12345', one), false);
  assert.equal(await verifyPassword('demo1234', 'not a hash'), false);
});

test('a session token cannot be changed, signed with another secret, or used after it runs out', () => {
  const token = makeToken({ role: 'CUSTOMER', customerId: 6, exp: Date.now() + 60_000 }, SECRET);
  assert.equal(readToken(token, SECRET).customerId, 6);
  const [body, signature] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ role: 'ADMIN', exp: Date.now() + 60_000 })).toString('base64url');
  assert.equal(readToken(`${forged}.${signature}`, SECRET), null);
  assert.equal(readToken(`${body}.${signature}x`, SECRET), null);
  assert.equal(readToken(token, 'another-secret-of-enough-length'), null);
  assert.equal(readToken(makeToken({ role: 'CUSTOMER', exp: Date.now() - 1 }, SECRET), SECRET), null);
  assert.equal(readToken('', SECRET), null);
});

test('the session cookie is found among the other cookies', () => {
  assert.equal(cookieValue('a=1; mims_session=abc.def; b=2', 'mims_session'), 'abc.def');
  assert.equal(cookieValue('a=1', 'mims_session'), null);
  assert.equal(cookieValue(undefined, 'mims_session'), null);
});

test('SESSION_SECRET is optional, but too short a secret is refused', () => {
  assert.equal(sessionSecretFromEnv({}).length, 64);
  assert.equal(sessionSecretFromEnv({ SESSION_SECRET: 'x'.repeat(16) }), 'x'.repeat(16));
  assert.throws(() => sessionSecretFromEnv({ SESSION_SECRET: 'short' }), /at least 16/);
});

test('signing in sets an HttpOnly, SameSite session cookie, and /api/auth/me then says who is signed in', async () => {
  const response = await signIn({ username: 'James', password: 'demo1234', role: 'CUSTOMER' });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /^mims_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=28800$/);
  const { data } = await response.json();
  assert.deepEqual(data, { loginId: 4, username: 'james', role: 'CUSTOMER', name: 'James Anderson', customerId: 6, agentId: null, branchName: null });
  assert.equal(JSON.stringify(data).includes('passwordHash'), false);

  const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie.split(';')[0] } });
  assert.equal((await me.json()).data.name, 'James Anderson');
  assert.deepEqual(await (await fetch(`${base}/api/auth/me`)).json(), { data: null });
});

test('over HTTPS (the cloud server) the cookie is marked Secure', async () => {
  const response = await signIn({ username: 'james', password: 'demo1234' }, { 'X-Forwarded-Proto': 'https' });
  assert.match(response.headers.get('set-cookie'), /; Secure$/);
});

test('a wrong password and an unknown username get the same answer', async () => {
  const wrong = await signIn({ username: 'james', password: 'demo12345' });
  const unknown = await signIn({ username: 'nobody', password: 'demo1234' });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(await wrong.json(), await unknown.json());
  assert.equal(wrong.headers.get('set-cookie'), null);
});

test('signing in from the wrong tab, or as an agent who is not ACTIVE, is refused with a reason', async () => {
  const tab = await signIn({ username: 'james', password: 'demo1234', role: 'AGENT' });
  assert.equal(tab.status, 403);
  assert.match((await tab.json()).error, /This is a customer login/);
  const away = await signIn({ username: 'dave', password: 'demo1234' });
  assert.equal(away.status, 403);
  assert.match((await away.json()).error, /ON_LEAVE/);
  const missing = await signIn({ username: 'james' });
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).field, 'password');
});

test('signing out clears the cookie', async () => {
  const response = await fetch(`${base}/api/auth/logout`, { method: 'POST' });
  assert.match(response.headers.get('set-cookie'), /^mims_session=; .*Max-Age=0/);
});

test('nobody signed in: only health, status, rates and sign-in are open', async () => {
  for (const path of ['/api/customers', '/api/accounts/1/transactions', '/api/reports/agent-wise', '/api/me/overview', '/api/lookups/fd-plans']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 401, path);
    assert.deepEqual(await response.json(), { error: 'Please sign in first' });
  }
});

test('each login reaches only its own part of the API', async () => {
  const customer = await cookieFor('james');
  const agent = await cookieFor('alice');
  const admin = await cookieFor('admin');
  const status = async (path, cookie) => (await fetch(`${base}${path}`, { headers: { Cookie: cookie } })).status;
  const quiet = console.error;
  console.error = () => {}; // a request that gets through reaches the (missing) database and is logged as a 500
  try {
    assert.equal(await status('/api/customers', customer), 403);
    assert.equal(await status('/api/fixed-deposits', customer), 403);
    assert.equal(await status('/api/tester/gap/nic-at-18', customer), 403);
    assert.equal(await status('/api/tester/gap/nic-at-18', agent), 403);
    assert.equal(await status('/api/me/overview', agent), 403);
    assert.equal(await status('/api/reports/active-fds', agent), 403);
    assert.equal(await status('/api/reports/active-fds', customer), 403);
    assert.equal(await status('/api/agent-reports/fds-due', customer), 403);
    assert.notEqual(await status('/api/agent-reports/fds-due', agent), 403);
    assert.notEqual(await status('/api/reports/active-fds', admin), 403);
    assert.equal(await status('/api/me/overview', admin), 403);
    assert.notEqual(await status('/api/me/overview', customer), 403);
    assert.notEqual(await status('/api/customers', agent), 403);
    assert.notEqual(await status('/api/tester/gap/nic-at-18', admin), 403);
  } finally {
    console.error = quiet;
  }
});

test('an agent always works as themselves; an admin can act as any agent', () => {
  const run = (user, method, body) => {
    const req = { user, method, body };
    signedInAgent(req, {}, () => {});
    return req.body;
  };
  assert.deepEqual(run({ role: 'AGENT', agentId: 3 }, 'POST', { amount: '10.00', agentId: 1 }), { amount: '10.00', agentId: 3 });
  assert.deepEqual(run({ role: 'AGENT', agentId: 3 }, 'POST', undefined), { agentId: 3 });
  assert.deepEqual(run({ role: 'ADMIN' }, 'POST', { agentId: 1 }), { agentId: 1 });
  assert.equal(run({ role: 'AGENT', agentId: 3 }, 'GET', undefined), undefined);
});
