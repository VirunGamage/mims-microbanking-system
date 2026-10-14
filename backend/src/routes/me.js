// Online banking for a signed-in customer: their accounts, passbook, transfers and fixed deposits.
// Every request works on the customer in the session cookie, never on an id sent by the page, so a customer can only
// see and move their own money. Money moves through the same procedures as at the branch, on the ONLINE channel with no
// agent: PROC_TRANSFER, PROC_OPEN_FIXED_DEPOSIT and PROC_CLOSE_FIXED_DEPOSIT. The database checks every rule again.
import { Router } from 'express';
import { callProc, query } from '../db.js';
import { HttpError, ruleError } from '../errors.js';
import { notifications, sendInBackground } from '../notify.js';
import { noteCall, noteResult, sendData } from '../respond.js';
import { ValidationError, id, money } from '../validate.js';
import { FD_COLUMNS, FROM as FD_FROM, OPEN_FIELDS, findFd, shape } from './fixedDeposits.js';
import { pageNumber, readPassbook } from './transactions.js';

const router = Router();
const CHANNEL = 'ONLINE';
const ACCOUNT_NO = /^SA\d{7}$/;
const CREDIT_TYPES = "('DEPOSIT', 'SAVINGS_INTEREST', 'FD_INTEREST', 'FD_CLOSURE')";

// The accounts this customer holds, with what can still be taken out today: the balance above the plan minimum, and
// at most what is left of the daily withdrawal limit (money sent by transfer counts towards it too).
async function myAccounts(customerId) {
  return query(
    `SELECT sa.account_id AS accountId, sa.account_no AS accountNo, sa.status, sa.balance, sa.open_date AS openDate,
            h.role, sp.plan_name AS planName, sp.interest_rate AS interestRate, sp.minimum_balance AS minimumBalance,
            (SELECT COALESCE(SUM(t.amount), 0) FROM \`TRANSACTION\` t
              WHERE t.account_id = sa.account_id AND t.transaction_type = 'WITHDRAWAL'
                AND t.txn_timestamp >= CURDATE() AND t.txn_timestamp < CURDATE() + INTERVAL 1 DAY) AS withdrawnToday,
            (SELECT GROUP_CONCAT(CONCAT(c.first_name, ' ', c.last_name, ' (', LOWER(o.role), ')') ORDER BY o.role SEPARATOR ', ')
               FROM ACCOUNT_HOLDER o JOIN CUSTOMER c ON c.customer_id = o.customer_id
              WHERE o.account_id = sa.account_id AND o.customer_id <> h.customer_id) AS otherHolders
       FROM ACCOUNT_HOLDER h
       JOIN SAVINGS_ACCOUNT sa ON sa.account_id = h.account_id
       JOIN SAVINGS_PLAN sp ON sp.plan_id = sa.plan_id
      WHERE h.customer_id = ?
      ORDER BY sa.account_id`,
    [customerId],
  );
}

async function myAccount(customerId, accountId) {
  const [row] = await query('SELECT role FROM ACCOUNT_HOLDER WHERE customer_id = ? AND account_id = ?', [customerId, accountId]);
  if (!row) throw new HttpError(404, `You have no account with ID ${accountId}`);
  return row;
}

