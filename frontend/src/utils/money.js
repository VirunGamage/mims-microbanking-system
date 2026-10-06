// Money helpers. Amounts travel as text such as '1253029.59' and are added or compared as whole cents (BigInt),
// so no floating-point arithmetic ever touches money. Owner: Virun. Used by MoneyInput, tables and every page showing LKR.
// Treats every amount as whole cents (BigInt) instead of decimals, so adding, comparing and formatting money never gives a floating-point error.

const SIGNED_AMOUNT = /^(-)?(\d+)(?:\.(\d{0,2}))?$/;
const INPUT_AMOUNT = /^(\d{1,12})(?:\.(\d{1,2}))?$/; // the same limits the backend and DECIMAL(14,2) use

// '1,253,029.59', '-12.5', 250 → whole cents as a BigInt; anything that isn't an amount → null.
export function toCents(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim().replace(/,/g, '');
  const match = SIGNED_AMOUNT.exec(text);
  if (!match) return null;
  const cents = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return match[1] ? -cents : cents;
}

// Whole cents → the plain text the API uses, e.g. 150050n → '1500.50'.
export function centsToAmount(cents) {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const text = `${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

function groupThousands(digits) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// '1253029.59' → 'LKR 1,253,029.59'. Negative amounts get a minus sign in front: '−LKR 1,000.00'.
export function formatMoney(value, { currency = true } = {}) {
  const cents = toCents(value);
  if (cents === null) return '—';
  const negative = cents < 0n;
  const [whole, part] = centsToAmount(negative ? -cents : cents).split('.');
  const text = `${groupThousands(whole)}.${part}`;
  const withCurrency = currency ? `LKR ${text}` : text;
  return negative ? `−${withCurrency}` : withCurrency;
}

// Checks what a person typed into an amount box; returns a message to show, or null when it is fine.
export function amountError(text, label = 'Amount') {
  const clean = String(text ?? '').trim().replace(/,/g, '');
  if (clean === '') return `${label} is required`;
  const match = INPUT_AMOUNT.exec(clean);
  if (!match) return `${label} must be an amount such as 1500 or 1500.50`;
  if (toCents(clean) === 0n) return `${label} must be more than zero`;
  return null;
}

// What a person typed → the exact text sent to the API ('1,500.5' → '1500.50'), or null when it isn't valid.
export function normaliseAmount(text) {
  if (amountError(text) !== null) return null;
  return centsToAmount(toCents(String(text).trim().replace(/,/g, '')));
}

export function addAmounts(a, b) {
  return centsToAmount(toCents(a) + toCents(b));
}

export function subtractAmounts(a, b) {
  return centsToAmount(toCents(a) - toCents(b));
}

export function compareAmounts(a, b) {
  const x = toCents(a);
  const y = toCents(b);
  return x === y ? 0 : x < y ? -1 : 1;
}
