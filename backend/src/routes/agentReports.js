// Reports for the agent at the counter: what this agent processed in a period (to balance the cash drawer), and the fixed
// deposits at any branch with a payout or maturity coming up (any customer can walk in to any agent). Read-only SELECTs.
// The bank-wide management reports (routes/reports.js) stay for admins.
import { Router } from 'express';
import { databaseToday, query } from '../db.js';
import { noteCall, sendData } from '../respond.js';
import { ValidationError, date, id } from '../validate.js';

const router = Router();
const CREDIT_TYPES = "('DEPOSIT', 'SAVINGS_INTEREST', 'FD_INTEREST', 'FD_CLOSURE')";

// An agent always sees their own work; an admin chooses the agent (the "Acting as" list)
function agentOf(req) {
  return req.user.role === 'AGENT' ? req.user.agentId : id(req.query.agentId, 'agentId', 'Agent');
}

// GET /api/agent-reports/my-activity?start=YYYY-MM-DD&end=YYYY-MM-DD  (both default to today by the database clock)
// The range on txn_timestamp lets idx_txn_agent_date (processed_by_agent_id, txn_timestamp) find only these rows.
router.get('/my-activity', async (req, res) => {
  const agentId = agentOf(req);
  const today = await databaseToday();
  const start = req.query.start ? date(req.query.start, 'start', 'Start date') : today;
  const end = req.query.end ? date(req.query.end, 'end', 'End date') : today;
  if (start > end) throw new ValidationError('start', 'The start date must be on or before the end date');
  const params = [agentId, start, end];
  noteCall(res, 'SELECT ... FROM TRANSACTION WHERE processed_by_agent_id = ? (period)', params);

  const rows = await query(
    `SELECT t.transaction_id AS transactionId, t.txn_timestamp AS at, t.transaction_type AS type, t.amount,
            IF(t.transaction_type IN ${CREDIT_TYPES}, 'CREDIT', 'DEBIT') AS direction, t.reference_no AS referenceNo,
            t.review_flag AS reviewFlag, t.fd_id AS fdId, sa.account_no AS accountNo,
            CONCAT(c.first_name, ' ', c.last_name) AS holder
       FROM \`TRANSACTION\` t
       JOIN SAVINGS_ACCOUNT sa ON sa.account_id = t.account_id
       LEFT JOIN ACCOUNT_HOLDER h ON h.account_id = t.account_id AND h.role = 'PRIMARY'
       LEFT JOIN CUSTOMER c ON c.customer_id = h.customer_id
      WHERE t.processed_by_agent_id = ? AND t.txn_timestamp >= ? AND t.txn_timestamp < ? + INTERVAL 1 DAY
      ORDER BY t.txn_timestamp DESC, t.transaction_id DESC
      LIMIT 500`,
    params,
  );
  const [totals] = await query(
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(CASE WHEN transaction_type IN ${CREDIT_TYPES} THEN amount END), 0) AS moneyIn,
            COALESCE(SUM(CASE WHEN transaction_type NOT IN ${CREDIT_TYPES} THEN amount END), 0) AS moneyOut,
            COALESCE(SUM(transaction_type = 'DEPOSIT'), 0) AS deposits,
            COALESCE(SUM(transaction_type = 'WITHDRAWAL'), 0) AS withdrawals
       FROM \`TRANSACTION\`
      WHERE processed_by_agent_id = ? AND txn_timestamp >= ? AND txn_timestamp < ? + INTERVAL 1 DAY`,
    params,
  );
  sendData(req, res, {
    agentId, start, end,
    totals: { ...totals, count: Number(totals.count), deposits: Number(totals.deposits), withdrawals: Number(totals.withdrawals) },
    rows: rows.map((row) => ({ ...row, reviewFlagged: row.reviewFlag === 1 })),
  });
});

// GET /api/agent-reports/fds-due?days=30: ACTIVE FDs at every branch whose next payout or maturity is within that many days
router.get('/fds-due', async (req, res) => {
  const days = req.query.days ? id(req.query.days, 'days', 'Days') : 30;
  if (days > 365) throw new ValidationError('days', 'Days must be at most 365');
  noteCall(res, 'SELECT ... FROM VW_ACTIVE_FD_PAYOUT_SCHEDULE (due within days)', [days]);
  const rows = await query(
    `SELECT v.fd_id AS fdId, v.account_no AS accountNo, v.principal, v.interest_rate AS interestRate, v.term,
            v.next_payout_date AS nextPayoutDate, v.maturity_date AS maturityDate,
            CONCAT(c.first_name, ' ', c.last_name) AS holder, c.phone, b.branch_name AS branchName,
            (v.maturity_date <= CURDATE() + INTERVAL ? DAY) AS maturing
       FROM VW_ACTIVE_FD_PAYOUT_SCHEDULE v
       JOIN SAVINGS_ACCOUNT sa ON sa.account_no = v.account_no
       JOIN ACCOUNT_HOLDER h ON h.account_id = sa.account_id AND h.role = 'PRIMARY'
       JOIN CUSTOMER c ON c.customer_id = h.customer_id
       JOIN BRANCH b ON b.branch_id = c.registered_at_branch_id
      WHERE v.next_payout_date <= CURDATE() + INTERVAL ? DAY OR v.maturity_date <= CURDATE() + INTERVAL ? DAY
      ORDER BY LEAST(v.next_payout_date, v.maturity_date), v.fd_id`,
    [days, days, days],
  );
  sendData(req, res, { days, rows: rows.map((row) => ({ ...row, maturing: row.maturing === 1 })) });
});

export default router;
