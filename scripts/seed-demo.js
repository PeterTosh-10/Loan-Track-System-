// `npm run seed` - optional demo data for screenshots / demonstrations. Goes through the same
// services as the API so every business rule is applied. Safe to run once on an empty database.
const config = require('../backend/config');
const { openDatabase } = require('../backend/db/database');
const { createClient } = require('../backend/services/clientService');
const { createLoan } = require('../backend/services/loanService');
const { recordRepayment } = require('../backend/services/repaymentService');

const db = openDatabase(config.dbFile);
if (db.prepare('SELECT COUNT(*) n FROM clients').get().n > 0) {
  console.log('Database already has clients - seed skipped.'); process.exit(0);
}
const names = ['Amina Wanjiru', 'Brian Otieno', 'Grace Mutua', 'Daniel Kiprop', 'Faith Achieng', 'Peter Njoroge'];
const clients = names.map((full_name) => createClient(db, { full_name }));
const mk = (i, loan_amount, total_due, created_at) => createLoan(db, { client_id: clients[i].id, loan_amount, total_due, created_at });
const l1 = mk(0, 50000, 56000, '2026-08-03');
const l2 = mk(1, 10000, 10000, '2026-09-01');
const l3 = mk(2, 120000, 132000, '2026-09-15');
const l4 = mk(3, 1000, 1000, '2026-10-02');
const l5 = mk(0, 20000, 22000, '2026-10-20');
const pay = (loan, amount, payment_reference, payment_date) => recordRepayment(db, { loan_id: loan.id, amount, payment_reference, payment_date });
pay(l1, 20000, 'MPESA-QK81A2', '2026-09-03'); pay(l1, 16000, 'MPESA-QK99B7', '2026-10-03');
pay(l2, 10000, 'MPESA-RT22C1', '2026-09-20');
pay(l3, 30000, 'BANK-000451', '2026-10-15');
pay(l5, 5000, 'MPESA-SD55X9', '2026-11-02');
console.log('Demo data created: 6 clients, 5 loans, 5 repayments.');
