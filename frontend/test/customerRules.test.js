// Tests the online banking sums and checks (src/utils/customerRules.js). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  accountsForNewFd, availableToday, closeCheck, fdProjection, greeting, maskNic, normaliseAccountNo, transferErrors,
} from '../src/utils/customerRules.js';

const adult = { accountId: 6, accountNo: 'SA0000006', status: 'ACTIVE', role: 'PRIMARY', balance: '56430.24', minimumBalance: '1000.00', withdrawnToday: '0.00' };

test('what can be sent today is the balance above the minimum, capped by what is left of the daily limit', () => {
  assert.equal(availableToday(adult, '100000.00'), '55430.24');
  assert.equal(availableToday({ ...adult, balance: '500000.00' }, '100000.00'), '100000.00');
  assert.equal(availableToday({ ...adult, balance: '500000.00', withdrawnToday: '60000.00' }, '100000.00'), '40000.00');
  assert.equal(availableToday({ ...adult, balance: '900.00' }, '100000.00'), '0.00');
  assert.equal(availableToday({ ...adult, withdrawnToday: '100000.00' }, '100000.00'), '0.00');
});

test('a transfer needs a real account number, another account, and an amount that can be sent today', () => {
  assert.deepEqual(transferErrors({ toAccountNo: 'sa0000007', amount: '2000' }, adult, '55430.24'), {});
  assert.equal(normaliseAccountNo(' sa0000007 '), 'SA0000007');
  assert.match(transferErrors({ toAccountNo: '', amount: '1' }, adult, '10.00').toAccountNo, /required/);
  assert.match(transferErrors({ toAccountNo: 'SA12', amount: '1' }, adult, '10.00').toAccountNo, /SA followed by 7 digits/);
  assert.match(transferErrors({ toAccountNo: 'SA0000006', amount: '1' }, adult, '10.00').toAccountNo, /other than the one/);
  assert.match(transferErrors({ toAccountNo: 'SA0000007', amount: '0' }, adult, '10.00').amount, /more than zero/);
  assert.match(transferErrors({ toAccountNo: 'SA0000007', amount: '10.01' }, adult, '10.00').amount, /at most LKR 10.00/);
  assert.match(transferErrors({ toAccountNo: 'SA0000007', amount: '1' }, adult, '0.00').amount, /Nothing more/);
});

test('a NIC is shown with only its first two and last two characters', () => {
  assert.equal(maskNic('199012345678'), '19********78');
  assert.equal(maskNic('901234567V'), '90******7V');
  assert.equal(maskNic(null), '—');
});

test('the greeting follows the time of day', () => {
  assert.equal(greeting(8), 'Good morning');
  assert.equal(greeting(13), 'Good afternoon');
  assert.equal(greeting(19), 'Good evening');
});

test('a fixed deposit projection matches FUNC_CALC_INTEREST: 100,000 at 14% for a year pays 1,150.68 twelve times', () => {
  assert.deepEqual(fdProjection('100000.00', '14.00', 360, 30, 365), { perPayout: '1150.68', payouts: 12, total: '13808.16' });
  assert.equal(fdProjection('abc', '14.00', 360, 30, 365), null);
});

test('a new fixed deposit can only go on an ACTIVE account held as PRIMARY with no ACTIVE FD', () => {
  const accounts = [
    adult,
    { ...adult, accountId: 7, accountNo: 'SA0000007' },
    { ...adult, accountId: 12, role: 'SECONDARY' },
    { ...adult, accountId: 13, status: 'FROZEN' },
  ];
  const fds = [{ accountId: 6, status: 'ACTIVE' }, { accountId: 7, status: 'CLOSED' }];
  assert.deepEqual(accountsForNewFd(accounts, fds).map((a) => a.accountId), [7]);
});

test('closing a fixed deposit early follows the database rules, with the reason when it cannot', () => {
  const fd = { status: 'ACTIVE', maturityDate: '2027-04-03', payoutDue: false };
  assert.deepEqual(closeCheck(fd, adult, '2026-10-13'), { ok: true, reason: null });
  assert.match(closeCheck(fd, { ...adult, role: 'SECONDARY' }, '2026-10-13').reason, /primary holder/);
  assert.match(closeCheck({ ...fd, payoutDue: true }, adult, '2026-10-13').reason, /payout is due/);
  assert.match(closeCheck(fd, adult, '2027-04-03').reason, /maturity/);
  assert.equal(closeCheck({ ...fd, status: 'CLOSED' }, adult, '2026-10-13').ok, false);
});
