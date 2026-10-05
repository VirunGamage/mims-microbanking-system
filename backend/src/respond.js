// Sends a successful answer as { data }. When the Tester view asks for it (header X-Debug: 1) it also adds
// { debug } with the procedure name, its parameters and its OUT values. Owner: Virun. Used by every route file.
// Sends a successful answer as { data }, and when the Tester view asks with the X-Debug header it also adds which procedure was called, its parameters and its output values.

export function sendData(req, res, data, status = 200) {
  const body = { data };
  if (req.get('X-Debug') === '1' && res.locals.debug) body.debug = res.locals.debug;
  res.status(status).json(body);
}

// Routes call this before running a procedure, so the debug panel can show what was sent even if the call fails.
export function noteCall(res, procedure, params) {
  res.locals.debug = { procedure, params };
}

export function noteResult(res, out) {
  if (res.locals.debug) res.locals.debug.out = out;
}
