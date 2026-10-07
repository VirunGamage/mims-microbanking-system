// Browser-side copies of the deposit and withdrawal rules, so a mistake shows beside the amount before anything is sent.
// Same order and limits as PROC_PROCESS_WITHDRAWAL; the database still makes the final decision.

// Checks deposit and withdrawl inputs in the UI before requests are sent to the backend.
import { addAmounts, amountError, compareAmounts, formatMoney, subtractAmounts } from './money.js';

const clean = (text) => String(text ?? '').trim().replace(/,/g, '');

export function depositError(text) {
  return amountError(text, 'Deposit amount');
}

// True when the deposit is above the large-deposit threshold, so it will be saved but flagged for review.
export function willBeFlagged(text, threshold) {
  return amountError(text) === null && Boolean(threshold) && compareAmounts(clean(text), threshold) > 0;
}

// Checks, in the procedure's order: a valid amount, the plan minimum, then the running daily limit.
export function withdrawalError(text, { balance, minimumBalance, withdrawnToday, dailyLimit }) {
  const basic = amountError(text, 'Withdrawal amount');
  if (basic) return basic;
  const amount = clean(text);
  if (balance !== undefined && minimumBalance !== undefined && compareAmounts(subtractAmounts(balance, amount), minimumBalance) < 0) {
    const most = subtractAmounts(balance, minimumBalance);
    return compareAmounts(most, '0') > 0
      ? `This would take the balance below the plan minimum of ${formatMoney(minimumBalance)}; at most ${formatMoney(most)} can be withdrawn`
      : `The balance is already at the plan minimum of ${formatMoney(minimumBalance)}, so nothing can be withdrawn`;
  }
  if (withdrawnToday !== undefined && dailyLimit && compareAmounts(addAmounts(withdrawnToday, amount), dailyLimit) > 0) {
    const left = subtractAmounts(dailyLimit, withdrawnToday);
    return compareAmounts(left, '0') > 0
      ? `This would pass the daily limit of ${formatMoney(dailyLimit)}; ${formatMoney(left)} is left for today`
      : `The daily limit of ${formatMoney(dailyLimit)} has been reached for this account today`;
  }
  return null;
}
