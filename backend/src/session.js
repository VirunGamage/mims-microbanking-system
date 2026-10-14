// Signing in to the web app as a customer (online banking), an agent (the branch screens) or an admin (the Tester view).
// The logins are in the APP_LOGIN table. A password is never stored or logged: APP_LOGIN keeps a salted scrypt hash.
// After signing in, the browser keeps a signed session cookie that says who signed in. It is HttpOnly (page scripts
// cannot read it) and SameSite=Lax (other websites cannot send it with a form or a fetch), and only this server can make
// one, because it is signed with SESSION_SECRET.
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Router } from 'express';
import { query } from './db.js';
import { HttpError } from './errors.js';
import { sendData } from './respond.js';
import { ValidationError, oneOf, requiredText } from './validate.js';

const scrypt = promisify(scryptCallback);

export const ROLES = ['CUSTOMER', 'AGENT', 'ADMIN'];
const COOKIE = 'mims_session';
const SESSION_HOURS = 8;
const KEY_LENGTH = 32;

// 'scrypt$N$r$p$salt$hash' (salt and hash in base64). The cost settings travel with each hash, so they can be raised
// later without breaking the passwords already stored.
export async function hashPassword(password, { N = 16384, r = 8, p = 1 } = {}) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, { N, r, p });
  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const [kind, N, r, p, salt, hash] = String(stored ?? '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(String(password), Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p),
  });
  return timingSafeEqual(key, expected);
}

// Checked against when the username does not exist, so a wrong username takes as long as a wrong password and the
// answer time does not tell anyone which usernames are real.
const UNKNOWN_USER_HASH = await hashPassword(randomBytes(16).toString('hex'));

// Without SESSION_SECRET a new random secret is made at every start: it works, but everyone has to sign in again
// after a restart. The cloud server sets one in .env (cloud.env.example).
export function sessionSecretFromEnv(env = process.env) {
  const secret = env.SESSION_SECRET ?? '';
  if (!secret) return randomBytes(32).toString('hex');
  if (secret.length < 16) throw new Error('SESSION_SECRET must be at least 16 characters.');
  return secret;
}

function mac(body, secret) {
  return createHmac('sha256', secret).update(body).digest();
}

export function makeToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${mac(body, secret).toString('base64url')}`;
}

// The session in a token, or null when the token is missing, changed by anyone, or out of date.
export function readToken(token, secret, now = Date.now()) {
  const [body, signature] = String(token ?? '').split('.');
  if (!body || !signature) return null;
  const given = Buffer.from(signature, 'base64url');
  const expected = mac(body, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number' || payload.exp <= now || !ROLES.includes(payload.role)) return null;
  return payload;
}

export function cookieValue(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const equals = part.indexOf('=');
    if (equals > 0 && part.slice(0, equals).trim() === name) return part.slice(equals + 1).trim();
  }
  return null;
}

// Secure (HTTPS only) when the request came over HTTPS, directly or through the Caddy web server on the cloud server.
function sessionCookie(req, token, maxAgeSeconds) {
  const secure = req.secure || req.get('X-Forwarded-Proto') === 'https';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

// Puts the signed-in user (or null) on req.user for every request.
export function sessionReader(secret) {
  return (req, res, next) => {
    req.user = readToken(cookieValue(req.get('Cookie'), COOKIE), secret);
    next();
  };
}

// Only the given roles get through: 401 when nobody is signed in, 403 when the login is of another kind.
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new HttpError(401, 'Please sign in first'));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, 'This part of MIMS is not open to your login'));
    next();
  };
}

// An agent always works as themselves: whatever agent a request names, the agent who signed in is used. An admin (the
// Tester view) can still act as any agent, as the "Acting as" list allows.
export function signedInAgent(req, res, next) {
  if (req.user?.role === 'AGENT' && req.method !== 'GET') {
    req.body = { ...(req.body && typeof req.body === 'object' ? req.body : {}), agentId: req.user.agentId };
  }
  next();
}

export async function findLoginInDatabase(username) {
  const [row] = await query(
    `SELECT l.login_id AS loginId, l.username, l.password_hash AS passwordHash, l.role,
            l.customer_id AS customerId, l.agent_id AS agentId,
            COALESCE(CONCAT(c.first_name, ' ', c.last_name), CONCAT(a.first_name, ' ', a.last_name), 'Bank administrator') AS name,
            a.status AS agentStatus, b.branch_name AS branchName
       FROM APP_LOGIN l
       LEFT JOIN CUSTOMER c ON c.customer_id = l.customer_id
       LEFT JOIN AGENT a ON a.agent_id = l.agent_id
       LEFT JOIN BRANCH b ON b.branch_id = a.branch_id
      WHERE l.username = ?`,
    [username],
  );
  return row ?? null;
}

const ROLE_WORDS = { CUSTOMER: 'a customer', AGENT: 'an agent', ADMIN: 'an admin' };

// POST /api/auth/login { username, password, role }   POST /api/auth/logout   GET /api/auth/me
// role is the tab the person signed in from; a login of another kind is refused with a clear message.
export function createAuthRouter({ secret, findLogin = findLoginInDatabase }) {
  const router = Router();

  router.post('/login', async (req, res) => {
    const body = req.body ?? {};
    const username = requiredText(body.username, 'username', 'Username', 50).toLowerCase();
    if (typeof body.password !== 'string' || body.password === '') {
      throw new ValidationError('password', 'Password is required');
    }
    const role = body.role ? oneOf(body.role, 'role', 'Sign in as', ROLES) : null;

    const login = await findLogin(username);
    const passwordOk = await verifyPassword(body.password, login?.passwordHash ?? UNKNOWN_USER_HASH);
    if (!login || !passwordOk) throw new HttpError(401, 'The username or password is not right');
    if (role && login.role !== role) {
      throw new HttpError(403, `This is ${ROLE_WORDS[login.role]} login. Choose the ${login.role.toLowerCase()} tab to sign in.`);
    }
    if (login.role === 'AGENT' && login.agentStatus !== 'ACTIVE') {
      throw new HttpError(403, `This agent is ${login.agentStatus}, so the login is switched off`);
    }

    const user = {
      loginId: login.loginId,
      username: login.username,
      role: login.role,
      name: login.name,
      customerId: login.customerId ?? null,
      agentId: login.agentId ?? null,
      branchName: login.branchName ?? null,
    };
    const token = makeToken({ ...user, exp: Date.now() + SESSION_HOURS * 3600_000 }, secret);
    res.set('Set-Cookie', sessionCookie(req, token, SESSION_HOURS * 3600));
    sendData(req, res, user);
  });

  router.post('/logout', (req, res) => {
    res.set('Set-Cookie', sessionCookie(req, '', 0));
    sendData(req, res, { signedOut: true });
  });

  // Who is signed in, or null. Not an error: the start page asks this before anyone has signed in.
  router.get('/me', (req, res) => {
    if (!req.user) return sendData(req, res, null);
    const { exp, ...user } = req.user;
    sendData(req, res, user);
  });

  return router;
}