// GET /api/me/overview: profile, accounts, fixed deposits, the last transactions and the limits that apply
router.get('/overview', async (req, res) => {
  const { customerId } = req.user;
  const [profile] = await query(
    `SELECT c.customer_id AS customerId, c.first_name AS firstName, c.last_name AS lastName, c.NIC AS nic, c.DOB AS dob,
            c.address, c.phone, c.email, b.branch_name AS branchName
       FROM CUSTOMER c JOIN BRANCH b ON b.branch_id = c.registered_at_branch_id
      WHERE c.customer_id = ?`,
    [customerId],
  );
  const accounts = await myAccounts(customerId);
  const fixedDeposits = (await query(
    `SELECT ${FD_COLUMNS} ${FD_FROM}
      WHERE fd.account_id IN (SELECT account_id FROM ACCOUNT_HOLDER WHERE customer_id = ?)
      ORDER BY fd.status = 'ACTIVE' DESC, fd.fd_id DESC`,
    [customerId],
  )).map(shape);
  const recent = await query(
    `SELECT t.transaction_id AS transactionId, t.txn_timestamp AS at, t.transaction_type AS type, t.amount,
            IF(t.transaction_type IN ${CREDIT_TYPES}, 'CREDIT', 'DEBIT') AS direction,
            t.reference_no AS referenceNo, t.channel, t.fd_id AS fdId, sa.account_no AS accountNo,
            CONCAT(a.first_name, ' ', a.last_name) AS agentName
       FROM \`TRANSACTION\` t
       JOIN SAVINGS_ACCOUNT sa ON sa.account_id = t.account_id
       LEFT JOIN AGENT a ON a.agent_id = t.processed_by_agent_id
      WHERE t.account_id IN (SELECT account_id FROM ACCOUNT_HOLDER WHERE customer_id = ?)
      ORDER BY t.txn_timestamp DESC, t.transaction_id DESC
      LIMIT 6`,
    [customerId],
  );
  const [limit] = await query("SELECT config_value AS value FROM SYSTEM_CONFIG WHERE config_key = 'daily_withdrawal_limit'");
  sendData(req, res, { profile, accounts, fixedDeposits, recent, dailyWithdrawalLimit: limit?.value ?? null });
});

// GET /api/me/accounts/:id/transactions?page=1&pageSize=15  (only an account this customer holds)
router.get('/accounts/:id/transactions', async (req, res) => {
  const accountId = id(req.params.id, 'id', 'Account ID');
  const pageSize = pageNumber(req.query.pageSize, 'pageSize', 'Page size', 15, 100);
  const page = pageNumber(req.query.page, 'page', 'Page', 1, 100000);
  await myAccount(req.user.customerId, accountId);
  sendData(req, res, await readPassbook(accountId, page, pageSize));
});

function accountNumber(value, field) {
  const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!ACCOUNT_NO.test(text)) throw new ValidationError(field, 'An account number is SA followed by 7 digits, such as SA0000007');
  return text;
}

// The name check before sending money, as banks do: the recipient's account and the initial and surname of its main holder.
// GET /api/me/recipient?accountNo=SA0000007
router.get('/recipient', async (req, res) => {
  const accountNo = accountNumber(req.query.accountNo, 'toAccountNo');
  const [row] = await query(
    `SELECT sa.account_no AS accountNo, sa.status,
            CONCAT(LEFT(c.first_name, 1), '. ', c.last_name) AS holderName
       FROM SAVINGS_ACCOUNT sa
       JOIN ACCOUNT_HOLDER h ON h.account_id = sa.account_id AND h.role = 'PRIMARY'
       JOIN CUSTOMER c ON c.customer_id = h.customer_id
      WHERE sa.account_no = ?`,
    [accountNo],
  );
  if (!row) throw new HttpError(404, `There is no account ${accountNo}`, 'toAccountNo');
  sendData(req, res, row);
});

// Rule messages from PROC_TRANSFER, matched to the form field they are about (checked in this order)
const TRANSFER_FIELDS = [
  [/transfer to|two different/i, 'toAccountNo'],
  [/amount|minimum|limit/i, 'amount'],
  [/holder|account/i, 'fromAccountId'],
];

