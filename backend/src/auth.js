// A login for a server that anyone on the internet can reach (docs/DEPLOYMENT.md). When APP_USERNAME and APP_PASSWORD
// are set, every page and every API call needs them (HTTP Basic authentication: the browser asks once, then sends them
// with each request). When they are not set nothing changes, as on a developer's computer.
// /api/health stays open so Docker's health check can still see that the app is up; it shows no customer data.
import { timingSafeEqual } from 'node:crypto';

export function loginFromEnv(env = process.env) {
  const username = env.APP_USERNAME?.trim() || '';
  const password = env.APP_PASSWORD || '';
  if (!username && !password) return null;
  if (!username || !password) {
    throw new Error('Set both APP_USERNAME and APP_PASSWORD, or neither, to protect the app with a login.');
  }
  if (password.length < 8) throw new Error('APP_PASSWORD must be at least 8 characters.');
  return { username, password };
}

// Compares in constant time, so how long the answer takes does not give away how much of the password was right
function same(given, expected) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function loginGate(login) {
  if (!login) return (req, res, next) => next();
  return (req, res, next) => {
    if (req.path === '/api/health') return next();
    const [scheme, encoded] = (req.get('Authorization') ?? '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const colon = decoded.indexOf(':');
      if (colon > 0) {
        const userOk = same(decoded.slice(0, colon), login.username);
        const passwordOk = same(decoded.slice(colon + 1), login.password);
        if (userOk && passwordOk) return next();
      }
    }
    res.set('WWW-Authenticate', 'Basic realm="B-Trust MIMS", charset="UTF-8"');
    res.status(401).json({ error: 'Please sign in with the MIMS username and password' });
  };
}
