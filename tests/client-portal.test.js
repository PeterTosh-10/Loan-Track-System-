const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const ExcelJS = require('exceljs');
const { setup } = require('./helpers');

function apiFor(app, token) {
  return {
    get: (url) => request(app).get(url).set('Authorization', `Bearer ${token}`),
    post: (url, body) => request(app).post(url).set('Authorization', `Bearer ${token}`).send(body),
  };
}

async function registerClient(app, email = 'client@example.com') {
  const response = await request(app).post('/api/auth/register').send({
    full_name: 'Sample Client',
    phone: '+254 700 000 111',
    email,
    password: 'client-password-123',
  });
  assert.equal(response.status, 201);
  return { ...response.body.data, api: apiFor(app, response.body.data.token) };
}

test('clients register, request loans, and only staff can approve and issue them', async () => {
  const { app, api: staffApi } = await setup();
  const client = await registerClient(app);
  const otherClient = await registerClient(app, 'other-client@example.com');
  assert.equal(client.user.role, 'client');
  assert.equal((await client.api.get('/api/clients')).status, 403);
  assert.equal((await otherClient.api.get('/api/client/loan-requests')).body.data.length, 0);

  const submitted = await client.api.post('/api/client/loan-requests', {
    requested_amount: '25000',
    purpose: 'Small business stock',
  });

  assert.equal(submitted.status, 201);
  const id = submitted.body.data.id;
  assert.equal((await staffApi.get('/api/admin/loan-requests?status=pending')).body.data.length, 1);

  const approved = await staffApi.post(`/api/admin/loan-requests/${id}/approve`, {
    loan_amount: '20000',
    total_due: '22000',
    review_note: 'Approved with revised terms',
    created_at: '2026-11-14',
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.data.status, 'approved');
  assert.equal(approved.body.data.loan_reference, 'LN-000001');
  assert.equal((await client.api.get('/api/client/profile')).body.data.loans[0].loan_amount, 20000);
  assert.equal((await client.api.post(`/api/client/loan-requests/${id}/approve`, {})).status, 403);
  assert.equal((await staffApi.post(`/api/admin/loan-requests/${id}/approve`, {
    loan_amount: 20000, total_due: 22000,
  })).status, 409);
});

test('existing staff and client database columns migrate without losing staff access', () => {
  const fs = require('fs');
  const path = require('path');
  const Database = require('better-sqlite3');
  const { migrateExistingSchema } = require('../backend/db/database');
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_number TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO users (username, password_hash) VALUES ('oldstaff', 'hash');
    INSERT INTO clients (client_number, full_name) VALUES ('CL-OLD', 'Existing Client');`);
    db.exec(fs.readFileSync(path.join(__dirname, '..', 'backend', 'db', 'schema.sql'), 'utf8'));
    migrateExistingSchema(db);
    assert.equal(db.prepare('SELECT role FROM users WHERE username = ?').get('oldstaff').role, 'admin');
    assert.deepEqual(db.prepare('SELECT email, phone FROM clients WHERE client_number = ?').get('CL-OLD'), { email: null, phone: null });
    assert.deepEqual(db.prepare('PRAGMA table_info(users)').all().map((column) => column.name).slice(-3), ['role', 'force_password_change', 'client_id']);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'loan_requests'").get());
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_clients_email'").get());
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_users_client_id'").get());
  } finally { db.close(); }
});

test('staff can reject a request without issuing a loan', async () => {
  const { app, api: staffApi, db } = await setup();
  const client = await registerClient(app);
  const submitted = await client.api.post('/api/client/loan-requests', {
    requested_amount: 10000,
    purpose: 'Emergency repairs',
  });
  const rejected = await staffApi.post(`/api/admin/loan-requests/${submitted.body.data.id}/reject`, {
    review_note: 'Please provide additional information.',
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.data.status, 'rejected');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM loans').get().n, 0);
});

test('CSV import creates one-time client accounts and requires a password change', async () => {
  const { app, api: staffApi } = await setup();
  const csv = 'Client number,Full name,Phone number,Email\r\nCL-901,Imported Client,+254700000222,imported@example.com\r\n';
  const imported = await staffApi.post('/api/clients/import', {
    file_name: 'clients.csv',
    data: Buffer.from(csv).toString('base64'),
  });
  assert.equal(imported.status, 201);
  assert.equal(imported.headers['cache-control'], 'no-store');
  assert.equal(imported.body.data.imported, 1);
  const credential = imported.body.data.credentials[0];
  assert.equal(credential.client_number, 'CL-901');
  assert.ok(credential.temporary_password.length >= 20);

  const login = await request(app).post('/api/auth/login').send({
    email: credential.email,
    password: credential.temporary_password,
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.data.user.must_change_password, true);
  const temporaryApi = apiFor(app, login.body.data.token);
  const blocked = await temporaryApi.get('/api/client/profile');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'PASSWORD_CHANGE_REQUIRED');

  const changed = await temporaryApi.post('/api/auth/change-password', { password: 'permanent-password-456' });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.data.user.must_change_password, false);
  assert.equal((await apiFor(app, changed.body.data.token).get('/api/client/profile')).status, 200);
  assert.equal((await request(app).post('/api/auth/login').send({
    email: credential.email, password: credential.temporary_password,
  })).status, 401);
});

test('client import rolls back earlier rows when a later row conflicts with existing data', async () => {
  const { api, db } = await setup();
  await api.post('/api/clients', { client_number: 'CL-802', full_name: 'Existing Client' });
  const csv = [
    'Client number,Full name,Phone number,Email',
    'CL-801,First Client,0700000101,first@example.com',
    'CL-801,Second Client,0700000102,second@example.com',
  ].join('\r\n');
  const result = await api.post('/api/clients/import', {
    file_name: 'conflict.csv',
    data: Buffer.from(csv).toString('base64'),
  });
  assert.equal(result.status, 400);
  assert.match(result.body.error.message, /row 3.*already in use/i);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM clients').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
});

test('importing an existing client number updates the profile and provisions its account', async () => {
  const { api, db } = await setup();
  const existing = await api.post('/api/clients', {
    client_number: 'CL-500',
    full_name: 'Old Client Name',
  });
  const csv = 'Client number,Full name,Phone number,Email\r\nCL-500,Updated Client Name,0700000500,existing@example.com\r\n';
  const imported = await api.post('/api/clients/import', {
    file_name: 'existing-client.csv',
    data: Buffer.from(csv).toString('base64'),
  });
  assert.equal(imported.status, 201);
  assert.equal(imported.body.data.imported, 1);
  const updated = db.prepare('SELECT id, full_name, phone, email FROM clients WHERE client_number = ?').get('CL-500');
  assert.equal(updated.id, existing.body.data.id);
  assert.equal(updated.full_name, 'Updated Client Name');
  assert.equal(updated.phone, '0700000500');
  assert.equal(updated.email, 'existing@example.com');
});

test('Excel import and CSV/Excel exports include client fields but never passwords', async () => {
  const { api } = await setup();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Clients');
  sheet.addRow(['Client number', 'Full name', 'Phone number', 'Email']);
  sheet.addRow(['CL-701', 'Excel Client', '0700000701', 'excel@example.com']);
  sheet.addRow(['CL-702', '=1+1', '0700000702', 'formula@example.com']);
  const upload = await workbook.xlsx.writeBuffer();
  const imported = await api.post('/api/clients/import', {
    file_name: 'clients.xlsx',
    data: Buffer.from(upload).toString('base64'),
  });
  assert.equal(imported.status, 201);

  const csv = await api.get('/api/clients/export?format=csv');
  assert.equal(csv.status, 200);
  assert.equal(csv.headers['cache-control'], 'private, no-store');
  assert.match(csv.text, /Excel Client/);
  assert.match(csv.text, /excel@example\.com/);
  assert.match(csv.text, /"'=1\+1"/);
  assert.doesNotMatch(csv.text, /temporary_password/i);
  assert.doesNotMatch(csv.text, new RegExp(imported.body.data.credentials[0].temporary_password));

  const excel = await api.get('/api/clients/export?format=xlsx')
    .buffer(true)
    .parse((response, callback) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
    });
  assert.equal(excel.status, 200);
  const exportedWorkbook = new ExcelJS.Workbook();
  await exportedWorkbook.xlsx.load(excel.body);
  const rows = exportedWorkbook.worksheets[0].getRows(2, 2);
  const clientRow = rows.find((row) => row.getCell(1).value === 'CL-701');
  const formulaRow = rows.find((row) => row.getCell(1).value === 'CL-702');
  assert.equal(clientRow.getCell(2).value, 'Excel Client');
  assert.equal(clientRow.getCell(4).value, 'excel@example.com');
  const formulaCell = formulaRow.getCell(2);
  assert.equal(formulaCell.value, '=1+1');
  assert.equal(formulaCell.type, ExcelJS.ValueType.String);
});
