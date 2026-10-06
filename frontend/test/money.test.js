// Tests for src/utils/money.js: exact cents, formatting and input checks. Owner: Virun. Run with: npm test
// Checks that amounts convert to exact cents, format with commas, and that bad input is refused with a clear message.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addAmounts,
  amountError,
  centsToAmount,
  compareAmounts,
  formatMoney,
  normaliseAmount,
  subtractAmounts,
  toCents,
} from '../src/utils/money.js';

test('toCents reads amounts exactly, with or without commas and signs', () => {
  assert.equal(toCents('1253029.59'), 125302959n);
  assert.equal(toCents('1,500.5'), 150050n);
  assert.equal(toCents(' 7 '), 700n);
  assert.equal(toCents('-12.30'), -1230n);
  assert.equal(toCents(250), 25000n);
  assert.equal(toCents('abc'), null);
  assert.equal(toCents('1.234'), null);
  assert.equal(toCents(null), null);
});

test('no floating-point drift: 0.10 + 0.20 is exactly 0.30', () => {
  assert.equal(addAmounts('0.10', '0.20'), '0.30');
  assert.equal(subtractAmounts('100000.00', '0.01'), '99999.99');
  assert.equal(centsToAmount(-5n), '-0.05');
});

test('formatMoney groups thousands and always shows two decimals', () => {
  assert.equal(formatMoney('1253029.59'), 'LKR 1,253,029.59');
  assert.equal(formatMoney('1000000'), 'LKR 1,000,000.00');
  assert.equal(formatMoney('0.5'), 'LKR 0.50');
  assert.equal(formatMoney('-1000'), '−LKR 1,000.00');
  assert.equal(formatMoney('99999999999999.99', { currency: false }), '99,999,999,999,999.99');
  assert.equal(formatMoney(undefined), '—');
});

test('amountError mirrors the backend rules', () => {
  assert.equal(amountError('1500'), null);
  assert.equal(amountError('1,500.50'), null);
  assert.match(amountError(''), /required/);
  assert.match(amountError('0.00'), /more than zero/);
  assert.match(amountError('-5'), /amount such as/);
  assert.match(amountError('1.234'), /amount such as/);
  assert.match(amountError('1000000000000'), /amount such as/);
});

test('normaliseAmount produces the exact text sent to the API', () => {
  assert.equal(normaliseAmount('1,500.5'), '1500.50');
  assert.equal(normaliseAmount('25'), '25.00');
  assert.equal(normaliseAmount('0'), null);
});

test('compareAmounts compares exactly', () => {
  assert.equal(compareAmounts('1000.00', '999.99'), 1);
  assert.equal(compareAmounts('5000', '5000.00'), 0);
  assert.equal(compareAmounts('0.01', '0.02'), -1);
});
