// Integration test against the real database, using the mims_app settings in backend/.env. Owner: Virun.
// Run with: npm run test:db  (MySQL running, database loaded, mims_app created). It does not change any data.
// Checks the backend against the real database without changing any data: that it connects, the sample data is there, money comes back exact, business rules arrive as plain messages and mims_app cannot edit a balance.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { loadConfig } from '../../src/config.js';
import { callProc, callRows, checkConnection, closePool, initPool, query } from '../../src/db.js';
import { mapError } from '../../src/errors.js';

before(() => initPool(loadConfig().db));
after(() => closePool());

test('connects to the mims database', async () => {
  const info = await checkConnection();
  assert.equal(info.db, 'mims');
  assert.match(info.serverTime, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('sample data is loaded (3 branches, 5 agents, 13 accounts)', async () => {
  const [counts] = await query(
    'SELECT (SELECT COUNT(*) FROM BRANCH) AS branches, (SELECT COUNT(*) FROM AGENT) AS agents, (SELECT COUNT(*) FROM SAVINGS_ACCOUNT) AS accounts',
  );
  assert.ok(counts.branches >= 3 && counts.agents >= 5 && counts.accounts >= 13);
});

test('money comes back as exact strings, dates as text', async () => {
  const [row] = await query('SELECT balance, open_date FROM SAVINGS_ACCOUNT WHERE account_no = ?', ['SA0000001']);
  assert.equal(typeof row.balance, 'string');
  assert.match(row.balance, /^\d+\.\d{2}$/);
  assert.match(row.open_date, /^\d{4}-\d{2}-\d{2}$/);
});

test('OUT parameters are read back (an interest run for the year 2000 posts nothing)', async () => {
  const out = await callProc('PROC_RUN_FD_INTEREST', ['2000-01-01'], ['postings']);
  assert.equal(Number(out.postings), 0);
});

test('a report procedure returns rows without the status packet', async () => {
  const rows = await callRows('RPT_MONTHLY_INTEREST_DISTRIBUTION', [2026, 9]);
  assert.ok(Array.isArray(rows) && rows.length > 0);
  assert.ok('plan_name' in rows[0]);
});

test('a business rule arrives as SQLSTATE 45000 with a plain message', async () => {
  // The amount check runs before the business-hours check, so this fails the same way at any time of day.
  await assert.rejects(callProc('PROC_PROCESS_DEPOSIT', [1, '0.00', 'BRANCH', 1], ['ref', 'bal']), (err) => {
    assert.equal(err.sqlState, '45000');
    assert.deepEqual(mapError(err), { status: 422, message: 'Deposit amount must be greater than zero' });
    return true;
  });
});

test('mims_app cannot change a balance directly', async () => {
  await assert.rejects(query('UPDATE SAVINGS_ACCOUNT SET balance = balance WHERE account_id = 1'), (err) => {
    assert.equal(err.errno, 1142);
    return true;
  });
});

test('unsafe procedure names are refused before reaching MySQL', async () => {
  await assert.rejects(callProc('PROC_X; DROP TABLE CUSTOMER', []), /Refusing/);
});
