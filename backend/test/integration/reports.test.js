// Checks the numbers in the five reports against the TRANSACTION table, read-only, as mims_app. Owner: Archchu.

// Run with: npm run test:db  (MySQL running, database loaded, mims_app created). It only reads; it never changes data.

//verifies that the values returned by the database reports match the actual transaction and account data.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { loadConfig } from '../../src/config.js';
import { callRows, closePool, initPool, query } from '../../src/db.js';

// Money arrives as text such as '1234.56'. It is compared in whole cents (BigInt), so no rounding can hide a difference.
function cents(value) {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new Error(`Not a money value: ${value}`);
  const [, sign, whole, fraction = ''] = match;
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return sign ? -amount : amount;
}
const total = (rows, key) => rows.reduce((sum, row) => sum + cents(row[key]), 0n);
const count = (rows, key) => rows.reduce((sum, row) => sum + Number(row[key]), 0);

before(() => initPool(loadConfig().db));
after(() => closePool());

// The periods a date-range report is checked for: all days with matching transactions, then the first, the last and the
// busiest single day, so a report that loses the first or last day of its range is caught.
const DAY_QUERIES = {
  agent: [
    'SELECT MIN(DATE(txn_timestamp)) AS first, MAX(DATE(txn_timestamp)) AS last FROM `TRANSACTION` WHERE processed_by_agent_id IS NOT NULL',
    'SELECT DATE(txn_timestamp) AS day FROM `TRANSACTION` WHERE processed_by_agent_id IS NOT NULL GROUP BY day ORDER BY COUNT(*) DESC, day LIMIT 1',
  ],
  cash: [
    "SELECT MIN(DATE(txn_timestamp)) AS first, MAX(DATE(txn_timestamp)) AS last FROM `TRANSACTION` WHERE transaction_type IN ('DEPOSIT','WITHDRAWAL')",
    "SELECT DATE(txn_timestamp) AS day FROM `TRANSACTION` WHERE transaction_type IN ('DEPOSIT','WITHDRAWAL') GROUP BY day ORDER BY COUNT(*) DESC, day LIMIT 1",
  ],
};
async function testDays(kind) {
  const [[ends], [busiest]] = await Promise.all(DAY_QUERIES[kind].map((sql) => query(sql)));
  return [[ends.first, ends.last], [ends.first, ends.first], [ends.last, ends.last], [busiest.day, busiest.day]];
}

test('account-wise: one row per account, showing the stored balance', async () => {
  const rows = await callRows('RPT_ACCOUNT_WISE_SUMMARY', [null]);
  const accounts = await query('SELECT account_no, balance FROM SAVINGS_ACCOUNT');
  assert.equal(rows.length, accounts.length);
  const stored = new Map(accounts.map((a) => [a.account_no, a.balance]));
  for (const row of rows) assert.equal(cents(row.current_balance), cents(stored.get(row.account_no)), row.account_no);
});

test('account-wise: deposits - withdrawals + interest + FD money in - FD money out = balance, for every account', async () => {
  const rows = await callRows('RPT_ACCOUNT_WISE_SUMMARY', [null]);
  const fdMoney = await query(
    `SELECT sa.account_no,
            COALESCE(SUM(CASE WHEN t.transaction_type = 'FD_CLOSURE' THEN t.amount END), 0) AS fd_in,
            COALESCE(SUM(CASE WHEN t.transaction_type = 'FD_OPEN' THEN t.amount END), 0) AS fd_out
     FROM SAVINGS_ACCOUNT sa LEFT JOIN \`TRANSACTION\` t ON t.account_id = sa.account_id
     GROUP BY sa.account_no`,
  );
  const fd = new Map(fdMoney.map((r) => [r.account_no, cents(r.fd_in) - cents(r.fd_out)]));
  for (const row of rows) {
    const explained =
      cents(row.total_deposits) - cents(row.total_withdrawals) + cents(row.total_interest_credited) + fd.get(row.account_no);
    assert.equal(explained, cents(row.current_balance), row.account_no);
  }
});

test('account-wise: the branch filter splits the accounts with nothing lost or repeated', async () => {
  const all = await callRows('RPT_ACCOUNT_WISE_SUMMARY', [null]);
  const branches = await query('SELECT branch_id FROM BRANCH');
  const seen = [];
  for (const { branch_id: branchId } of branches) {
    for (const row of await callRows('RPT_ACCOUNT_WISE_SUMMARY', [branchId])) seen.push(row.account_no);
  }
  assert.deepEqual([...seen].sort(), all.map((row) => row.account_no).sort());
});

