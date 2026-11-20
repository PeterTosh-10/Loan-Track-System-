const { parseText, parseCode, parseId, likePattern } = require('../utils/validators');
const { notFound, conflict, isUniqueViolation } = require('../utils/errors');
const { LOAN_SUMMARY_SQL, withStatus } = require('./loanQueries');

function normalizeClientInput(input) {
  const fullName = parseText(input.full_name, 'Full name', { min: 2, max: 120 });
  const phone = input.phone == null || String(input.phone).trim() === ''
    ? null : parseText(input.phone, 'Phone number', { min: 5, max: 25 });
  if (phone && !/^\+?[0-9][0-9\s().-]{4,24}$/.test(phone)) {
    throw validation('Phone number may contain digits, spaces, +, parentheses, periods, and hyphens only.');
  }
  const email = input.email == null || String(input.email).trim() === ''
    ? null : parseText(input.email, 'Email', { min: 5, max: 254 }).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw validation('Email must be a valid email address.');
  const manualNumber = input.client_number != null && String(input.client_number).trim() !== ''
    ? parseCode(String(input.client_number), 'Client number', { min: 2, max: 30 })
    : null;
  return { fullName, phone, email, manualNumber };
}

function createClient(db, input) {
  const { fullName, phone, email, manualNumber } = normalizeClientInput(input);

  const insert = db.transaction(() => {
    let clientNumber = manualNumber;
    if (!clientNumber) {
      // Auto-generate CL-0001, CL-0002 ... skipping any that were typed in manually.
      let next = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM clients').get().n;
      do { clientNumber = `CL-${String(next++).padStart(4, '0')}`; }
      while (db.prepare('SELECT 1 FROM clients WHERE client_number = ?').get(clientNumber));
    } else if (db.prepare('SELECT 1 FROM clients WHERE client_number = ?').get(clientNumber)) {
      throw conflict(`Client number ${clientNumber} already exists.`);   // application-level check
    }
    const info = db.prepare('INSERT INTO clients (client_number, full_name, phone, email) VALUES (?, ?, ?, ?)')
      .run(clientNumber, fullName, phone, email);
    return info.lastInsertRowid;
  });

  try {
    return getClientRow(db, insert());
  } catch (err) {
    // Database-level check: catches a race the application-level check cannot.
    if (isUniqueViolation(err, 'clients.client_number')) throw conflict('That client number already exists.');
    if (isUniqueViolation(err, 'clients.email')) throw conflict('A client with that email already exists.');
    throw err;
  }
}

function getClientRow(db, id) {
  return db.prepare('SELECT id, client_number, full_name, phone, email, created_at FROM clients WHERE id = ?').get(id);
}

function listClients(db, { search } = {}) {
  const base = `SELECT c.id, c.client_number, c.full_name, c.phone, c.email, c.created_at,
                       (SELECT COUNT(*) FROM loans WHERE client_id = c.id) AS loan_count
                FROM clients c`;
  if (search && String(search).trim()) {
    const p = likePattern(search);
    return db.prepare(`${base} WHERE c.client_number LIKE ? ESCAPE '\\' OR c.full_name LIKE ? ESCAPE '\\'
                       OR c.phone LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\'
                       ORDER BY c.full_name`).all(p, p, p, p);
  }
  return db.prepare(`${base} ORDER BY c.id DESC`).all();
}

function getClientWithLoans(db, rawId) {
  const id = parseId(rawId, 'Client id');
  const client = getClientRow(db, id);
  if (!client) throw notFound('Client not found.');
  const loans = db.prepare(`${LOAN_SUMMARY_SQL} WHERE l.client_id = ? ORDER BY l.id DESC`).all(id).map(withStatus);
  return { ...client, loans };
}

module.exports = { createClient, normalizeClientInput, listClients, getClientRow, getClientWithLoans };
