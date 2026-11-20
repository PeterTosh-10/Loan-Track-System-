// Small, dependency-free input validators. All throw a 400 AppError.
const { validation } = require('./errors');

const MAX_KES = 1_000_000_000_000; // 1 trillion: far above any real loan, well inside safe-integer range

// Money must be a whole number of shillings, > 0. Accepts 5000 or "5000", rejects 50.5, "abc", -1, 0.
function parseKes(value, label) {
  let n = value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) n = Number(value.trim());
  if (typeof n !== 'number' || !Number.isSafeInteger(n)) {
    throw validation(`${label} must be a whole number of Kenyan shillings (no decimals or text).`);
  }
  if (n <= 0) throw validation(`${label} must be greater than zero.`);
  if (n > MAX_KES) throw validation(`${label} is too large.`);
  return n;
}

function parseId(value, label) {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n <= 0) throw validation(`${label} must be a valid id.`);
  return n;
}

function parseText(value, label, { min = 1, max = 120 } = {}) {
  if (typeof value !== 'string') throw validation(`${label} is required.`);
  const v = value.trim().replace(/\s+/g, ' ');
  if (v.length < min) throw validation(`${label} is required${min > 1 ? ` (at least ${min} characters)` : ''}.`);
  if (v.length > max) throw validation(`${label} must be at most ${max} characters.`);
  return v;
}

// Codes such as client numbers / payment references: letters, digits and - _ / . only. Stored upper-case.
function parseCode(value, label, { min = 2, max = 40 } = {}) {
  const v = parseText(value, label, { min, max });
  if (!/^[A-Za-z0-9][A-Za-z0-9\-_/.]*$/.test(v)) {
    throw validation(`${label} may only contain letters, numbers and - _ / . (no spaces).`);
  }
  return v.toUpperCase();
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Real calendar date in YYYY-MM-DD (rejects 2026-02-31).
function parseDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw validation(`${label} must be a date in YYYY-MM-DD format.`);
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw validation(`${label} is not a valid calendar date.`);
  }
  return value;
}

// Escape % _ so user search text is treated literally inside LIKE.
const likePattern = (s) => `%${String(s).trim().replace(/[\\%_]/g, '\\$&')}%`;

module.exports = { parseKes, parseId, parseText, parseCode, parseDate, todayISO, likePattern };
