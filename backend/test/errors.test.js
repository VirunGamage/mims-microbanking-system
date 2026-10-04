// Unit tests for errors.js: every kind of error must become the right status and a plain message. Owner: Virun.
// Run with: npm test  (no database needed)
// Tests that database and server errors become short plain-language answers with the right status code, and that raw SQL text never reaches the user.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorHandler, HttpError, mapError, ruleError, startupProblem } from '../src/errors.js';

// Shaped like the errors mysql2 throws, so no database is needed.
function sqlError(errno, sqlState, sqlMessage, code) {
  return Object.assign(new Error(sqlMessage), { errno, sqlState, sqlMessage, code });
}

test('a business rule (SQLSTATE 45000) becomes 422 with the procedure message', () => {
  const err = sqlError(1644, '45000', 'Withdrawal would take the balance below the plan minimum', 'ER_SIGNAL_EXCEPTION');
  assert.deepEqual(mapError(err), { status: 422, message: 'Withdrawal would take the balance below the plan minimum' });
});

test('a duplicate NIC becomes 409 with a clear sentence', () => {
  const err = sqlError(1062, '23000', "Duplicate entry '199210300100' for key 'CUSTOMER.uq_customer_nic'", 'ER_DUP_ENTRY');
  assert.deepEqual(mapError(err), { status: 409, message: 'A customer with this NIC is already registered' });
});

test('any other duplicate becomes a generic 409', () => {
  const err = sqlError(1062, '23000', "Duplicate entry 'x' for key 'OTHER.uq_other'", 'ER_DUP_ENTRY');
  assert.equal(mapError(err).status, 409);
});

test('an unknown agent (foreign key) becomes 400 naming the agent', () => {
  const err = sqlError(1452, '23000', 'Cannot add or update a child row: ... CONSTRAINT `fk_txn_agent` FOREIGN KEY ...', 'ER_NO_REFERENCED_ROW_2');
  assert.deepEqual(mapError(err), { status: 400, message: 'That agent does not exist' });
});

test('a broken CHECK constraint becomes 422 without SQL text', () => {
  const err = sqlError(3819, 'HY000', "Check constraint 'chk_something' is violated.", 'ER_CHECK_CONSTRAINT_VIOLATED');
  const mapped = mapError(err);
  assert.equal(mapped.status, 422);
  assert.ok(!mapped.message.includes('chk_'));
});

test('MySQL being down or refusing the login becomes 503', () => {
  for (const code of ['ECONNREFUSED', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'PROTOCOL_CONNECTION_LOST']) {
    const mapped = mapError(Object.assign(new Error('x'), { code }));
    assert.equal(mapped.status, 503, code);
    assert.match(mapped.message, /not reachable/);
  }
});

test('invalid JSON from the browser becomes 400', () => {
  assert.equal(mapError({ type: 'entity.parse.failed' }).status, 400);
});

test('an HttpError keeps its own status, message and field', () => {
  assert.deepEqual(mapError(new HttpError(404, 'Account not found', 'accountId')), {
    status: 404,
    message: 'Account not found',
    field: 'accountId',
  });
});

test('anything unexpected becomes a generic 500 that hides the details', () => {
  const mapped = mapError(sqlError(1146, '42S02', "Table 'mims.NOPE' doesn't exist", 'ER_NO_SUCH_TABLE'));
  assert.equal(mapped.status, 500);
  assert.ok(!mapped.message.includes('NOPE'));
});

test('the error handler sends JSON, and adds debug only when X-Debug is 1', () => {
  const makeRes = () => ({
    headersSent: false,
    locals: { debug: { procedure: 'PROC_PROCESS_DEPOSIT', params: [1, '10.00'] } },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  });
  const err = sqlError(1644, '45000', 'Account is not active');
  const quiet = makeRes();
  errorHandler(err, { get: () => undefined }, quiet, () => {});
  assert.deepEqual(quiet.body, { error: 'Account is not active' });
  assert.equal(quiet.code, 422);
  const tester = makeRes();
  errorHandler(err, { get: (name) => (name === 'X-Debug' ? '1' : undefined) }, tester, () => {});
  assert.equal(tester.body.debug.procedure, 'PROC_PROCESS_DEPOSIT');
});

test('startup problems are explained with the fix', () => {
  const config = { port: 3001, db: { host: '127.0.0.1', port: 3306, user: 'mims_app', database: 'mims' } };
  assert.match(startupProblem({ code: 'ECONNREFUSED' }, config), /Is MySQL running/);
  assert.match(startupProblem({ code: 'ER_ACCESS_DENIED_ERROR' }, config), /create_app_user\.sql/);
  assert.match(startupProblem({ code: 'ER_BAD_DB_ERROR' }, config), /load_all\.sql/);
  assert.match(startupProblem({ code: 'EADDRINUSE' }, config), /Port 3001 is already in use/);
});

test('ruleError puts a rule message beside its form field and leaves other errors alone', () => {
  const fields = [[/^Opening deposit/, 'openingAmount']];
  const below = ruleError(sqlError(1644, '45000', 'Opening deposit is below the plan minimum balance'), fields);
  assert.ok(below instanceof HttpError);
  assert.deepEqual(mapError(below), { status: 422, message: 'Opening deposit is below the plan minimum balance', field: 'openingAmount' });
  const closed = ruleError(sqlError(1644, '45000', 'Transactions are only accepted Mon-Fri during business hours'), fields);
  assert.equal(closed.field, undefined);
  const other = sqlError(1452, '23000', 'fk_txn_agent');
  assert.equal(ruleError(other, fields), other);
});
