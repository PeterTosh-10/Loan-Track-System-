const { parseKes, parseId, parseCode, parseDate } = require('../utils/validators');
const { notFound, conflict, unprocessable, isUniqueViolation } = require('../utils/errors');
const { getLoanSummary } = require('./loanService');

function recordRepayment(db, input) {
  // 1. Validate the shape of the input (nothing touches the database yet).
  const loanId = parseId(input.loan_id, 'Loan');
  const amount = parseKes(input.amount, 'Repayment amount');
  const reference = parseCode(input.payment_reference, 'Payment reference', { min: 3, max: 50 });
  const paymentDate = parseDate(input.payment_date, 'Payment date');

  // 2. Check business rules and insert inside ONE transaction. `.immediate()` takes the write
  //    lock first, so two requests cannot both read the same balance and both overpay.
  //    If anything throws, SQLite rolls back and no financial record changes.
  const save = db.transaction(() => {
    const loan = getLoanSummary(db, loanId);
    if (!loan) throw notFound('Loan not found. A repayment must be linked to an existing loan.');
    if (db.prepare('SELECT 1 FROM repayments WHERE payment_reference = ?').get(reference)) {
      throw conflict(`Payment reference ${reference} has already been used.`);
    }
    if (loan.outstanding_balance === 0) throw unprocessable('This loan is already fully paid.');
    if (amount > loan.outstanding_balance) {
      throw unprocessable(`Repayment of KES ${amount.toLocaleString('en-KE')} exceeds the outstanding balance of KES ${loan.outstanding_balance.toLocaleString('en-KE')}.`);
    }
    return db.prepare(
      'INSERT INTO repayments (loan_id, amount, payment_reference, payment_date) VALUES (?, ?, ?, ?)'
    ).run(loanId, amount, reference, paymentDate).lastInsertRowid;
  }).immediate;

  let repaymentId;
  try {
    repaymentId = save();
  } catch (err) {
    // Database-level safety nets map to the same friendly errors.
    if (isUniqueViolation(err, 'repayments.payment_reference')) throw conflict(`Payment reference ${reference} has already been used.`);
    if (String(err.message).includes('OVERPAYMENT')) throw unprocessable('Repayment exceeds the outstanding balance.');
    throw err;
  }

  const repayment = db.prepare(
    'SELECT id, loan_id, amount, payment_reference, payment_date, created_at FROM repayments WHERE id = ?'
  ).get(repaymentId);
  return { repayment, loan: getLoanSummary(db, loanId) };
}

// Every repayment in the system, newest first, with the loan/client it belongs to.
function listAllRepayments(db, { limit = 200 } = {}) {
  return db.prepare(`
    SELECT x.* FROM (
      SELECT r.id, r.loan_id, l.loan_reference, c.full_name AS client_name, r.amount,
             r.payment_reference, r.payment_date, r.created_at,
             l.total_due - SUM(r.amount) OVER (PARTITION BY r.loan_id ORDER BY r.payment_date, r.id) AS balance_after
      FROM repayments r JOIN loans l ON l.id = r.loan_id JOIN clients c ON c.id = l.client_id
    ) x ORDER BY x.payment_date DESC, x.id DESC LIMIT ?`).all(limit);
}

module.exports = { recordRepayment, listAllRepayments };
