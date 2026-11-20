const { parseKes, parseId, parseDate, todayISO, likePattern } = require('../utils/validators');
const { validation, notFound, isUniqueViolation, conflict } = require('../utils/errors');
const { LOAN_SUMMARY_SQL, withStatus } = require('./loanQueries');

function createLoan(db, input) {
  const clientId = parseId(input.client_id, 'Client');
  const loanAmount = parseKes(input.loan_amount, 'Loan amount');
  const totalDue = parseKes(input.total_due, 'Total amount due');
  if (totalDue < loanAmount) throw validation('Total amount due cannot be less than the original loan amount.');
  const createdAt = input.created_at ? parseDate(input.created_at, 'Loan date') : todayISO();

  const insert = db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM clients WHERE id = ?').get(clientId)) throw notFound('Client not found.');
    // Reference like LN-000042, derived from the next row id. The UNIQUE constraint backs it up.
    const next = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM loans').get().n;
    const reference = `LN-${String(next).padStart(6, '0')}`;
    return db.prepare(
      'INSERT INTO loans (loan_reference, client_id, loan_amount, total_due, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(reference, clientId, loanAmount, totalDue, createdAt).lastInsertRowid;
  });

  try {
    return getLoanSummary(db, insert());
  } catch (err) {
    if (isUniqueViolation(err, 'loans.loan_reference')) throw conflict('Could not generate a unique loan reference. Please retry.');
    throw err;
  }
}

function getLoanSummary(db, id) {
  return withStatus(db.prepare(`${LOAN_SUMMARY_SQL} WHERE l.id = ?`).get(id));
}

function listLoans(db, { search, status } = {}) {
  const where = [];
  const params = [];
  if (search && String(search).trim()) {
    const p = likePattern(search);
    where.push(`(l.loan_reference LIKE ? ESCAPE '\\' OR c.full_name LIKE ? ESCAPE '\\' OR c.client_number LIKE ? ESCAPE '\\')`);
    params.push(p, p, p);
  }
  if (status === 'outstanding') where.push('(l.total_due - COALESCE(r.total_repaid, 0)) > 0');
  else if (status === 'paid') where.push('(l.total_due - COALESCE(r.total_repaid, 0)) = 0');
  else if (status) throw validation('status must be "outstanding" or "paid".');
  const sql = `${LOAN_SUMMARY_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.id DESC`;
  return db.prepare(sql).all(...params).map(withStatus);
}

// Repayments of one loan in date order, each with the balance left AFTER that payment
// (a running total computed by SQL, not stored).
function listRepaymentsForLoan(db, loanId) {
  return db.prepare(`
    SELECT x.* FROM (
      SELECT r.id, r.loan_id, r.amount, r.payment_reference, r.payment_date, r.created_at,
             l.total_due - SUM(r.amount) OVER (PARTITION BY r.loan_id ORDER BY r.payment_date, r.id) AS balance_after
      FROM repayments r JOIN loans l ON l.id = r.loan_id
    ) x WHERE x.loan_id = ? ORDER BY x.payment_date, x.id`).all(loanId);
}

function getLoanDetails(db, rawId) {
  const id = parseId(rawId, 'Loan id');
  const loan = getLoanSummary(db, id);
  if (!loan) throw notFound('Loan not found.');
  return { ...loan, repayments: listRepaymentsForLoan(db, id) };
}

function getLoanRepayments(db, rawId) {
  const id = parseId(rawId, 'Loan id');
  const loan = getLoanSummary(db, id);
  if (!loan) throw notFound('Loan not found.');
  return { loan, repayments: listRepaymentsForLoan(db, id) };
}

module.exports = { createLoan, listLoans, getLoanSummary, getLoanDetails, getLoanRepayments };
