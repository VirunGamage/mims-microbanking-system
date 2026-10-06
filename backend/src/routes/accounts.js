// Savings accounts: open one (PROC_OPEN_SAVINGS_ACCOUNT), look one up, and find accounts by customer or search text.
// Owner: Virun. The procedure chooses the plan, checks the business hours and the plan's minimum balance, and posts the
// opening deposit, all in one unit. Everything else here is a plain SELECT.
// Savings accounts: opening one calls PROC_OPEN_SAVINGS_ACCOUNT, which picks the plan, checks business hours and the minimum balance and posts the opening deposit in one unit; looking up and searching accounts are plain SELECTs.
import { Router } from 'express';
import { callProc, query } from '../db.js';
import { HttpError, ruleError } from '../errors.js';
import { noteCall, noteResult, sendData } from '../respond.js';
import { likePattern, searchText } from '../search.js';
import { ValidationError, id, money, optionalId } from '../validate.js';

const router = Router();
const MAX_RESULTS = 20;

const ACCOUNT_COLUMNS = `
  sa.account_id AS accountId, sa.account_no AS accountNo, sa.status, sa.balance, sa.open_date AS openDate,
  sa.next_interest_date AS nextInterestDate, sp.plan_id AS planId, sp.plan_name AS planName,
  sp.interest_rate AS interestRate, sp.minimum_balance AS minimumBalance`;

// Adds each account's holders (PRIMARY first) with one extra query for the whole list.
async function withHolders(accounts) {
  if (accounts.length === 0) return accounts;
  const holders = await query(
    `SELECT h.account_id AS accountId, h.customer_id AS customerId, CONCAT(c.first_name, ' ', c.last_name) AS name,
            h.role, c.NIC AS nic, TIMESTAMPDIFF(YEAR, c.DOB, CURDATE()) AS age
       FROM ACCOUNT_HOLDER h JOIN CUSTOMER c ON c.customer_id = h.customer_id
      WHERE h.account_id IN (?)
      ORDER BY h.account_id, h.role, h.customer_id`,
    [accounts.map((account) => account.accountId)],
  );
  return accounts.map((account) => ({
    ...account,
    holders: holders
      .filter((holder) => holder.accountId === account.accountId)
      .map(({ accountId, ...holder }) => holder),
  }));
}

async function findAccount(accountId) {
  const rows = await query(
    `SELECT ${ACCOUNT_COLUMNS}
       FROM SAVINGS_ACCOUNT sa JOIN SAVINGS_PLAN sp ON sp.plan_id = sa.plan_id
      WHERE sa.account_id = ?`,
    [accountId],
  );
  const [account] = await withHolders(rows);
  return account ?? null;
}

// GET /api/accounts?customerId=5  the accounts a customer holds
// GET /api/accounts?search=SA00   account number, holder name or NIC, or an exact account ID; empty: the newest accounts
router.get('/', async (req, res) => {
  let where = '';
  const params = [];
  if (req.query.customerId !== undefined) {
    where = 'WHERE EXISTS (SELECT 1 FROM ACCOUNT_HOLDER h WHERE h.account_id = sa.account_id AND h.customer_id = ?)';
    params.push(id(req.query.customerId, 'customerId', 'Customer ID'));
  } else {
    const search = searchText(req.query.search);
    if (search) {
      const like = likePattern(search);
      where = `WHERE sa.account_no LIKE ?
                  OR EXISTS (SELECT 1 FROM ACCOUNT_HOLDER h JOIN CUSTOMER c ON c.customer_id = h.customer_id
                              WHERE h.account_id = sa.account_id
                                AND (CONCAT(c.first_name, ' ', c.last_name) LIKE ? OR c.NIC LIKE ?))`;
      params.push(like, like, like);
      if (/^\d{1,10}$/.test(search)) {
        where += ' OR sa.account_id = ?';
        params.push(Number(search));
      }
    }
  }
  const order = where ? 'sa.account_id' : 'sa.account_id DESC';
  const rows = await query(
    `SELECT ${ACCOUNT_COLUMNS}
       FROM SAVINGS_ACCOUNT sa JOIN SAVINGS_PLAN sp ON sp.plan_id = sa.plan_id
       ${where}
      ORDER BY ${order}
      LIMIT ?`,
    [...params, MAX_RESULTS],
  );
  sendData(req, res, await withHolders(rows));
});

router.get('/:id', async (req, res) => {
  const accountId = id(req.params.id, 'id', 'Account ID');
  const account = await findAccount(accountId);
  if (!account) throw new HttpError(404, `There is no account with ID ${accountId}`);
  sendData(req, res, account);
});

// Messages from PROC_OPEN_SAVINGS_ACCOUNT, matched to the form field they are about.
const OPEN_FIELDS = [
  [/^Primary customer/, 'primaryCustomerId'],
  [/^Secondary customer|^Joint holders/, 'secondaryCustomerId'],
  [/^Opening deposit/, 'openingAmount'],
  [/agent/i, 'agentId'],
];

// POST /api/accounts  { primaryCustomerId, secondaryCustomerId (only for a joint account), openingAmount, agentId }
router.post('/', async (req, res) => {
  const body = req.body ?? {};
  const primaryCustomerId = id(body.primaryCustomerId, 'primaryCustomerId', 'Primary holder');
  const secondaryCustomerId = optionalId(body.secondaryCustomerId, 'secondaryCustomerId', 'Second holder');
  if (secondaryCustomerId === primaryCustomerId) {
    throw new ValidationError('secondaryCustomerId', 'Joint holders must be two different customers');
  }
  const openingAmount = money(body.openingAmount, 'openingAmount', 'Opening deposit');
  const agentId = id(body.agentId, 'agentId', 'Agent');

  const params = [primaryCustomerId, secondaryCustomerId, openingAmount, agentId];
  noteCall(res, 'PROC_OPEN_SAVINGS_ACCOUNT', params);
  let out;
  try {
    out = await callProc('PROC_OPEN_SAVINGS_ACCOUNT', params, ['account_id', 'account_no', 'reference_no']);
  } catch (err) {
    throw ruleError(err, OPEN_FIELDS);
  }
  noteResult(res, out);

  // The procedure has no OUT value for the large-deposit flag, so it is read back from the opening deposit's row.
  const [opening] = await query('SELECT review_flag AS reviewFlag FROM `TRANSACTION` WHERE reference_no = ?', [out.reference_no]);
  const account = await findAccount(out.account_id);
  sendData(req, res, { ...account, referenceNo: out.reference_no, reviewFlagged: opening?.reviewFlag === 1 }, 201);
});

export default router;
