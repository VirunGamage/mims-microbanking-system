// The sums and checks behind online banking, so a form can say what is wrong before anything is sent. The database
// still decides: PROC_TRANSFER, PROC_OPEN_FIXED_DEPOSIT and PROC_CLOSE_FIXED_DEPOSIT check every rule again.
// Money is worked out in whole cents (utils/money.js), never as floating-point numbers.
import { interestFor } from './fdRules.js';
import { amountError, centsToAmount, compareAmounts, formatMoney, toCents } from './money.js';

const ACCOUNT_NO = /^SA\d{7}$/;

// What can still be sent or withdrawn today: the balance above the plan minimum, and at most what is left of the daily
// withdrawal limit (money already withdrawn or sent today counts towards it). Never below zero.
export function availableToday(account, dailyLimit) {
  const aboveMinimum = toCents(account.balance) - toCents(account.minimumBalance);
  const limit = toCents(dailyLimit);
  const leftToday = limit === null ? aboveMinimum : limit - (toCents(account.withdrawnToday) ?? 0n);
  const most = aboveMinimum < leftToday ? aboveMinimum : leftToday;
  return centsToAmount(most > 0n ? most : 0n);
}

export function normaliseAccountNo(text) {
  return String(text ?? '').trim().toUpperCase();
}

// { toAccountNo, amount } for a transfer from `account` -> { field: message } for each problem, or {} when it looks right
export function transferErrors({ toAccountNo, amount }, account, available) {
  const errors = {};
  const to = normaliseAccountNo(toAccountNo);
  if (!to) errors.toAccountNo = 'The account to send to is required';
  else if (!ACCOUNT_NO.test(to)) errors.toAccountNo = 'An account number is SA followed by 7 digits, such as SA0000007';
  else if (account && to === account.accountNo) errors.toAccountNo = 'Choose an account other than the one you send from';

  const amountProblem = amountError(amount, 'Amount');
  if (amountProblem) errors.amount = amountProblem;
  else if (available !== undefined && compareAmounts(String(amount).trim().replace(/,/g, ''), available) > 0) {
    errors.amount = compareAmounts(available, '0') > 0
      ? `You can send at most ${formatMoney(available)} from this account today`
      : 'Nothing more can be sent from this account today';
  }
  return errors;
}

// '199012345678' -> '19********78'. Only the first two and last two characters are shown.
export function maskNic(nic) {
  const text = String(nic ?? '');
  if (text.length <= 4) return text ? '*'.repeat(text.length) : '—';
  return `${text.slice(0, 2)}${'*'.repeat(text.length - 4)}${text.slice(-2)}`;
}

export function greeting(hour) {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// A fixed deposit pays interest every cycle until it matures: the payout each cycle, how many, and the total.
export function fdProjection(amount, rate, durationDays, cycleDays, basis) {
  const perPayout = interestFor(amount, rate, cycleDays, basis);
  if (perPayout === null || !durationDays || !cycleDays) return null;
  const payouts = Math.floor(durationDays / cycleDays);
  return { perPayout, payouts, total: centsToAmount(toCents(perPayout) * BigInt(payouts)) };
}

// The accounts this customer can open a fixed deposit on: ACTIVE, held as PRIMARY holder, and with no ACTIVE FD yet.
export function accountsForNewFd(accounts, fixedDeposits) {
  const busy = new Set(fixedDeposits.filter((fd) => fd.status === 'ACTIVE').map((fd) => fd.accountId));
  return accounts.filter((account) => account.status === 'ACTIVE' && account.role === 'PRIMARY' && !busy.has(account.accountId));
}

// Whether this customer can close a fixed deposit early now, and if not, why (the same rules as PROC_CLOSE_FIXED_DEPOSIT).
export function closeCheck(fd, account, todayIso) {
  if (fd.status !== 'ACTIVE') return { ok: false, reason: null };
  if (!account || account.role !== 'PRIMARY') return { ok: false, reason: 'Only the primary holder of the account can close it.' };
  if (account.status !== 'ACTIVE') return { ok: false, reason: 'The savings account is not active, so no money can move.' };
  if (todayIso && fd.maturityDate <= todayIso) return { ok: false, reason: 'It has reached maturity; the bank pays it back by itself.' };
  if (fd.payoutDue) return { ok: false, reason: 'An interest payout is due; the bank posts it first, then it can be closed.' };
  return { ok: true, reason: null };
}
