// Turns any error into a short plain-language JSON answer: the browser never sees SQL text, error numbers or stack traces.
// Owner: Virun. Used by app.js (errorHandler, notFound), server.js (startupProblem) and validate.js (HttpError).
// Turns database and server errors into short plain-language answers for the app, so a raw SQL error is never sent to the user.

export class HttpError extends Error {
  constructor(status, message, field) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

const DATABASE_DOWN = 'The database is not reachable; check that MySQL is running and the .env settings';

const CONNECTION_PROBLEMS = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ECONNRESET',
  'PROTOCOL_CONNECTION_LOST',
  'ER_ACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
  'ER_DBACCESS_DENIED_ERROR',
  'ER_CON_COUNT_ERROR',
]);

// Clearer words for the constraints a user can actually run into. The constraint names come from sql/mims_schema.sql.
const DUPLICATE = { uq_customer_nic: 'A customer with this NIC is already registered' };
const MISSING_REFERENCE = {
  fk_txn_agent: 'That agent does not exist',
  fk_customer_registering_agent: 'That agent does not exist',
  fk_customer_registered_branch: 'That branch does not exist',
  fk_txn_account: 'That account does not exist',
  fk_holder_customer: 'That customer does not exist',
  fk_fd_plan: 'That fixed deposit plan does not exist',
};
const BROKEN_CHECK = { chk_customer_dob_floor: 'Date of birth must be on or after 1900-01-01' };

function pick(messages, sqlMessage, fallback) {
  const key = Object.keys(messages).find((name) => sqlMessage?.includes(name));
  return key ? messages[key] : fallback;
}

export function mapError(err) {
  if (err instanceof HttpError) return { status: err.status, message: err.message, field: err.field };
  if (err?.type === 'entity.parse.failed') return { status: 400, message: 'The request body is not valid JSON' };
  if (err?.type === 'entity.too.large') return { status: 413, message: 'The request is too large' };
  // SQLSTATE 45000 is a SIGNAL from one of our procedures or triggers: its text was written for people to read.
  if (err?.sqlState === '45000') return { status: 422, message: err.sqlMessage };
  if (CONNECTION_PROBLEMS.has(err?.code)) return { status: 503, message: DATABASE_DOWN };
  switch (err?.errno) {
    case 1062:
      return { status: 409, message: pick(DUPLICATE, err.sqlMessage, 'That value is already used by another record') };
    case 1452:
      return { status: 400, message: pick(MISSING_REFERENCE, err.sqlMessage, 'A referenced record does not exist') };
    case 1451:
      return { status: 409, message: 'This record is still used by other records, so it cannot be changed' };
    case 3819:
      return { status: 422, message: pick(BROKEN_CHECK, err.sqlMessage, 'The values break one of the database rules') };
    case 1406:
      return { status: 400, message: 'One of the values is too long' };
    case 1264:
      return { status: 400, message: 'One of the numbers is too large' };
    case 1292:
    case 1366:
      return { status: 400, message: 'One of the values is in the wrong format' };
    default:
      return { status: 500, message: 'Something went wrong on the server. The details were written to the server log.' };
  }
}

// Used by the route files around a procedure call: a rule message (SQLSTATE 45000) that is about one form field gets
// that field's name, so the page can show it beside the field. Any other error is returned unchanged.
export function ruleError(err, fieldsByMessage = []) {
  if (err?.sqlState !== '45000') return err;
  const match = fieldsByMessage.find(([pattern]) => pattern.test(err.sqlMessage));
  return new HttpError(422, err.sqlMessage, match?.[1]);
}

export function notFound(req, res) {
  res.status(404).json({ error: `There is no API endpoint ${req.method} ${req.originalUrl}` });
}

// Express recognises an error handler by its four parameters, so "next" has to stay even though it is rarely used.
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const { status, message, field } = mapError(err);
  const when = `[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`;
  if (status === 503) console.error(`${when}: database not reachable (${err.code})`); // one line, not a stack trace
  else if (status >= 500) console.error(when, err);
  const body = { error: message };
  if (field) body.field = field;
  if (req.get('X-Debug') === '1' && res.locals.debug) body.debug = res.locals.debug;
  res.status(status).json(body);
}

// Explains, in plain words, why the server could not start, and what to do about it.
export function startupProblem(err, config) {
  const where = config ? `${config.db.host}:${config.db.port}` : 'the configured host';
  switch (err?.code) {
    case 'ECONNREFUSED':
    case 'ETIMEDOUT':
    case 'EHOSTUNREACH':
    case 'ENOTFOUND':
      return [
        `Cannot reach MySQL at ${where}.`,
        '  1. Is MySQL running? On Windows: open Services, find MySQL80, click Start.',
        '  2. Are DB_HOST and DB_PORT in backend/.env right? (normally 127.0.0.1 and 3306)',
      ].join('\n');
    case 'ER_ACCESS_DENIED_ERROR':
      return [
        `MySQL refused the user "${config?.db.user}" with that password.`,
        '  1. Check DB_USER and DB_PASSWORD in backend/.env.',
        '  2. If you are not sure of the password, set it again: log in as root, run',
        "     SET @app_password = 'your-password';  then  SOURCE scripts/create_app_user.sql;",
      ].join('\n');
    case 'ER_BAD_DB_ERROR':
      return [
        `The database "${config?.db.database}" does not exist yet.`,
        '  Load it from the repository root:  mysql -u root -p < scripts/load_all.sql',
      ].join('\n');
    case 'ER_DBACCESS_DENIED_ERROR':
      return [
        `The user "${config?.db.user}" may not use the database "${config?.db.database}".`,
        '  1. Check DB_NAME in backend/.env (it should be mims).',
        '  2. If it is right, log in as root and run scripts/create_app_user.sql again.',
      ].join('\n');
    case 'EADDRINUSE':
      return [
        `Port ${config?.port} is already in use.`,
        '  Another backend window is probably still running: close it (Ctrl + C), then start this one again.',
        '  Keep PORT=3001 in backend/.env: the frontend sends every /api request to that port.',
      ].join('\n');
    default:
      return `Unexpected problem while starting: ${err?.message ?? err}`;
  }
}
