// The calls behind the Fixed Deposits page.
// Uses GET /api/fixed-deposits, POST /api/fixed-deposits (PROC_OPEN_FIXED_DEPOSIT) and
// POST /api/fixed-deposits/:id/close (PROC_CLOSE_FIXED_DEPOSIT).
// This file holds the calls the Fixed deposits page makes to the backend: listing FDs, opening one and closing one early. 
// The database does the real work and its answers come back as they are.

import { api } from './client.js';

export function fixedDepositsPath({ accountId, status } = {}) {
  const query = new URLSearchParams();
  if (accountId) query.set('accountId', accountId);
  if (status) query.set('status', status);
  const text = query.toString();
  return `/fixed-deposits${text ? `?${text}` : ''}`;
}

// { accountId, customerId, fdPlanId, amount, agentId } -> the new FD with its reference and the savings balance left
export function openFixedDeposit(body) {
  return api.post('/fixed-deposits', body);
}

// { customerId, agentId } -> the closed FD, its closing transaction and the new savings balance
export function closeFixedDeposit(fdId, body) {
  return api.post(`/fixed-deposits/${encodeURIComponent(fdId)}/close`, body);
}
