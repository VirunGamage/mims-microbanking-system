// Tests the login used on the cloud server (backend/src/auth.js): nothing gets through without the right username and
// password, except the health check. Run with: npm test  (no database needed)
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { loginFromEnv } from '../src/auth.js';

let server;
let base;
const basic = (user, password) => ({ Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` });

before(async () => {
  const app = await createApp({ log: () => {}, login: { username: 'examiner', password: 'b-trust-2026' } });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('without a login the browser is asked for one', async () => {
  const response = await fetch(`${base}/api/customers`);
  assert.equal(response.status, 401);
  assert.match(response.headers.get('www-authenticate'), /^Basic realm="B-Trust MIMS"/);
  assert.deepEqual(await response.json(), { error: 'Please sign in with the MIMS username and password' });
});

test('a wrong password or a wrong username is refused', async () => {
  assert.equal((await fetch(`${base}/api/customers`, { headers: basic('examiner', 'b-trust-2025') })).status, 401);
  assert.equal((await fetch(`${base}/api/customers`, { headers: basic('someone', 'b-trust-2026') })).status, 401);
  assert.equal((await fetch(`${base}/api/customers`, { headers: { Authorization: 'Basic not-base64!' } })).status, 401);
});

test('the right login gets through to the app', async () => {
  // No such endpoint, so the app itself answers 404: the login let the request in
  const response = await fetch(`${base}/api/no-such-thing`, { headers: basic('examiner', 'b-trust-2026') });
  assert.equal(response.status, 404);
});

test('the health check needs no login, so Docker can still check the app', async () => {
  const logged = console.error;
  console.error = () => {}; // no database in this test, so health answers 500; only "not 401" matters here
  try {
    assert.notEqual((await fetch(`${base}/api/health`)).status, 401);
  } finally {
    console.error = logged;
  }
});

test('the login comes from APP_USERNAME and APP_PASSWORD: both or neither, and a real password', () => {
  assert.equal(loginFromEnv({}), null);
  assert.deepEqual(loginFromEnv({ APP_USERNAME: ' examiner ', APP_PASSWORD: 'b-trust-2026' }),
    { username: 'examiner', password: 'b-trust-2026' });
  assert.throws(() => loginFromEnv({ APP_USERNAME: 'examiner' }), /both APP_USERNAME and APP_PASSWORD/);
  assert.throws(() => loginFromEnv({ APP_PASSWORD: 'b-trust-2026' }), /both APP_USERNAME and APP_PASSWORD/);
  assert.throws(() => loginFromEnv({ APP_USERNAME: 'examiner', APP_PASSWORD: 'short' }), /at least 8/);
});
