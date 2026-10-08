// Tests for fdRules.js: the FD interest preview must match FUNC_CALC_INTEREST to the cent. Owner: Shanuja.
// Run with: npm test  (no server or database needed). The expected payouts are the ones in the sample data.
// I wrote these tests to prove interestFor() matches the database's FUNC_CALC_INTEREST exactly each expected value here is a real payout from the sample data. 
// So if the formula in fdRules.js ever drifts from the database's formula, these tests catch it before the preview shows the wrong number.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays, fdAmountError, interestFor, termLabel } from '../src/utils/fdRules.js';

test('interest per 30-day payout matches the postings in the sample data', () => {
  assert.equal(interestFor('50000.00', '13.00', 30, 365), '534.25'); // FD 2
  assert.equal(interestFor('50000.00', '14.00', 30, 365), '575.34'); // FD 3
  assert.equal(interestFor('50000.00', '15.00', 30, 365), '616.44'); // FD 6 and 7
  assert.equal(interestFor('15000.00', '15.00', 30, 365), '184.93'); // FD 9
  assert.equal(interestFor('75000.00', '14.00', 30, 365), '863.01'); // FD 8
  assert.equal(interestFor('abc', '14.00', 30, 365), null);
});

test('dates move by whole days across months and years', () => {
  assert.equal(addDays('2026-10-05', 30), '2026-11-04');
  assert.equal(addDays('2026-10-05', 180), '2027-04-03');
  assert.equal(addDays('2026-10-05', 1080), '2029-09-19');
});

test('an FD may not take the savings balance below the plan minimum', () => {
  const children = { balance: '24408.42', minimumBalance: '0.00' };
  assert.equal(fdAmountError('24408.42', children), null);
  assert.equal(fdAmountError('24408.43', children), 'At most LKR 24,408.42: the savings account must keep its LKR 0.00 minimum');
  assert.equal(fdAmountError('1', { balance: '1000.00', minimumBalance: '1000.00' }),
    'The savings account has nothing above its LKR 1,000.00 minimum to move');
  assert.equal(fdAmountError('', children), 'Amount is required');
  assert.equal(termLabel('3_YEAR'), '3 years');
});
