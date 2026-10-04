// Input checks that run before anything reaches the database. Owner: Virun. Used by every route file.
// They catch obvious mistakes early and point at the field; the database still has the final word on every rule.
// Checks the basics of each input (text, ids, money, dates, allowed values) before it reaches the database, so a mistake is reported against the right field; the database still enforces the real rules.

import { HttpError } from './errors.js';

export class ValidationError extends HttpError {
  constructor(field, message) {
    super(400, message, field);
  }
}

const MONEY = /^(\d{1,12})(?:\.(\d{1,2}))?$/; // DECIMAL(14,2): up to 12 digits before the point, 2 after
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ID = /^[1-9]\d{0,9}$/;
const MAX_INT = 2147483647; // the largest value an INT column can hold

function isEmpty(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

export function requiredText(value, field, label, maxLength) {
  if (isEmpty(value) || typeof value !== 'string') throw new ValidationError(field, `${label} is required`);
  const text = value.trim();
  if (text.length > maxLength) throw new ValidationError(field, `${label} must be at most ${maxLength} characters`);
  return text;
}

export function optionalText(value, field, label, maxLength) {
  if (isEmpty(value)) return null;
  return requiredText(value, field, label, maxLength);
}

export function id(value, field, label) {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!ID.test(text) || Number(text) > MAX_INT) throw new ValidationError(field, `${label} must be a positive whole number`);
  return Number(text);
}

export function optionalId(value, field, label) {
  return isEmpty(value) ? null : id(value, field, label);
}

// Money arrives and leaves as text ("1500.5" becomes "1500.50"), so no floating-point arithmetic ever touches it.
export function money(value, field, label) {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  const match = MONEY.exec(text);
  if (!match) throw new ValidationError(field, `${label} must be an amount such as 1500 or 1500.50`);
  const whole = match[1].replace(/^0+(?=\d)/, '');
  const cents = (match[2] ?? '').padEnd(2, '0');
  if (whole === '0' && cents === '00') throw new ValidationError(field, `${label} must be more than zero`);
  return `${whole}.${cents}`;
}

// A real calendar date in YYYY-MM-DD form (2026-02-30 is refused).
export function date(value, field, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  const match = ISO_DATE.exec(text);
  if (match) {
    const [year, month, day] = match.slice(1).map(Number);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day) return text;
  }
  throw new ValidationError(field, `${label} must be a real date written as YYYY-MM-DD`);
}

export function oneOf(value, field, label, allowed) {
  if (!allowed.includes(value)) throw new ValidationError(field, `${label} must be one of: ${allowed.join(', ')}`);
  return value;
}
