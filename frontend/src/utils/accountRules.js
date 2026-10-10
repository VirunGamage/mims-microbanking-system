// The registration and account-opening rules, checked in the browser before anything is sent. Owner: Sameera.
// They copy what the database does (trg_customer_bi, PROC_OPEN_SAVINGS_ACCOUNT) so mistakes show up beside the field;
// the database still makes the final decision. Used by pages/Customers.jsx and pages/OpenAccount.jsx.
// Client-side validation rules and helper logic for customer registration and account opening.
import { ageOn } from './format.js';
import { amountError, compareAmounts, formatMoney } from './money.js';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LIMITS = { firstName: 50, lastName: 50, nic: 12, phone: 20, email: 100, address: 150 };
const LABELS = { firstName: 'First name', lastName: 'Last name', nic: 'NIC', phone: 'Phone', email: 'E-mail', address: 'Address' };

function isRealDate(text) {
  const match = ISO_DATE.exec(text);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

// Age in full years on `today`, or null while the date typed so far isn't a real date or is in the future.
export function ageFromDob(dob, today) {
  return isRealDate(String(dob ?? '')) && String(dob) <= today ? ageOn(dob, today) : null;
}

// Field name -> message, for every problem in the registration form. An empty object means it can be sent.
export function customerFormErrors(form, today, adultAge = 18) {
  const errors = {};
  for (const field of ['firstName', 'lastName']) {
    if (!String(form[field] ?? '').trim()) errors[field] = `${LABELS[field]} is required`;
  }
  for (const [field, max] of Object.entries(LIMITS)) {
    if (String(form[field] ?? '').trim().length > max) errors[field] = `${LABELS[field]} must be at most ${max} characters`;
  }
  const dob = String(form.dob ?? '').trim();
  if (!dob) errors.dob = 'Date of birth is required';
  else if (!isRealDate(dob)) errors.dob = 'Date of birth must be a real date';
  else if (dob < '1900-01-01') errors.dob = 'Date of birth must be on or after 1 Jan 1900';
  else if (dob > today) errors.dob = 'Date of birth cannot be in the future';
  else if (!errors.nic && !String(form.nic ?? '').trim() && ageOn(dob, today) >= adultAge) {
    errors.nic = `NIC is required for customers aged ${adultAge} or over`;
  }
  return errors;
}

// The plan PROC_OPEN_SAVINGS_ACCOUNT will choose: Joint when there is a second holder, otherwise by the primary
// holder's age using the bands in SYSTEM_CONFIG. Returns the plan row, or null if it can't tell yet.
export function expectedPlan({ age, joint, settings, plans }) {
  if (!settings || !plans) return null;
  let name = null;
  if (joint) name = 'Joint';
  else if (age === null || age === undefined) return null;
  else if (age <= settings.ageChildMax) name = 'Children';
  else if (age >= settings.ageTeenMin && age <= settings.ageTeenMax) name = 'Teen';
  else if (age >= settings.ageSeniorMin) name = 'Senior';
  else if (age >= settings.ageAdultMin) name = 'Adult';
  return plans.find((plan) => plan.planName === name) ?? null;
}

// The opening deposit must be a valid amount and cover the plan's minimum balance.
export function openingAmountError(text, plan) {
  const basic = amountError(text, 'Opening deposit');
  if (basic) return basic;
  if (plan && compareAmounts(String(text).trim().replace(/,/g, ''), plan.minimumBalance) < 0) {
    return `Opening deposit must be at least ${formatMoney(plan.minimumBalance)} for the ${plan.planName} plan`;
  }
  return null;
}
