// Deposits, withdrawals and the passbook of one savings account. Owner: Archchu.
// POST /api/accounts/:id/deposit (PROC_PROCESS_DEPOSIT), POST /api/accounts/:id/withdraw (PROC_PROCESS_WITHDRAWAL) and
// GET /api/accounts/:id/transactions (a read-only SELECT that works out the running balance with a window function).


//Handles deposit,withdrawal and passbook requests,validates the inputs and uses the database procedures to process money safetly
import { Router } from 'express';
import { callProc, query } from '../db.js';
import { HttpError, ruleError } from '../errors.js';
import { noteCall, noteResult, sendData } from '../respond.js';
import { ValidationError, id, money } from '../validate.js';

const router = Router();
const CHANNEL = 'BRANCH'; // every transaction made in this app is done by an agent at a branch (decision #9)

// Money coming into the savings account; the other types (WITHDRAWAL, FD_OPEN) take money out.
const CREDIT_TYPES = "('DEPOSIT', 'SAVINGS_INTEREST', 'FD_INTEREST', 'FD_CLOSURE')";

// Rule messages from the procedures and from trg_transaction_bi, matched to the form field they are about.
const MONEY_FIELDS = [
  [/amount|minimum|limit/i, 'amount'],
  [/not a holder/i, 'customerId'],
  [/agent/i, 'agentId'],
];

async function readBack(referenceNo) {
  const [row] = await query(
    'SELECT review_flag AS reviewFlag, txn_timestamp AS at FROM `TRANSACTION` WHERE reference_no = ?',
    [referenceNo],
  );
  return row ?? {};
}

router.post('/:id/deposit', async (req, res) => {
  const accountId = id(req.params.id, 'id', 'Account ID');
  const body = req.body ?? {};
  const amount = money(body.amount, 'amount', 'Deposit amount');
  const agentId = id(body.agentId, 'agentId', 'Agent');

  const params = [accountId, amount, CHANNEL, agentId];
  noteCall(res, 'PROC_PROCESS_DEPOSIT', params);
  let out;
  try {
    out = await callProc('PROC_PROCESS_DEPOSIT', params, ['reference_no', 'new_balance']);
  } catch (err) {
    throw ruleError(err, MONEY_FIELDS);
  }
  noteResult(res, out);
  // The procedure has no OUT value for the large-deposit flag, so it is read back from the new row (read-only).
  const row = await readBack(out.reference_no);
  sendData(req, res, {
    accountId,
    type: 'DEPOSIT',
    amount,
    referenceNo: out.reference_no,
    newBalance: out.new_balance,
    reviewFlagged: row.reviewFlag === 1,
    at: row.at ?? null,
  }, 201);
});

router.post('/:id/withdraw', async (req, res) => {
  const accountId = id(req.params.id, 'id', 'Account ID');
  const body = req.body ?? {};
  const customerId = id(body.customerId, 'customerId', 'Holder');
  const amount = money(body.amount, 'amount', 'Withdrawal amount');
  const agentId = id(body.agentId, 'agentId', 'Agent');

  const params = [accountId, customerId, amount, CHANNEL, agentId];
  noteCall(res, 'PROC_PROCESS_WITHDRAWAL', params);
  let out;
  try {
    out = await callProc('PROC_PROCESS_WITHDRAWAL', params, ['reference_no', 'new_balance']);
  } catch (err) {
    throw ruleError(err, MONEY_FIELDS);
  }
  noteResult(res, out);
  const row = await readBack(out.reference_no);
  sendData(req, res, {
    accountId,
    type: 'WITHDRAWAL',
    amount,
    customerId,
    referenceNo: out.reference_no,
    newBalance: out.new_balance,
    at: row.at ?? null,
  }, 201);
});

function pageNumber(value, field, label, fallback, max) {
  if (value === undefined || value === '') return fallback;
  const number = id(value, field, label);
  if (number > max) throw new ValidationError(field, `${label} must be at most ${max}`);
  return number;
}

// GET /api/accounts/:id/transactions?page=1&pageSize=20
// Newest first. The running balance is summed in time order (txn_timestamp, then transaction_id, decision #46), so a
// late interest posting stamped with its due date lands where the database itself counts it.
router.get('/:id/transactions', async (req, res) => {
  const accountId = id(req.params.id, 'id', 'Account ID');
  const pageSize = pageNumber(req.query.pageSize, 'pageSize', 'Page size', 20, 100);
  const page = pageNumber(req.query.page, 'page', 'Page', 1, 100000);

  const [account] = await query('SELECT account_id FROM SAVINGS_ACCOUNT WHERE account_id = ?', [accountId]);
  if (!account) throw new HttpError(404, `There is no account with ID ${accountId}`);

  const [counts] = await query(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN transaction_type = 'WITHDRAWAL' AND DATE(txn_timestamp) = CURDATE()
                              THEN amount END), 0) AS withdrawnToday
       FROM \`TRANSACTION\` WHERE account_id = ?`,
    [accountId],
  );
  const rows = await query(
    `SELECT * FROM (
       SELECT t.transaction_id AS transactionId, t.txn_timestamp AS at, t.transaction_type AS type, t.amount,
              IF(t.transaction_type IN ${CREDIT_TYPES}, 'CREDIT', 'DEBIT') AS direction,
              SUM(IF(t.transaction_type IN ${CREDIT_TYPES}, t.amount, -t.amount))
                OVER (ORDER BY t.txn_timestamp, t.transaction_id) AS balanceAfter,
              t.reference_no AS referenceNo, t.channel, t.review_flag AS reviewFlag, t.fd_id AS fdId,
              t.processed_by_agent_id AS agentId, CONCAT(a.first_name, ' ', a.last_name) AS agentName
         FROM \`TRANSACTION\` t
         LEFT JOIN AGENT a ON a.agent_id = t.processed_by_agent_id
        WHERE t.account_id = ?
     ) ledger
     ORDER BY at DESC, transactionId DESC
     LIMIT ? OFFSET ?`,
    [accountId, pageSize, (page - 1) * pageSize],
  );
  const total = Number(counts.total);
  sendData(req, res, {
    accountId,
    page,
    pageSize,
    total,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    withdrawnToday: counts.withdrawnToday,
    rows: rows.map((row) => ({ ...row, reviewFlagged: row.reviewFlag === 1 })),
  });
});

export default router;