test('agent-wise: each agent\'s count and total equal its transactions (whole period, first, last and busiest day)', async () => {
  const days = await testDays('agent');
  const agents = await query('SELECT agent_id FROM AGENT');
  for (const [start, end] of days) {
    const rows = await callRows('RPT_AGENT_WISE_TRANSACTIONS', [start, end]);
    const ledger = await query(
      `SELECT processed_by_agent_id AS agent_id, COUNT(*) AS n, SUM(amount) AS value FROM \`TRANSACTION\`
       WHERE processed_by_agent_id IS NOT NULL AND DATE(txn_timestamp) BETWEEN ? AND ?
       GROUP BY processed_by_agent_id`,
      [start, end],
    );
    const expected = new Map(ledger.map((r) => [r.agent_id, r]));
    assert.equal(rows.length, agents.length, `every agent is listed for ${start}..${end}`);
    for (const row of rows) {
      const want = expected.get(row.agent_id);
      assert.equal(Number(row.total_transactions), want ? Number(want.n) : 0, `agent ${row.agent_id}, ${start}..${end}`);
      assert.equal(cents(row.total_value), want ? cents(want.value) : 0n, `agent ${row.agent_id}, ${start}..${end}`);
    }
  }
});

test('agent-wise: a day with no transactions shows every agent at zero', async () => {
  const rows = await callRows('RPT_AGENT_WISE_TRANSACTIONS', ['2000-01-01', '2000-01-01']);
  assert.ok(rows.length > 0);
  assert.equal(count(rows, 'total_transactions'), 0);
  assert.equal(total(rows, 'total_value'), 0n);
});

test('monthly interest: each month adds up to the interest transactions of that month', async () => {
  const months = await query(
    `SELECT YEAR(txn_timestamp) AS y, MONTH(txn_timestamp) AS m, SUM(amount) AS paid, COUNT(DISTINCT account_id) AS accounts
     FROM \`TRANSACTION\` WHERE transaction_type IN ('SAVINGS_INTEREST','FD_INTEREST') GROUP BY y, m`,
  );
  assert.ok(months.length > 0, 'the sample data has interest postings');
  for (const month of months) {
    const rows = await callRows('RPT_MONTHLY_INTEREST_DISTRIBUTION', [month.y, month.m]);
    assert.equal(total(rows, 'total_interest_paid'), cents(month.paid), `${month.y}-${month.m}`);
    assert.equal(count(rows, 'accounts_credited'), Number(month.accounts), `${month.y}-${month.m}`);
  }
});

test('monthly interest agrees with the account-wise report over all months', async () => {
  const months = await query(
    `SELECT DISTINCT YEAR(txn_timestamp) AS y, MONTH(txn_timestamp) AS m
     FROM \`TRANSACTION\` WHERE transaction_type IN ('SAVINGS_INTEREST','FD_INTEREST')`,
  );
  let monthly = 0n;
  for (const month of months) monthly += total(await callRows('RPT_MONTHLY_INTEREST_DISTRIBUTION', [month.y, month.m]), 'total_interest_paid');
  const accountWise = total(await callRows('RPT_ACCOUNT_WISE_SUMMARY', [null]), 'total_interest_credited');
  assert.equal(monthly, accountWise);
});

test('customer activity: each holder is credited with the deposits and withdrawals (whole period, first, last and busiest day)', async () => {
  for (const [start, end] of await testDays('cash')) {
    const rows = await callRows('RPT_CUSTOMER_ACTIVITY', [start, end]);
    for (const row of rows) {
      assert.equal(cents(row.total_deposits) - cents(row.total_withdrawals), cents(row.net_balance_change), String(row.customer_id));
    }
    // A joint account's money counts once for each of its holders.
    const [ledger] = await query(
      `SELECT COALESCE(SUM(CASE WHEN t.transaction_type = 'DEPOSIT' THEN t.amount * h.holders END), 0) AS deposits,
              COALESCE(SUM(CASE WHEN t.transaction_type = 'WITHDRAWAL' THEN t.amount * h.holders END), 0) AS withdrawals
       FROM \`TRANSACTION\` t
       JOIN (SELECT account_id, COUNT(*) AS holders FROM ACCOUNT_HOLDER GROUP BY account_id) h ON h.account_id = t.account_id
       WHERE DATE(t.txn_timestamp) BETWEEN ? AND ?`,
      [start, end],
    );
    assert.equal(total(rows, 'total_deposits'), cents(ledger.deposits), `${start}..${end}`);
    assert.equal(total(rows, 'total_withdrawals'), cents(ledger.withdrawals), `${start}..${end}`);
  }
});

test('active FDs: the payout schedule lists every ACTIVE FD once, with its principal', async () => {
  const rows = await query('SELECT fd_id, principal FROM VW_ACTIVE_FD_PAYOUT_SCHEDULE');
  const active = await query("SELECT fd_id, amount FROM FIXED_DEPOSIT WHERE status = 'ACTIVE'");
  assert.deepEqual(rows.map((r) => r.fd_id).sort((a, b) => a - b), active.map((r) => r.fd_id).sort((a, b) => a - b));
  assert.equal(total(rows, 'principal'), total(active, 'amount'));
});

test('every stored balance equals its transaction history (the reports rely on it)', async () => {
  const [off] = await query(
    `SELECT COUNT(*) AS n FROM SAVINGS_ACCOUNT sa
     WHERE sa.balance <> (SELECT COALESCE(SUM(CASE WHEN t.transaction_type IN ('DEPOSIT','SAVINGS_INTEREST','FD_INTEREST','FD_CLOSURE') THEN t.amount ELSE -t.amount END), 0)
                          FROM \`TRANSACTION\` t WHERE t.account_id = sa.account_id)`,
  );
  assert.equal(Number(off.n), 0);
});
