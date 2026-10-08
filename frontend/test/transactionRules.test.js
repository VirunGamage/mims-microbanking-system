//Tests the UI deposit and withdrawal validation rules for valid invalid amounts. 
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { depositError, willBeFlagged, withdrawalError } from '../src/utils/transactionRules.js';

const TEEN = { balance: '10756.51', minimumBalance: '500.00', withdrawnToday: '0.00', dailyLimit: '100000.00' };

test('deposits: any amount above zero, flagged only above the threshold', () => {
  assert.equal(depositError(''), 'Deposit amount is required');
  assert.equal(depositError('0.00'), 'Deposit amount must be more than zero');
  assert.equal(depositError('2,500'), null);
  assert.equal(willBeFlagged('1000000.00', '1000000.00'), false); // exactly the threshold is not above it
  assert.equal(willBeFlagged('1,000,000.01', '1000000.00'), true);
  assert.equal(willBeFlagged('abc', '1000000.00'), false);
});

test('a withdrawal may not take the balance below the plan minimum', () => {
  assert.equal(withdrawalError('10256.51', TEEN), null); // leaves exactly 500.00
  assert.equal(withdrawalError('10256.52', TEEN),
    'This would take the balance below the plan minimum of LKR 500.00; at most LKR 10,256.51 can be withdrawn');
  assert.equal(withdrawalError('1', { ...TEEN, balance: '500.00' }),
    'The balance is already at the plan minimum of LKR 500.00, so nothing can be withdrawn');
});

test('the daily limit is a running total for the day', () => {
  const rich = { balance: '2000000.00', minimumBalance: '1000.00', withdrawnToday: '60000.00', dailyLimit: '100000.00' };
  assert.equal(withdrawalError('40000', rich), null); // reaches the limit exactly
  assert.equal(withdrawalError('40000.01', rich),
    'This would pass the daily limit of LKR 100,000.00; LKR 40,000.00 is left for today');
  assert.equal(withdrawalError('0.01', { ...rich, withdrawnToday: '100000.00' }),
    'The daily limit of LKR 100,000.00 has been reached for this account today');
});

test('the minimum balance is checked before the daily limit, like the procedure', () => {
  const both = { balance: '1500.00', minimumBalance: '1000.00', withdrawnToday: '100000.00', dailyLimit: '100000.00' };
  assert.match(withdrawalError('600', both), /plan minimum/);
});

test('passbook lines are worded from the type, channel, agent and FD', async () => {
  const { describe } = await import('../src/utils/ledger.js');
  assert.equal(describe({ type: 'DEPOSIT', channel: 'BRANCH', agentName: 'Carol Lee' }), 'Deposit · Carol Lee');
  assert.equal(describe({ type: 'WITHDRAWAL', channel: 'ATM' }), 'Withdrawal · ATM');
  assert.equal(describe({ type: 'SAVINGS_INTEREST', channel: 'SYSTEM' }), 'Savings interest');
  assert.equal(describe({ type: 'FD_INTEREST', channel: 'SYSTEM', fdId: 9 }), 'Fixed deposit interest · FD 9');
  assert.equal(describe({ type: 'FD_CLOSURE', channel: 'SYSTEM', fdId: 3 }), 'FD 3 matured · money returned');
  assert.equal(describe({ type: 'FD_CLOSURE', channel: 'BRANCH', fdId: 3, agentName: 'Bob Johnson' }), 'FD 3 closed early · money returned');
});
