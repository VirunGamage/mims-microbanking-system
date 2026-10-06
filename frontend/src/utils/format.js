// Date, number and percentage formatting, done the same way on every page. Owner: Virun.
// Dates arrive from the API as text ('2026-10-05' or '2026-10-05 10:00:00') and are split by hand, never passed
// to new Date(text), so the computer's time zone can never shift a date by a day.
// Formats dates, times, ages, counts and percentages the same way on every page, splitting date text by hand so the computer's time zone can never shift a day.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/;

function parts(text) {
  const match = DATE_TIME.exec(String(text ?? ''));
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const monthIndex = Number(month) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  return { year, month: MONTHS[monthIndex], day: String(Number(day)), hour, minute };
}

// '2026-10-05' → '5 Oct 2026'
export function formatDate(text) {
  const p = parts(text);
  return p ? `${p.day} ${p.month} ${p.year}` : '—';
}

// '2026-10-05 10:00:00' → '5 Oct 2026, 10:00'
export function formatDateTime(text) {
  const p = parts(text);
  if (!p) return '—';
  return p.hour ? `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}` : `${p.day} ${p.month} ${p.year}`;
}

// '2026-10-05 10:00:00' → '10:00'
export function formatTime(text) {
  const p = parts(text);
  return p?.hour ? `${p.hour}:${p.minute}` : '—';
}

// Today on this computer as YYYY-MM-DD.
export function todayIso(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Full years between two YYYY-MM-DD dates, counted like MySQL's TIMESTAMPDIFF(YEAR, ...).
export function ageOn(dobIso, onIso) {
  const [by, bm, bd] = String(dobIso).split('-').map(Number);
  const [ty, tm, td] = String(onIso).split('-').map(Number);
  if ([by, bm, bd, ty, tm, td].some(Number.isNaN)) return null;
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age;
}

// 1234 → '1,234'
export function formatCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '—';
}

// '12.00' → '12%', '13.50' → '13.5%'
export function formatPercent(value) {
  const text = String(value ?? '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return '—';
  return `${text.includes('.') ? text.replace(/\.?0+$/, '') : text}%`;
}