// POST /api/me/transfers { fromAccountId, toAccountNo, amount }
router.post('/transfers', async (req, res) => {
  const { customerId } = req.user;
  const body = req.body ?? {};
  const fromAccountId = id(body.fromAccountId, 'fromAccountId', 'The account to send from');
  const toAccountNo = accountNumber(body.toAccountNo, 'toAccountNo');
  const amount = money(body.amount, 'amount', 'Amount');
  const [to] = await query('SELECT account_id AS accountId FROM SAVINGS_ACCOUNT WHERE account_no = ?', [toAccountNo]);
  if (!to) throw new ValidationError('toAccountNo', `There is no account ${toAccountNo}`);

  const params = [fromAccountId, customerId, to.accountId, amount, CHANNEL, null];
  noteCall(res, 'PROC_TRANSFER', params);
  let out;
  try {
    out = await callProc('PROC_TRANSFER', params, ['withdrawal_ref', 'deposit_ref', 'new_balance']);
  } catch (err) {
    throw ruleError(err, TRANSFER_FIELDS);
  }
  noteResult(res, out);
  const [row] = await query('SELECT txn_timestamp AS at, review_flag AS reviewFlag FROM `TRANSACTION` WHERE reference_no = ?', [out.deposit_ref]);
  // Receipts: the sender's holders for the money going out, the recipient's holders for the money coming in
  sendInBackground(() => notifications().withdrawal({
    accountId: fromAccountId, amount, referenceNo: out.withdrawal_ref, newBalance: out.new_balance, at: row?.at, agentId: null,
  }));
  sendInBackground(async () => {
    const [account] = await query('SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = ?', [to.accountId]);
    await notifications().deposit({
      accountId: to.accountId, amount, referenceNo: out.deposit_ref, newBalance: account?.balance, at: row?.at, agentId: null,
    });
  });
  if (row?.reviewFlag === 1) {
    sendInBackground(() => notifications().reviewAlert({ accountId: to.accountId, amount, referenceNo: out.deposit_ref, at: row.at, agentId: null }));
  }
  sendData(req, res, {
    fromAccountId,
    toAccountNo,
    amount,
    withdrawalRef: out.withdrawal_ref,
    depositRef: out.deposit_ref,
    newBalance: out.new_balance,
    at: row?.at ?? null,
  }, 201);
});

// POST /api/me/fixed-deposits { accountId, fdPlanId, amount }  (the database checks this customer is the PRIMARY holder)
router.post('/fixed-deposits', async (req, res) => {
  const { customerId } = req.user;
  const body = req.body ?? {};
  const accountId = id(body.accountId, 'accountId', 'Savings account');
  const fdPlanId = id(body.fdPlanId, 'fdPlanId', 'Term');
  const amount = money(body.amount, 'amount', 'Fixed deposit amount');

  const params = [accountId, customerId, fdPlanId, amount, CHANNEL, null];
  noteCall(res, 'PROC_OPEN_FIXED_DEPOSIT', params);
  let out;
  try {
    out = await callProc('PROC_OPEN_FIXED_DEPOSIT', params, ['fd_id', 'reference_no', 'new_balance']);
  } catch (err) {
    throw ruleError(err, OPEN_FIELDS);
  }
  noteResult(res, out);
  const fd = await findFd(out.fd_id);
  sendInBackground(() => notifications().fdOpened({
    accountId, fdId: fd.fdId, amount, termName: fd.termName, interestRate: fd.interestRate, maturityDate: fd.maturityDate,
    nextPayoutDate: fd.nextPayoutDate, referenceNo: out.reference_no, newBalance: out.new_balance, agentId: null,
  }));
  sendData(req, res, { ...fd, referenceNo: out.reference_no, newBalance: out.new_balance }, 201);
});

// POST /api/me/fixed-deposits/:id/close  (only the PRIMARY holder; the database refuses anyone else)
router.post('/fixed-deposits/:id/close', async (req, res) => {
  const { customerId } = req.user;
  const fdId = id(req.params.id, 'id', 'Fixed deposit ID');
  const params = [fdId, customerId, CHANNEL, null];
  noteCall(res, 'PROC_CLOSE_FIXED_DEPOSIT', params);
  try {
    await callProc('PROC_CLOSE_FIXED_DEPOSIT', params);
  } catch (err) {
    throw ruleError(err, []);
  }
  const fd = await findFd(fdId);
  const [closure] = await query(
    `SELECT reference_no AS referenceNo, amount, txn_timestamp AS at FROM \`TRANSACTION\`
      WHERE fd_id = ? AND transaction_type = 'FD_CLOSURE' ORDER BY transaction_id DESC LIMIT 1`,
    [fdId],
  );
  const [account] = await query('SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = ?', [fd.accountId]);
  noteResult(res, { referenceNo: closure?.referenceNo ?? null });
  sendInBackground(() => notifications().fdClosed({
    accountId: fd.accountId, fdId, amount: fd.amount, referenceNo: closure?.referenceNo, newBalance: account?.balance, agentId: null,
  }));
  sendData(req, res, { ...fd, closure: closure ?? null, newBalance: account?.balance ?? null });
});

export default router;
