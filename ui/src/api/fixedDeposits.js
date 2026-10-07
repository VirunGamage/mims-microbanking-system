// The calls behind the Fixed Deposits page.
// Uses GET /api/fixed-deposits, POST /api/fixed-deposits (PROC_OPEN_FIXED_DEPOSIT) and
// POST /api/fixed-deposits/:id/close (PROC_CLOSE_FIXED_DEPOSIT).
// The frontend's calls to my fixed deposit routes — building the list URL with its filters and posting to open or close an FD.
// Kept separate from the page component so the page only deals with what to show, not how the request is shaped.

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
