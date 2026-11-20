const { parseKes, parseId, parseText } = require('../utils/validators');
const { AppError, notFound, conflict, validation } = require('../utils/errors');
const { createLoan } = require('./loanService');

function requestSelect(where = '') {
  return `SELECT r.id, r.client_id, r.requested_amount, r.purpose, r.status, r.review_note,
                 r.loan_id, r.created_at, r.reviewed_at, c.client_number, c.full_name AS client_name,
                 c.email AS client_email, l.loan_reference
          FROM loan_requests r JOIN clients c ON c.id = r.client_id
          LEFT JOIN loans l ON l.id = r.loan_id ${where}`;
}

function createRequest(db, clientId, input) {
  const amount = parseKes(input.requested_amount, 'Requested amount');
  const purpose = parseText(input.purpose, 'Loan purpose', { min: 3, max: 500 });
  if (!db.prepare('SELECT 1 FROM clients WHERE id = ?').get(clientId)) {
    throw new AppError(403, 'FORBIDDEN', 'This account is not linked to a client profile.');
  }
  const id = db.prepare('INSERT INTO loan_requests (client_id, requested_amount, purpose) VALUES (?, ?, ?)')
    .run(clientId, amount, purpose).lastInsertRowid;
  return db.prepare(`${requestSelect('WHERE r.id = ?')}`).get(id);
}

function listForClient(db, clientId) {
  return db.prepare(`${requestSelect('WHERE r.client_id = ? ORDER BY r.id DESC')}`).all(clientId);
}

function listForAdmin(db, status) {
  if (status && !['pending', 'approved', 'rejected'].includes(status)) {
    throw validation('status must be pending, approved, or rejected.');
  }
  const where = status ? 'WHERE r.status = ? ORDER BY r.id DESC' : 'ORDER BY r.id DESC';
  return db.prepare(`${requestSelect(where)}`).all(...(status ? [status] : []));
}

function approveRequest(db, rawId, reviewerId, input) {
  const id = parseId(rawId, 'Request id');
  const request = db.prepare('SELECT id, client_id, status FROM loan_requests WHERE id = ?').get(id);
  if (!request) throw notFound('Loan request not found.');
  if (request.status !== 'pending') throw conflict('This loan request has already been reviewed.');
  const amount = parseKes(input.loan_amount, 'Approved loan amount');
  const totalDue = parseKes(input.total_due, 'Total amount due');
  if (totalDue < amount) throw validation('Total amount due cannot be less than the approved loan amount.');
  const note = input.review_note ? parseText(input.review_note, 'Review note', { max: 500 }) : null;

  const approve = db.transaction(() => {
    const current = db.prepare('SELECT status FROM loan_requests WHERE id = ?').get(id);
    if (!current) throw notFound('Loan request not found.');
    if (current.status !== 'pending') throw conflict('This loan request has already been reviewed.');
    const loan = createLoan(db, {
      client_id: request.client_id,
      loan_amount: amount,
      total_due: totalDue,
      created_at: input.created_at,
    });
    const updated = db.prepare(`UPDATE loan_requests
                SET status = 'approved', review_note = ?, reviewed_by = ?, loan_id = ?, reviewed_at = datetime('now')
                WHERE id = ? AND status = 'pending'`).run(note, reviewerId, loan.id, id);
    if (updated.changes !== 1) throw conflict('This loan request has already been reviewed.');
    return loan.id;
  });
  approve();
  return db.prepare(`${requestSelect('WHERE r.id = ?')}`).get(id);
}

function rejectRequest(db, rawId, reviewerId, input = {}) {
  const id = parseId(rawId, 'Request id');
  const note = input.review_note ? parseText(input.review_note, 'Review note', { max: 500 }) : null;
  const reject = db.transaction(() => {
    const request = db.prepare('SELECT id, status FROM loan_requests WHERE id = ?').get(id);
    if (!request) throw notFound('Loan request not found.');
    if (request.status !== 'pending') throw conflict('This loan request has already been reviewed.');
    const result = db.prepare(`UPDATE loan_requests
              SET status = 'rejected', review_note = ?, reviewed_by = ?, reviewed_at = datetime('now')
              WHERE id = ? AND status = 'pending'`).run(note, reviewerId, id);
    if (result.changes !== 1) throw conflict('This loan request has already been reviewed.');
  });
  reject();
  return db.prepare(`${requestSelect('WHERE r.id = ?')}`).get(id);
}

module.exports = { createRequest, listForClient, listForAdmin, approveRequest, rejectRequest };
