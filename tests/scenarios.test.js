// The three MANDATORY practical scenarios from the assessment.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, makeLoan, repay } = require('./helpers');

test('Scenario 1: successful repayment - KES 10,000 balance, pay 3,000 -> balance 7,000', async () => {
  const { api } = await setup();
  const loan = await makeLoan(api, { loan_amount: 10000 });
  assert.equal(loan.outstanding_balance, 10000);

  const res = await repay(api, loan, 3000, 'MPESA-S1');
  assert.equal(res.status, 201);
  assert.equal(res.body.data.repayment.amount, 3000);
  assert.equal(res.body.data.loan.outstanding_balance, 7000);

  const check = await api.get(`/api/loans/${loan.id}`);
  assert.equal(check.body.data.outstanding_balance, 7000);
  assert.equal(check.body.data.total_repaid, 3000);
  assert.equal(check.body.data.repayments.length, 1);
});

test('Scenario 2: duplicate payment reference - second one rejected, no duplicate, balance correct', async () => {
  const { api, db } = await setup();
  const loan = await makeLoan(api, { loan_amount: 10000 });

  const first = await repay(api, loan, 3000, 'MPESA-DUP');
  assert.equal(first.status, 201);
  const second = await repay(api, loan, 3000, 'MPESA-DUP');
  assert.equal(second.status, 409);
  assert.equal(second.body.success, false);

  const history = await api.get(`/api/loans/${loan.id}/repayments`);
  assert.equal(history.body.data.repayments.length, 1);          // no duplicate transaction
  assert.equal(history.body.data.loan.outstanding_balance, 7000); // balance still correct
  assert.equal(db.prepare('SELECT COUNT(*) n FROM repayments').get().n, 1);
});

test('Scenario 3: excessive repayment - balance 1,000, pay 1,500 -> rejected, nothing saved', async () => {
  const { api, db } = await setup();
  const loan = await makeLoan(api, { loan_amount: 1000 });

  const res = await repay(api, loan, 1500, 'MPESA-S3');
  assert.equal(res.status, 422);
  assert.equal(res.body.success, false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM repayments').get().n, 0);   // no repayment saved
  const check = await api.get(`/api/loans/${loan.id}`);
  assert.equal(check.body.data.outstanding_balance, 1000);                    // still KES 1,000
});
