// Every figure comes from a SQL aggregate over the real tables.
function getDashboard(db) {
  const clients = db.prepare('SELECT COUNT(*) AS n FROM clients').get().n;
  const t = db.prepare(`
    SELECT COUNT(*)                                   AS loans,
           COALESCE(SUM(loan_amount), 0)              AS issued,
           COALESCE(SUM(total_due), 0)                AS due,
           COALESCE(SUM(repaid), 0)                   AS repaid,
           COALESCE(SUM(CASE WHEN total_due - repaid = 0 THEN 1 ELSE 0 END), 0) AS fully_paid,
           COALESCE(SUM(CASE WHEN total_due - repaid > 0 THEN 1 ELSE 0 END), 0) AS outstanding_loans
    FROM (SELECT l.loan_amount, l.total_due,
                 COALESCE((SELECT SUM(amount) FROM repayments WHERE loan_id = l.id), 0) AS repaid
          FROM loans l)`).get();
  const recent = db.prepare(`
    SELECT r.id, r.amount, r.payment_reference, r.payment_date, l.loan_reference, c.full_name AS client_name
    FROM repayments r JOIN loans l ON l.id = r.loan_id JOIN clients c ON c.id = l.client_id
    ORDER BY r.payment_date DESC, r.id DESC LIMIT 5`).all();
  return {
    total_clients: clients,
    total_loans: t.loans,
    total_loan_amount_issued: t.issued,
    total_amount_due: t.due,
    total_repayments_received: t.repaid,
    total_outstanding_balance: t.due - t.repaid,
    fully_paid_loans: t.fully_paid,
    outstanding_loans: t.outstanding_loans,
    recent_repayments: recent,
  };
}

module.exports = { getDashboard };
