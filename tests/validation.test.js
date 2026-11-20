// Additional tests: invalid amounts, nonexistent loans, duplicate clients, fully paid loans,
// loan rules, database-level protection, auth and the dashboard.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, makeClient, makeLoan, repay } = require('./helpers');

test('zero, negative, decimal and non-numeric repayment amounts are rejected', async () => {
  const { api, db } = await setup();
  const loan = await makeLoan(api, { loan_amount: 5000 });
  for (const [i, bad] of [0, -100, 10.5, 'abc', null, '', [5]].entries()) {
    const res = await repay(api, loan, bad, `BAD-${i}`);
    assert.equal(res.status, 400, `amount ${JSON.stringify(bad)} should be rejected`);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM repayments').get().n, 0);
});

test('repayment to a nonexistent loan is rejected (404) and saves nothing', async () => {
  const { api, db } = await setup();
  const res = await api.post('/api/repayments', { loan_id: 9999, amount: 100, payment_reference: 'GHOST-1', payment_date: '2026-11-01' });
  assert.equal(res.status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM repayments').get().n, 0);
});

test('repayment needs a valid payment reference and date', async () => {
  const { api } = await setup();
  const loan = await makeLoan(api);
  assert.equal((await api.post('/api/repayments', { loan_id: loan.id, amount: 100, payment_date: '2026-11-01' })).status, 400);
  assert.equal((await api.post('/api/repayments', { loan_id: loan.id, amount: 100, payment_reference: 'OK-REF', payment_date: '2026-02-31' })).status, 400);
  assert.equal((await api.post('/api/repayments', { loan_id: loan.id, amount: 100, payment_reference: 'OK-REF', payment_date: 'yesterday' })).status, 400);
});

test('payment references are unique across the whole application (different loans, any letter case)', async () => {
  const { api } = await setup();
  const a = await makeLoan(api, { loan_amount: 5000 });
  const b = await makeLoan(api, { loan_amount: 5000 });
  assert.equal((await repay(api, a, 1000, 'shared-ref')).status, 201);
  assert.equal((await repay(api, b, 1000, 'SHARED-REF')).status, 409);
});

test('duplicate client numbers are rejected; numbers are auto-assigned when omitted', async () => {
  const { api, db } = await setup();
  assert.equal((await api.post('/api/clients', { client_number: 'CL-777', full_name: 'First Person' })).status, 201);
  const dup = await api.post('/api/clients', { client_number: 'cl-777', full_name: 'Second Person' });
  assert.equal(dup.status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM clients').get().n, 1);

  const auto1 = await api.post('/api/clients', { full_name: 'Auto One' });
  const auto2 = await api.post('/api/clients', { full_name: 'Auto Two' });
  assert.notEqual(auto1.body.data.client_number, auto2.body.data.client_number);
});

test('database itself enforces unique client number (bypassing the app)', async () => {
  const { db } = await setup();
  db.prepare("INSERT INTO clients (client_number, full_name) VALUES ('X1', 'A')").run();
  assert.throws(() => db.prepare("INSERT INTO clients (client_number, full_name) VALUES ('X1', 'B')").run(), /UNIQUE/);
});

test('database itself blocks overpayment and orphan rows (triggers + foreign keys)', async () => {
  const { api, db } = await setup();
  const loan = await makeLoan(api, { loan_amount: 1000 });
  assert.throws(() => db.prepare("INSERT INTO repayments (loan_id, amount, payment_reference, payment_date) VALUES (?, 1500, 'RAW-1', '2026-11-01')").run(loan.id), /OVERPAYMENT/);
  assert.throws(() => db.prepare("INSERT INTO repayments (loan_id, amount, payment_reference, payment_date) VALUES (4242, 10, 'RAW-2', '2026-11-01')").run(), /FOREIGN KEY/);
  assert.throws(() => db.prepare("INSERT INTO repayments (loan_id, amount, payment_reference, payment_date) VALUES (?, -5, 'RAW-3', '2026-11-01')").run(loan.id), /CHECK/);
});

test('fully paid loan: balance 0, status Fully Paid, further payments rejected', async () => {
  const { api } = await setup();
  const loan = await makeLoan(api, { loan_amount: 4000 });
  assert.equal((await repay(api, loan, 1500, 'FP-1')).status, 201);
  const last = await repay(api, loan, 2500, 'FP-2');
  assert.equal(last.status, 201);
  assert.equal(last.body.data.loan.outstanding_balance, 0);
  assert.equal(last.body.data.loan.status, 'Fully Paid');

  const extra = await repay(api, loan, 1, 'FP-3');
  assert.equal(extra.status, 422);
  const detail = await api.get(`/api/loans/${loan.id}`);
  assert.equal(detail.body.data.total_repaid, 4000);
  assert.equal(detail.body.data.repayments.length, 2);
  assert.equal(detail.body.data.repayments[1].balance_after, 0);

  const paid = await api.get('/api/loans?status=paid');
  assert.equal(paid.body.data.length, 1);
  assert.equal((await api.get('/api/loans?status=outstanding')).body.data.length, 0);
});

test('total due is the amount to repay: repayments can reach total_due (loan_amount + charges)', async () => {
  const { api } = await setup();
  const loan = await makeLoan(api, { loan_amount: 10000, total_due: 11500 });
  assert.equal(loan.outstanding_balance, 11500);
  assert.equal((await repay(api, loan, 11500, 'FULL-1')).status, 201);
});

test('loan rules: total due >= loan amount, positive integers, existing client', async () => {
  const { api, db } = await setup();
  const client = await makeClient(api);
  const post = (b) => api.post('/api/loans', { client_id: client.id, ...b });
  assert.equal((await post({ loan_amount: 5000, total_due: 4999 })).status, 400);
  assert.equal((await post({ loan_amount: 0, total_due: 100 })).status, 400);
  assert.equal((await post({ loan_amount: -5, total_due: 100 })).status, 400);
  assert.equal((await post({ loan_amount: 100, total_due: 0 })).status, 400);
  assert.equal((await post({ loan_amount: 100.5, total_due: 200 })).status, 400);
  assert.equal((await post({ loan_amount: 'lots', total_due: 200 })).status, 400);
  assert.equal((await api.post('/api/loans', { client_id: 999, loan_amount: 100, total_due: 100 })).status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM loans').get().n, 0);
  assert.equal((await post({ loan_amount: 5000, total_due: 5000 })).status, 201);   // equal is allowed
});

test('loan references are generated automatically and are unique', async () => {
  const { api } = await setup();
  const client = await makeClient(api);
  const refs = new Set();
  for (let i = 0; i < 5; i++) refs.add((await api.post('/api/loans', { client_id: client.id, loan_amount: 100, total_due: 100 })).body.data.loan_reference);
  assert.equal(refs.size, 5);
});

test('multiple repayments accumulate correctly and history is ordered with running balance', async () => {
  const { api } = await setup();
  const loan = await makeLoan(api, { loan_amount: 10000, total_due: 12000 });
  await repay(api, loan, 2000, 'M-1', '2026-10-01');
  await repay(api, loan, 3000, 'M-2', '2026-10-15');
  await repay(api, loan, 500, 'M-3', '2026-11-01');
  const res = await api.get(`/api/loans/${loan.id}/repayments`);
  assert.deepEqual(res.body.data.repayments.map((r) => r.balance_after), [10000, 7000, 6500]);
  assert.equal(res.body.data.loan.total_repaid, 5500);
  assert.equal(res.body.data.loan.outstanding_balance, 6500);
});

test('client search by name and number; client detail lists their loans', async () => {
  const { api } = await setup();
  const amina = await makeClient(api, { client_number: 'CL-100', full_name: 'Amina Wanjiru' });
  await makeClient(api, { client_number: 'CL-200', full_name: 'Brian Otieno' });
  await makeLoan(api, { client: amina, loan_amount: 3000 });
  assert.equal((await api.get('/api/clients?search=amina')).body.data.length, 1);
  assert.equal((await api.get('/api/clients?search=CL-200')).body.data[0].full_name, 'Brian Otieno');
  assert.equal((await api.get('/api/clients?search=%25')).body.data.length, 0);      // % is literal, not a wildcard
  assert.equal((await api.get("/api/clients?search=' OR 1=1 --")).body.data.length, 0); // SQL injection attempt
  const detail = await api.get(`/api/clients/${amina.id}`);
  assert.equal(detail.body.data.loans.length, 1);
  assert.equal((await api.get('/api/clients/999')).status, 404);
  assert.equal((await api.get('/api/clients/abc')).status, 400);
});

test('dashboard figures match the actual records', async () => {
  const { api } = await setup();
  const l1 = await makeLoan(api, { loan_amount: 10000, total_due: 11000 });
  const l2 = await makeLoan(api, { loan_amount: 2000 });
  await repay(api, l1, 4000, 'D-1');
  await repay(api, l2, 2000, 'D-2');
  const d = (await api.get('/api/dashboard')).body.data;
  assert.equal(d.total_clients, 2);
  assert.equal(d.total_loans, 2);
  assert.equal(d.total_loan_amount_issued, 12000);
  assert.equal(d.total_repayments_received, 6000);
  assert.equal(d.total_outstanding_balance, 7000);   // (11000 + 2000) - 6000
  assert.equal(d.fully_paid_loans, 1);
  assert.equal(d.outstanding_loans, 1);
});

test('empty database dashboard shows zeros', async () => {
  const { api } = await setup();
  const d = (await api.get('/api/dashboard')).body.data;
  assert.equal(d.total_loans, 0);
  assert.equal(d.total_outstanding_balance, 0);
});

test('concurrent repayments cannot overpay a loan', async () => {
  const { api } = await setup();
  const loan = await makeLoan(api, { loan_amount: 1000 });
  const results = await Promise.all([repay(api, loan, 800, 'C-1'), repay(api, loan, 800, 'C-2'), repay(api, loan, 800, 'C-3')]);
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal((await api.get(`/api/loans/${loan.id}`)).body.data.outstanding_balance, 200);
});

test('API requires login; bad credentials and bad tokens are rejected', async () => {
  const { app } = await setup();
  assert.equal((await request(app).get('/api/dashboard')).status, 401);
  assert.equal((await request(app).get('/api/dashboard').set('Authorization', 'Bearer nonsense')).status, 401);
  assert.equal((await request(app).post('/api/auth/login').send({ username: 'tester', password: 'wrong' })).status, 401);
  assert.equal((await request(app).post('/api/auth/login').send({ username: 'nobody', password: 'x' })).status, 401);
  assert.equal((await request(app).post('/api/auth/login').send({ username: 'tester', password: 'test-password-123' })).status, 200);
  assert.equal((await request(app).get('/api/health')).status, 200);
});

test('errors are structured JSON and never leak internals', async () => {
  const { api, app, db } = await setup();
  const bad = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{not json');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.success, false);
  assert.equal((await api.get('/api/nope')).status, 404);
  db.exec('DROP TABLE repayments');                        // simulate a broken database
  const res = await api.get('/api/dashboard');
  assert.equal(res.status, 500);
  assert.ok(!/repayments|SQLITE|no such table/i.test(JSON.stringify(res.body)));
});

test('passwords are stored as bcrypt hashes, never plain text', async () => {
  const { db } = await setup();
  const row = db.prepare("SELECT password_hash FROM users WHERE username = 'tester'").get();
  assert.match(row.password_hash, /^\$2[aby]\$/);
  assert.ok(!row.password_hash.includes('test-password-123'));
});
