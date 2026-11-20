// Shared SQL for "a loan plus how much has been repaid". Balances are ALWAYS computed
// here from the repayments table - they are never stored or accepted from the frontend.
const LOAN_SUMMARY_SQL = `
  SELECT l.id, l.loan_reference, l.client_id, c.client_number, c.full_name AS client_name,
         l.loan_amount, l.total_due, l.created_at,
         COALESCE(r.total_repaid, 0)                 AS total_repaid,
         l.total_due - COALESCE(r.total_repaid, 0)   AS outstanding_balance
  FROM loans l
  JOIN clients c ON c.id = l.client_id
  LEFT JOIN (SELECT loan_id, SUM(amount) AS total_repaid FROM repayments GROUP BY loan_id) r
         ON r.loan_id = l.id`;

const withStatus = (loan) =>
  loan && { ...loan, status: loan.outstanding_balance === 0 ? 'Fully Paid' : 'Outstanding' };

module.exports = { LOAN_SUMMARY_SQL, withStatus };
