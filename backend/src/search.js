// Small helpers for the customer and account search boxes. Used by routes/customers.js and routes/accounts.js.
// The search text only ever travels as a ? value; it is never pasted into the SQL itself.
// Cleans up what a user types in a search box (trims it, limits its length, escapes the LIKE wildcards % and _) so it can only ever travel as a ? value and never be pasted into the SQL
import { HttpError } from './errors.js';

// Reads ?search=... (ignores anything that isn't a single piece of text) and trims it.
export function searchText(value, maxLength = 100) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > maxLength) throw new HttpError(400, `Search text must be at most ${maxLength} characters`, 'search');
  return text;
}

// 'Ann_%' -> '%Ann\_\%%': LIKE treats % and _ as wildcards, so the user's own % and _ are escaped first.
export function likePattern(text) {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}
