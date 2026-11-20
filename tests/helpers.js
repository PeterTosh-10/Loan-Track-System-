process.env.NODE_ENV = 'test';
// Test helpers: each test gets a brand-new in-memory database, so tests never affect each other.
const request = require('supertest');
const { openDatabase } = require('../backend/db/database');
const { createApp } = require('../backend/app');
const { createUser } = require('../backend/services/authService');

async function setup() {
  const db = openDatabase(':memory:');
  createUser(db, 'tester', 'test-password-123');
  const app = createApp(db);
  const login = await request(app).post('/api/auth/login').send({ username: 'tester', password: 'test-password-123' });
  const token = login.body.data.token;
  const api = {
    get: (url) => request(app).get(url).set('Authorization', `Bearer ${token}`),
    post: (url, body) => request(app).post(url).set('Authorization', `Bearer ${token}`).send(body),
  };
  return { db, app, api };
}

async function makeClient(api, extra = {}) {
  const res = await api.post('/api/clients', { full_name: 'Test Client', ...extra });
  return res.body.data;
}
async function makeLoan(api, { loan_amount = 10000, total_due = loan_amount, client } = {}) {
  const c = client || (await makeClient(api));
  const res = await api.post('/api/loans', { client_id: c.id, loan_amount, total_due });
  return res.body.data;
}
const repay = (api, loan, amount, ref, date = '2026-11-01') =>
  api.post('/api/repayments', { loan_id: loan.id, amount, payment_reference: ref, payment_date: date });

module.exports = { setup, makeClient, makeLoan, repay };
