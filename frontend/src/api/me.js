// The calls behind online banking. The server works on the signed-in customer only, so no customer id is ever sent.
// Uses GET /api/me/overview, GET /api/me/accounts/:id/transactions, GET /api/me/recipient, POST /api/me/transfers,
// POST /api/me/fixed-deposits and POST /api/me/fixed-deposits/:id/close.
import { api } from './client.js';

export const OVERVIEW_PATH = '/me/overview';
export const HISTORY_PAGE_SIZE = 15;

export const historyPath = (accountId, page = 1, pageSize = HISTORY_PAGE_SIZE) =>
  `/me/accounts/${encodeURIComponent(accountId)}/transactions?page=${page}&pageSize=${pageSize}`;

// Every line of an account's history, for the statement download (at most 2,000 lines)
export async function fullHistory(accountId) {
  const rows = [];
  for (let page = 1; page <= 20; page += 1) {
    const book = await api.get(historyPath(accountId, page, 100));
    rows.push(...book.rows);
    if (page >= book.pages) break;
  }
  return rows;
}

// 'SA0000007' -> { accountNo, status, holderName: 'S. Thomas' }
export function checkRecipient(accountNo) {
  return api.get(`/me/recipient?accountNo=${encodeURIComponent(accountNo)}`);
}

// { fromAccountId, toAccountNo, amount } -> { withdrawalRef, depositRef, newBalance, at }
export function sendMoney(body) {
  return api.post('/me/transfers', body);
}

// { accountId, fdPlanId, amount } -> the new FD with its reference and the savings balance left
export function openFixedDeposit(body) {
  return api.post('/me/fixed-deposits', body);
}

export function closeFixedDeposit(fdId) {
  return api.post(`/me/fixed-deposits/${encodeURIComponent(fdId)}/close`, {});
}
