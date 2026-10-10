// Customers: search, one customer with their accounts, and registering a new customer. Owner: Virun.
// Reads are plain SELECTs. Registering is the app's only INSERT (into CUSTOMER); the CUSTOMER triggers still check the
// date of birth and that anyone 18 or over has a NIC. The NIC reminder comes from the view VW_GAP_NIC_AT_18.
// Customer search, one customer with their accounts, and registering a new customer: reads are plain SELECTs, and registering is the app's only INSERT, with the database triggers still checking the date of birth and the NIC.
import { Router } from 'express';
import { databaseToday, query } from '../db.js';
import { HttpError, ruleError } from '../errors.js';
import { noteCall, noteResult, sendData } from '../respond.js';
import { likePattern, searchText } from '../search.js';
import { ValidationError, date, id, optionalText, requiredText } from '../validate.js';

const router = Router();
const MAX_RESULTS = 50;

const LIST_COLUMNS = `
  c.customer_id AS customerId, c.first_name AS firstName, c.last_name AS lastName, c.NIC AS nic, c.DOB AS dob,
  TIMESTAMPDIFF(YEAR, c.DOB, CURDATE()) AS age, c.phone, b.branch_name AS registeredBranch,
  (SELECT COUNT(*) FROM ACCOUNT_HOLDER h WHERE h.customer_id = c.customer_id) AS accountCount`;

// GET /api/customers?search=...  Empty search: the newest customers. Otherwise name, NIC, phone, e-mail or exact ID.
router.get('/', async (req, res) => {
  const search = searchText(req.query.search);
  let where = '';
  const params = [];
  if (search) {
    const like = likePattern(search);
    where = `WHERE c.first_name LIKE ? OR c.last_name LIKE ? OR CONCAT(c.first_name, ' ', c.last_name) LIKE ?
                OR c.NIC LIKE ? OR c.phone LIKE ? OR c.email LIKE ?`;
    params.push(like, like, like, like, like, like);
    if (/^\d{1,10}$/.test(search)) {
      where += ' OR c.customer_id = ?';
      params.push(Number(search));
    }
  }
  const order = search ? 'c.last_name, c.first_name, c.customer_id' : 'c.customer_id DESC';
  const rows = await query(
    `SELECT ${LIST_COLUMNS}
       FROM CUSTOMER c JOIN BRANCH b ON b.branch_id = c.registered_at_branch_id
       ${where}
      ORDER BY ${order}
      LIMIT ?`,
    [...params, MAX_RESULTS],
  );
  sendData(req, res, rows);
});

async function findCustomer(customerId) {
  const [customer] = await query(
    `SELECT c.customer_id AS customerId, c.first_name AS firstName, c.last_name AS lastName, c.NIC AS nic,
            c.DOB AS dob, TIMESTAMPDIFF(YEAR, c.DOB, CURDATE()) AS age, c.address, c.phone, c.email,
            c.registered_by_agent_id AS registeredByAgentId,
            CONCAT(a.first_name, ' ', a.last_name) AS registeredByAgent,
            c.registered_at_branch_id AS registeredBranchId, b.branch_name AS registeredBranch,
            EXISTS (SELECT 1 FROM VW_GAP_NIC_AT_18 g WHERE g.customer_id = c.customer_id) AS nicMissing
       FROM CUSTOMER c
       JOIN AGENT a ON a.agent_id = c.registered_by_agent_id
       JOIN BRANCH b ON b.branch_id = c.registered_at_branch_id
      WHERE c.customer_id = ?`,
    [customerId],
  );
  if (!customer) return null;
  const accounts = await query(
    `SELECT sa.account_id AS accountId, sa.account_no AS accountNo, h.role, sp.plan_name AS planName,
            sa.status, sa.balance, sa.open_date AS openDate,
            (SELECT COUNT(*) FROM ACCOUNT_HOLDER x WHERE x.account_id = sa.account_id) AS holderCount
       FROM ACCOUNT_HOLDER h
       JOIN SAVINGS_ACCOUNT sa ON sa.account_id = h.account_id
       JOIN SAVINGS_PLAN sp ON sp.plan_id = sa.plan_id
      WHERE h.customer_id = ?
      ORDER BY sa.account_id`,
    [customerId],
  );
  return { ...customer, nicMissing: Boolean(customer.nicMissing), accounts };
}

router.get('/:id', async (req, res) => {
  const customerId = id(req.params.id, 'id', 'Customer ID');
  const customer = await findCustomer(customerId);
  if (!customer) throw new HttpError(404, `There is no customer with ID ${customerId}`);
  sendData(req, res, customer);
});

// Messages from the CUSTOMER triggers, matched to the form field they are about.
const CUSTOMER_FIELDS = [
  [/NIC/, 'nic'],
  [/date of birth/i, 'dob'],
  [/agent/i, 'agentId'],
];

// POST /api/customers  The new customer is registered at the branch of the agent who registers them.
router.post('/', async (req, res) => {
  const body = req.body ?? {};
  const firstName = requiredText(body.firstName, 'firstName', 'First name', 50);
  const lastName = requiredText(body.lastName, 'lastName', 'Last name', 50);
  const dob = date(body.dob, 'dob', 'Date of birth');
  if (dob < '1900-01-01') throw new ValidationError('dob', 'Date of birth must be on or after 1900-01-01');
  if (dob > (await databaseToday())) throw new ValidationError('dob', 'Date of birth cannot be in the future');
  const nic = optionalText(body.nic, 'nic', 'NIC', 12);
  const address = optionalText(body.address, 'address', 'Address', 150);
  const phone = optionalText(body.phone, 'phone', 'Phone', 20);
  const email = optionalText(body.email, 'email', 'E-mail', 100);
  const agentId = id(body.agentId, 'agentId', 'Agent');

  // REQ-BRA-05: only an ACTIVE agent may register customers. trg_customer_bi refuses it too; checking here first gives a clear error on the agent field.
  const [agent] = await query('SELECT status, branch_id AS branchId FROM AGENT WHERE agent_id = ?', [agentId]);
  if (!agent) throw new HttpError(400, 'That agent does not exist', 'agentId');
  if (agent.status !== 'ACTIVE') throw new HttpError(422, 'Only an ACTIVE agent can register a customer', 'agentId');

  const params = [firstName, lastName, nic, dob, address, phone, email, agentId, agent.branchId];
  noteCall(res, 'INSERT INTO CUSTOMER', params);
  let result;
  try {
    result = await query(
      `INSERT INTO CUSTOMER (first_name, last_name, NIC, DOB, address, phone, email,
                             registered_by_agent_id, registered_at_branch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params,
    );
  } catch (err) {
    if (err?.errno === 1062 && /uq_customer_nic/.test(err.sqlMessage)) {
      throw new HttpError(409, 'A customer with this NIC is already registered', 'nic');
    }
    throw ruleError(err, CUSTOMER_FIELDS);
  }
  noteResult(res, { customerId: result.insertId });
  sendData(req, res, await findCustomer(result.insertId), 201);
});

export default router;
