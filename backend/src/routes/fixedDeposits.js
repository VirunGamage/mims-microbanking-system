// Fixed deposits: list them with their next payout, open one (PROC_OPEN_FIXED_DEPOSIT) and close one early
// (PROC_CLOSE_FIXED_DEPOSIT). The list is a plain SELECT; the payout per cycle comes from FUNC_CALC_INTEREST,
// the same function the interest job uses.
// The backend door for fixed deposits lists them with the payout preview and the running interest paid so far and calls PROC_OPEN_FIXED_DEPOSIT / PROC_CLOSE_FIXED_DEPOSIT for opening and closing. 
// It never updates a balance directly; every change goes through those two procedures.
import { Router } from 'express';
import { callProc, query } from '../db.js';
import { HttpError, ruleError } from '../errors.js';
import { noteCall, noteResult, sendData } from '../respond.js';
import { id, money, oneOf, optionalId } from '../validate.js';

const router = Router();
const STATUSES = ['ACTIVE', 'MATURED', 'CLOSED'];

// payoutDue: an ACTIVE FD whose payout date has come but whose interest hasn't been posted yet. The database refuses to close it until
// that payout is posted, so the close dialog warns about it.
const FD_COLUMNS = `
  fd.fd_id AS fdId, fd.account_id AS accountId, sa.account_no AS accountNo, fd.amount, fd.interest_rate AS interestRate,
  fd.fd_plan_id AS fdPlanId, fp.term_name AS termName, fp.duration_days AS durationDays,
  fd.start_date AS startDate, fd.maturity_date AS maturityDate, fd.status, fd.next_payout_date AS nextPayoutDate,
  fd.close_date AS closeDate,
  (fd.status = 'ACTIVE' AND fd.next_payout_date IS NOT NULL AND fd.next_payout_date <= CURDATE()) AS payoutDue,
  FUNC_CALC_INTEREST(fd.amount, fd.interest_rate,
    (SELECT CAST(config_value AS UNSIGNED) FROM SYSTEM_CONFIG WHERE config_key = 'fd_interest_cycle_days')) AS interestPerPayout,
  (SELECT COUNT(*) FROM \`TRANSACTION\` t WHERE t.fd_id = fd.fd_id AND t.transaction_type = 'FD_INTEREST') AS payouts,
  (SELECT COALESCE(SUM(t.amount), 0) FROM \`TRANSACTION\` t
    WHERE t.fd_id = fd.fd_id AND t.transaction_type = 'FD_INTEREST') AS interestPaid,
  (SELECT CONCAT(c.first_name, ' ', c.last_name) FROM ACCOUNT_HOLDER h JOIN CUSTOMER c ON c.customer_id = h.customer_id
    WHERE h.account_id = fd.account_id AND h.role = 'PRIMARY' LIMIT 1) AS primaryHolder`;

const FROM = `
  FROM FIXED_DEPOSIT fd
  JOIN SAVINGS_ACCOUNT sa ON sa.account_id = fd.account_id
  JOIN FD_PLAN fp ON fp.fd_plan_id = fd.fd_plan_id`;

function shape(row) {
  return { ...row, payoutDue: row.payoutDue === 1 };
}

async function findFd(fdId) {
  const [row] = await query(`SELECT ${FD_COLUMNS} ${FROM} WHERE fd.fd_id = ?`, [fdId]);
  return row ? shape(row) : null;
}

// GET /api/fixed-deposits?accountId=6&status=ACTIVE  (both optional) ACTIVE ones first, then the newest.
router.get('/', async (req, res) => {
  const conditions = [];
  const params = [];
  const accountId = optionalId(req.query.accountId, 'accountId', 'Account ID');
  if (accountId !== null) {
    conditions.push('fd.account_id = ?');
    params.push(accountId);
  }
  if (req.query.status !== undefined && req.query.status !== '') {
    conditions.push('fd.status = ?');
    params.push(oneOf(req.query.status, 'status', 'Status', STATUSES));
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await query(
    `SELECT ${FD_COLUMNS} ${FROM} ${where}
      ORDER BY fd.status = 'ACTIVE' DESC, fd.fd_id DESC
      LIMIT 500`,
    params,
  );
  sendData(req, res, rows.map(shape));
});

router.get('/:id', async (req, res) => {
  const fdId = id(req.params.id, 'id', 'Fixed deposit ID');
  const fd = await findFd(fdId);
  if (!fd) throw new HttpError(404, `There is no fixed deposit with ID ${fdId}`);
  sendData(req, res, fd);
});

// Rule messages from PROC_OPEN_FIXED_DEPOSIT, matched to the form field they are about (checked in this order).
const OPEN_FIELDS = [
  [/amount|minimum/i, 'amount'],
  [/holder/i, 'customerId'],
  [/plan not found/i, 'fdPlanId'],
  [/agent/i, 'agentId'],
  [/account/i, 'accountId'],
];

// POST /api/fixed-deposits  { accountId, customerId (the holder asking), fdPlanId, amount, agentId }
router.post('/', async (req, res) => {
  const body = req.body ?? {};
  const accountId = id(body.accountId, 'accountId', 'Savings account');
  const customerId = id(body.customerId, 'customerId', 'Holder');
  const fdPlanId = id(body.fdPlanId, 'fdPlanId', 'Term');
  const amount = money(body.amount, 'amount', 'Fixed deposit amount');
  const agentId = id(body.agentId, 'agentId', 'Agent');

  const params = [accountId, customerId, fdPlanId, amount, agentId];
  noteCall(res, 'PROC_OPEN_FIXED_DEPOSIT', params);
  let out;
  try {
    out = await callProc('PROC_OPEN_FIXED_DEPOSIT', params, ['fd_id', 'reference_no', 'new_balance']);
  } catch (err) {
    throw ruleError(err, OPEN_FIELDS);
  }
  noteResult(res, out);
  const fd = await findFd(out.fd_id);
  sendData(req, res, { ...fd, referenceNo: out.reference_no, newBalance: out.new_balance }, 201);
});

// POST /api/fixed-deposits/:id/close  { customerId (the holder asking), agentId }
router.post('/:id/close', async (req, res) => {
  const fdId = id(req.params.id, 'id', 'Fixed deposit ID');
  const body = req.body ?? {};
  const customerId = id(body.customerId, 'customerId', 'Holder');
  const agentId = id(body.agentId, 'agentId', 'Agent');

  const params = [fdId, customerId, agentId];
  noteCall(res, 'PROC_CLOSE_FIXED_DEPOSIT', params);
  try {
    await callProc('PROC_CLOSE_FIXED_DEPOSIT', params);
  } catch (err) {
    throw ruleError(err, [[/holder/i, 'customerId']]);
  }

  // The procedure has no OUT values, so the result is read back: the FD, its closing transaction and the new balance.
  const fd = await findFd(fdId);
  const [closure] = await query(
    `SELECT reference_no AS referenceNo, amount, txn_timestamp AS at FROM \`TRANSACTION\`
      WHERE fd_id = ? AND transaction_type = 'FD_CLOSURE' ORDER BY transaction_id DESC LIMIT 1`,
    [fdId],
  );
  const [account] = await query('SELECT balance FROM SAVINGS_ACCOUNT WHERE account_id = ?', [fd.accountId]);
  noteResult(res, { referenceNo: closure?.referenceNo ?? null });
  sendData(req, res, { ...fd, closure: closure ?? null, newBalance: account?.balance ?? null });
});

export default router;
