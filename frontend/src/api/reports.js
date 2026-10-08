// The calls behind the Reports and Data Checks pages. Owner: Rukshi.
// Uses GET /api/reports/... (the five report routines and the active-FD view), GET /api/tester/gap/... (the Data Checks
// views) and POST /api/tester/run-interest.
// This file builds the report and tester API request paths and provides the helper used to run the QA interest-processing action.
import { api } from './client.js';

const query = (values) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null && value !== '') params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : '';
};

export const reportPath = {
  'agent-wise': ({ start, end }) => `/reports/agent-wise${query({ start, end })}`,
  'account-wise': ({ branchId }) => `/reports/account-wise${query({ branchId })}`,
  'active-fds': () => '/reports/active-fds',
  'monthly-interest': ({ year, month }) => `/reports/monthly-interest${query({ year, month })}`,
  'customer-activity': ({ start, end }) => `/reports/customer-activity${query({ start, end })}`,
};

export const GAP_NIC_PATH = '/tester/gap/nic-at-18';
export const GAP_PLAN_PATH = '/tester/gap/plan-outgrown';

// Posts the interest due up to runDate: FD interest, then FD maturity, then savings interest (QA only).
export function runInterest(runDate) {
  return api.post('/tester/run-interest', { runDate, confirm: true });
}
