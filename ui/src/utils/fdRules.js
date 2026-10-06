// Fixed deposit sums for the page's preview: the interest per payout and the dates, worked out exactly in whole cents.
// Owner: Shanuja. Same formula as FUNC_CALC_INTEREST (amount × rate × days ÷ basis, rounded to the cent); the database
// posts the real amounts.
// I wrote this so the Fixed Deposits form can show an interest preview instantly, without waiting on the server. 
// It mirrors FUNC_CALC_INTEREST's math exactly (same rounding, same whole-cent precision) so the number shown here never disagrees with what the database actually posts.

import { amountError, centsToAmount, compareAmounts, formatMoney, subtractAmounts, toCents } from './money.js';

// '50000.00' at '13.00' % for 30 days on a 365-day basis -> '534.25'. Rates are kept as hundredths of a percent (1300).
export function interestFor(amount, rate, days, basis) {
  const cents = toCents(amount);
  const hundredths = toCents(rate);
  if (cents === null || hundredths === null || !days || !basis) return null;
  const numerator = cents * hundredths * BigInt(days);
  const denominator = 10000n * BigInt(basis); // 100 for the percent, 100 for the hundredths
  return centsToAmount((numerator * 2n + denominator) / (2n * denominator)); // rounded half up, like ROUND(x, 2)
}

// '2026-10-05' + 180 days -> '2027-04-03' (calendar arithmetic in UTC, so no time zone can move the date).
export function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

// The amount must be valid and leave at least the plan minimum in the savings account (PROC_OPEN_FIXED_DEPOSIT's rule).
export function fdAmountError(text, account) {
  const basic = amountError(text, 'Amount');
  if (basic || !account) return basic;
  const amount = String(text).trim().replace(/,/g, '');
  if (compareAmounts(subtractAmounts(account.balance, amount), account.minimumBalance) < 0) {
    const most = subtractAmounts(account.balance, account.minimumBalance);
    return compareAmounts(most, '0') > 0
      ? `At most ${formatMoney(most)}: the savings account must keep its ${formatMoney(account.minimumBalance)} minimum`
      : `The savings account has nothing above its ${formatMoney(account.minimumBalance)} minimum to move`;
  }
  return null;
}

// '6_MONTH' -> '6 months'
export function termLabel(termName) {
  return { '6_MONTH': '6 months', '1_YEAR': '1 year', '3_YEAR': '3 years' }[termName] ?? termName;
}
