// Unit tests for validate.js (money, dates, ids, text) and config.js. Owner: Virun.
// Run with: npm test  (no database needed)
// Tests each input check (text, ids, money, dates, allowed values) with good and bad values, including that the error names the right field.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigError, readConfig } from '../src/config.js';
import { date, id, money, oneOf, optionalId, optionalText, requiredText, ValidationError } from '../src/validate.js';

test('money is normalised to two decimals and stays a string', () => {
  assert.equal(money('1500', 'amount', 'Amount'), '1500.00');
  assert.equal(money('1500.5', 'amount', 'Amount'), '1500.50');
  assert.equal(money(' 0.01 ', 'amount', 'Amount'), '0.01');
  assert.equal(money('007.10', 'amount', 'Amount'), '7.10');
  assert.equal(money(250, 'amount', 'Amount'), '250.00');
  assert.equal(money('999999999999.99', 'amount', 'Amount'), '999999999999.99');
});

test('bad money is refused with a message tied to the field', () => {
  for (const bad of ['0', '0.00', '-5', '1.234', 'abc', '', null, '1,500', '1e5', '1000000000000']) {
    assert.throws(() => money(bad, 'amount', 'Amount'), (err) => err instanceof ValidationError && err.field === 'amount', String(bad));
  }
});

test('dates must be real YYYY-MM-DD dates', () => {
  assert.equal(date('2026-10-05', 'dob', 'Date of birth'), '2026-10-05');
  assert.equal(date('2024-02-29', 'dob', 'Date of birth'), '2024-02-29');
  for (const bad of ['2026-02-30', '2025-02-29', '05/10/2026', '2026-1-5', '', undefined]) {
    assert.throws(() => date(bad, 'dob', 'Date of birth'), ValidationError, String(bad));
  }
});

test('ids are positive whole numbers that fit in an INT column', () => {
  assert.equal(id('7', 'agentId', 'Agent'), 7);
  assert.equal(id(12, 'agentId', 'Agent'), 12);
  for (const bad of ['0', '-1', '1.5', 'x', '', '2147483648', null]) {
    assert.throws(() => id(bad, 'agentId', 'Agent'), ValidationError, String(bad));
  }
  assert.equal(optionalId('', 'secondaryCustomerId', 'Second holder'), null);
  assert.equal(optionalId(undefined, 'secondaryCustomerId', 'Second holder'), null);
});

test('text is trimmed, required when asked, and length-checked', () => {
  assert.equal(requiredText('  Nimal ', 'firstName', 'First name', 50), 'Nimal');
  assert.throws(() => requiredText('   ', 'firstName', 'First name', 50), ValidationError);
  assert.throws(() => requiredText('x'.repeat(51), 'firstName', 'First name', 50), ValidationError);
  assert.equal(optionalText('', 'email', 'Email', 100), null);
});

test('oneOf only accepts the listed values', () => {
  assert.equal(oneOf('ACTIVE', 'status', 'Status', ['ACTIVE', 'MATURED', 'CLOSED']), 'ACTIVE');
  assert.throws(() => oneOf('OPEN', 'status', 'Status', ['ACTIVE', 'MATURED', 'CLOSED']), ValidationError);
});
test('config needs user, password and database, and rejects the example password', () => {
  assert.throws(() => readConfig({ DB_USER: 'mims_app', DB_NAME: 'mims' }), ConfigError);
  assert.throws(() => readConfig({ DB_USER: 'mims_app', DB_PASSWORD: 'change-me', DB_NAME: 'mims' }), /example value/);
  assert.throws(() => readConfig({ DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'mims', PORT: 'abc' }), /PORT/);
  const config = readConfig({ DB_USER: 'mims_app', DB_PASSWORD: 'secret', DB_NAME: 'mims' });
  assert.deepEqual(config, {
    port: 3001,
    db: { host: '127.0.0.1', port: 3306, user: 'mims_app', password: 'secret', database: 'mims' },
  });
});
