// Signing in and out. The session itself is an HttpOnly cookie the browser sends by itself; pages never see it.
// Uses POST /api/auth/login, POST /api/auth/logout and GET /api/auth/me.
import { api } from './client.js';

// { username, password, role } -> the signed-in user. Never recorded for the request panel: the body holds a password.
export function signIn(body) {
  return api.post('/auth/login', body, { record: false });
}

export function signOut() {
  return api.post('/auth/logout', {}, { record: false });
}

// The signed-in user, or null
export function whoAmI() {
  return api.get('/auth/me');
}
