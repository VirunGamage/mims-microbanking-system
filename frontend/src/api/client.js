// The one place the pages talk to the backend. Every call goes through request(), which turns failures into readable
// messages and, in Tester view, asks the server for debug details and keeps the last exchange for the RequestPanel.
// Calls whatever /api/... path a page asks for; the slice files in src/api/ build on api.get/api.post.
// The only place the pages talk to the backend: every call goes through request(), which turns failures into readable messages and, in Tester view, keeps the last request and answer for the request panel.

export class ApiError extends Error {
  constructor(message, { status = 0, field = null, debug = null, unreachable = false } = {}) {
    super(message);
    this.status = status;
    this.field = field;
    this.debug = debug;
    this.unreachable = unreachable; // true when the backend or the database could not be reached at all
  }
}

const SERVER_DOWN = 'Cannot reach the MIMS server. Is the backend running? (in the backend folder: npm run dev)';

let testerMode = false;
let lastExchange = null;
const listeners = new Set();

export function setTesterMode(on) {
  testerMode = Boolean(on);
}

export function getLastExchange() {
  return lastExchange;
}

// The RequestPanel subscribes here; the function returned unsubscribes.
export function onExchange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function remember(exchange) {
  lastExchange = exchange;
  listeners.forEach((listener) => listener(exchange));
}

// Only actions are remembered by default (form submits); background reads such as the status check every minute
// would otherwise push the interesting request out of the panel. A page can pass { record: true } for a read.
async function request(method, path, body, { record = method !== 'GET' } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (testerMode) headers['X-Debug'] = '1';
  const sent = { method, path: `/api${path}`, body: body ?? null };

  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    if (record) remember({ sent, status: 0, error: SERVER_DOWN });
    throw new ApiError(SERVER_DOWN, { unreachable: true });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null; // not JSON: usually the dev server answering because the backend is stopped
  }

  if (!response.ok || !payload || !('data' in payload)) {
    const message = payload?.error ?? (response.status >= 500 || !payload ? SERVER_DOWN : `The server answered ${response.status}`);
    const debug = payload?.debug ?? null;
    // 503 is the backend saying the database is down; no JSON at all means the backend itself is not answering.
    const unreachable = response.status === 503 || !payload;
    if (record) remember({ sent, status: response.status, error: message, debug });
    throw new ApiError(message, { status: response.status, field: payload?.field ?? null, debug, unreachable });
  }

  if (record) remember({ sent, status: response.status, data: payload.data, debug: payload.debug ?? null });
  return payload.data;
}

export const api = {
  get: (path, options) => request('GET', path, undefined, options),
  post: (path, body = {}, options) => request('POST', path, body, options),
};

// True when the database refused because of the Mon-Fri business-hours rule, so pages can say it is a rule, not a fault.
export function isBusinessHoursError(error) {
  return /business hours/i.test(error?.message ?? String(error ?? ''));
}
