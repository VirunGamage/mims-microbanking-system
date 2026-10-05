// The five management reports. Owner: Rukshi.
// Each one calls its report routine (RPT_...) or reads the view VW_ACTIVE_FD_PAYOUT_SCHEDULE; nothing here changes data.
// Column names come back in camelCase (total_value -> totalValue), so a column added to a report later still comes through.
// This route file exposes the five management reports and converts database column names to the camelCase format used by the API.
import { Router } from 'express';
import { callRows, query } from '../db.js';
import { noteCall, sendData } from '../respond.js';
import { ValidationError, date, id, optionalId } from '../validate.js';

const router = Router();

// total_interest_paid -> totalInterestPaid; a name in capitals such as NIC becomes nic.
function camelCase(key) {
  return key === key.toUpperCase() ? key.toLowerCase() : key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

export function camelRows(rows) {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [camelCase(key), value])));
}

// ?start=YYYY-MM-DD&end=YYYY-MM-DD, both required, start not after end.
function period(req) {
  const start = date(req.query.start, 'start', 'Start date');
  const end = date(req.query.end, 'end', 'End date');
  if (start > end) throw new ValidationError('start', 'The start date must be on or before the end date');
  return [start, end];
}

function wholeNumber(value, field, label, min, max) {
  const number = id(value, field, label);
  if (number < min || number > max) throw new ValidationError(field, `${label} must be between ${min} and ${max}`);
  return number;
}

async function report(req, res, routine, params) {
  noteCall(res, routine, params);
  sendData(req, res, camelRows(await callRows(routine, params)));
}

// Report 1: transactions handled by each agent in a period (count and value).
router.get('/agent-wise', async (req, res) => {
  await report(req, res, 'RPT_AGENT_WISE_TRANSACTIONS', period(req));
});

// Report 2: every account's deposits, withdrawals and interest, for one branch or (no branchId) all branches.
router.get('/account-wise', async (req, res) => {
  await report(req, res, 'RPT_ACCOUNT_WISE_SUMMARY', [optionalId(req.query.branchId, 'branchId', 'Branch')]);
});

// Report 3: active fixed deposits and their next payout dates (a view, not a procedure).
router.get('/active-fds', async (req, res) => {
  noteCall(res, 'SELECT * FROM VW_ACTIVE_FD_PAYOUT_SCHEDULE', []);
  sendData(req, res, camelRows(await query('SELECT * FROM VW_ACTIVE_FD_PAYOUT_SCHEDULE')));
});

// Report 4: interest paid in one month, per savings plan.
router.get('/monthly-interest', async (req, res) => {
  const year = wholeNumber(req.query.year, 'year', 'Year', 2000, 2100);
  const month = wholeNumber(req.query.month, 'month', 'Month', 1, 12);
  await report(req, res, 'RPT_MONTHLY_INTEREST_DISTRIBUTION', [year, month]);
});

// Report 5: each customer's deposits and withdrawals in a period.
router.get('/customer-activity', async (req, res) => {
  await report(req, res, 'RPT_CUSTOMER_ACTIVITY', period(req));
});

export default router;
