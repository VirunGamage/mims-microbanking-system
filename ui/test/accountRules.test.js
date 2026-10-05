// Tests for accountRules.js: the browser-side copies of the registration and account-opening rules. Owner: Sameera.
// Run with: npm test  (no server or database needed)
// Unit tests to verify browser-side validation rules and account logic in accountRules.js.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ageFromDob, customerFormErrors, expectedPlan, openingAmountError } from '../src/utils/accountRules.js';

const TODAY = '2026-10-05';
const SETTINGS = { ageChildMax: 12, ageTeenMin: 13, ageTeenMax: 17, ageAdultMin: 18, ageSeniorMin: 60 };
const PLANS = [
  { planId: 1, planName: 'Children', minimumBalance: '0.00' },
  { planId: 2, planName: 'Teen', minimumBalance: '500.00' },
  { planId: 3, planName: 'Adult', minimumBalance: '1000.00' },
  { planId: 4, planName: 'Senior', minimumBalance: '1000.00' },
  { planId: 5, planName: 'Joint', minimumBalance: '5000.00' },
];

test('ageFromDob counts full years and waits for a real date', () => {
  assert.equal(ageFromDob('2008-10-05', TODAY), 18);
  assert.equal(ageFromDob('2008-10-06', TODAY), 17);
  assert.equal(ageFromDob('2008-02-30', TODAY), null);
  assert.equal(ageFromDob('', TODAY), null);
});

test('a complete child registration has no errors, and an adult needs a NIC', () => {
  const child = { firstName: 'Kavya', lastName: 'Perera', dob: '2019-02-01', nic: '' };
  assert.deepEqual(customerFormErrors(child, TODAY), {});
  const adult = { firstName: 'Ruwan', lastName: 'Silva', dob: '2000-01-01', nic: ' ' };
  assert.equal(customerFormErrors(adult, TODAY).nic, 'NIC is required for customers aged 18 or over');
  assert.deepEqual(customerFormErrors({ ...adult, nic: '200000101234' }, TODAY), {});
});

test('registration errors point at the right fields', () => {
  const errors = customerFormErrors({ firstName: ' ', lastName: 'x'.repeat(51), dob: '2030-01-01', nic: '1234567890123' }, TODAY);
  assert.equal(errors.firstName, 'First name is required');
  assert.equal(errors.lastName, 'Last name must be at most 50 characters');
  assert.equal(errors.dob, 'Date of birth cannot be in the future');
  assert.equal(errors.nic, 'NIC must be at most 12 characters');
  assert.equal(customerFormErrors({ firstName: 'A', lastName: 'B', dob: '1899-12-31', nic: '1' }, TODAY).dob,
    'Date of birth must be on or after 1 Jan 1900');
  assert.equal(customerFormErrors({ firstName: 'A', lastName: 'B' }, TODAY).dob, 'Date of birth is required');
});

test('expectedPlan follows the same age bands as PROC_OPEN_SAVINGS_ACCOUNT', () => {
  const plan = (age, joint = false) => expectedPlan({ age, joint, settings: SETTINGS, plans: PLANS })?.planName ?? null;
  assert.equal(plan(0), 'Children');
  assert.equal(plan(12), 'Children');
  assert.equal(plan(13), 'Teen');
  assert.equal(plan(17), 'Teen');
  assert.equal(plan(18), 'Adult');
  assert.equal(plan(59), 'Adult');
  assert.equal(plan(60), 'Senior');
  assert.equal(plan(8, true), 'Joint'); // a joint account is never age-restricted
  assert.equal(plan(null), null);
  assert.equal(expectedPlan({ age: 30, joint: false, settings: null, plans: PLANS }), null);
});

test('the opening deposit must cover the plan minimum', () => {
  const teen = PLANS[1];
  assert.equal(openingAmountError('', teen), 'Opening deposit is required');
  assert.equal(openingAmountError('499.99', teen), 'Opening deposit must be at least LKR 500.00 for the Teen plan');
  assert.equal(openingAmountError('500', teen), null);
  assert.equal(openingAmountError('1,500.50', PLANS[2]), null);
  assert.equal(openingAmountError('0', PLANS[0]), 'Opening deposit must be more than zero');
  assert.equal(openingAmountError('10', null), null); // plan not known yet: only the amount itself is checked
});
