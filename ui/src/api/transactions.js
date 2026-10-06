// The calls behind the Transactions page: record a deposit or a withdrawal, and read the passbook.
// Uses POST /api/accounts/:id/deposit, POST /api/accounts/:id/withdraw and GET /api/accounts/:id/transactions.

// provides the UI API calls for deposits,withdrawls and loading an account's transaction history.

import { api } from './client.js';

export const PAGE_SIZE = 15;

export const passbookPath = (accountId, page = 1) =>
  `/accounts/${encodeURIComponent(accountId)}/transactions?page=${page}&pageSize=${PAGE_SIZE}`;

// { amount, agentId } -> { referenceNo, newBalance, reviewFlagged, at }
export function deposit(accountId, body) {
  return api.post(`/accounts/${encodeURIComponent(accountId)}/deposit`, body);
}

// { amount, customerId, agentId } -> { referenceNo, newBalance, at }
export function withdraw(accountId, body) {
  return api.post(`/accounts/${encodeURIComponent(accountId)}/withdraw`, body);
}
