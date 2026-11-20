// Routes only translate HTTP <-> service calls. Business rules live in backend/services.
const express = require('express');
const { requireAuth, requireRole, requirePasswordChangeComplete } = require('../middleware/auth');
const clients = require('../services/clientService');
const loans = require('../services/loanService');
const repayments = require('../services/repaymentService');
const dashboard = require('../services/dashboardService');
const auth = require('../services/authService');
const loanRequests = require('../services/loanRequestService');
const clientSpreadsheets = require('../services/clientSpreadsheetService');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

module.exports = function buildRouter(db) {
  const router = express.Router();

  // ---- public ----
  router.get('/health', (req, res) => ok(res, { status: 'ok' }));
  router.post('/auth/login', (req, res) => ok(res, auth.login(db, req.body.username || req.body.email, req.body.password)));
  router.post('/auth/register', (req, res) => ok(res, auth.registerClient(db, req.body), 201));

  // ---- authenticated accounts ----
  router.use(requireAuth);
  router.get('/auth/me', (req, res) => ok(res, {
    id: req.user.sub,
    username: req.user.username,
    role: req.user.role,
    client_id: req.user.client_id || null,
    must_change_password: Boolean(req.user.must_change_password),
  }));
  router.post('/auth/change-password', (req, res) => ok(res, auth.changePassword(db, req.user.sub, req.body.password)));
  router.use(requirePasswordChangeComplete);

  // ---- client portal: clients can only access their own account ----
  router.get('/client/profile', requireRole('client'), (req, res) =>
    ok(res, clients.getClientWithLoans(db, req.user.client_id)));
  router.get('/client/loan-requests', requireRole('client'), (req, res) =>
    ok(res, loanRequests.listForClient(db, req.user.client_id)));
  router.post('/client/loan-requests', requireRole('client'), (req, res) =>
    ok(res, loanRequests.createRequest(db, req.user.client_id, req.body), 201));

  // ---- staff-only routes ----
  router.use(requireRole('admin'));
  router.get('/admin/loan-requests', (req, res) =>
    ok(res, loanRequests.listForAdmin(db, req.query.status)));
  router.post('/admin/loan-requests/:id/approve', (req, res) =>
    ok(res, loanRequests.approveRequest(db, req.params.id, req.user.sub, req.body)));
  router.post('/admin/loan-requests/:id/reject', (req, res) =>
    ok(res, loanRequests.rejectRequest(db, req.params.id, req.user.sub, req.body)));

  router.post('/clients/import', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const result = await clientSpreadsheets.importClients(db, req.body.file_name, req.body.data);
    ok(res, result, 201);
  });
  router.get('/clients/export', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    if (req.query.format === 'csv') {
      res.type('text/csv; charset=utf-8').attachment('clients.csv').send(clientSpreadsheets.exportCsv(db));
    } else if (req.query.format === 'xlsx') {
      const workbook = await clientSpreadsheets.exportXlsx(db);
      res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .attachment('clients.xlsx').send(workbook);
    } else {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'format must be csv or xlsx.' } });
    }
  });
  router.post('/clients', (req, res) => ok(res, clients.createClient(db, req.body), 201));
  router.get('/clients', (req, res) => ok(res, clients.listClients(db, { search: req.query.search })));
  router.get('/clients/:id', (req, res) => ok(res, clients.getClientWithLoans(db, req.params.id)));

  router.post('/loans', (req, res) => ok(res, loans.createLoan(db, req.body), 201));
  router.get('/loans', (req, res) => ok(res, loans.listLoans(db, { search: req.query.search, status: req.query.status })));
  router.get('/loans/:id', (req, res) => ok(res, loans.getLoanDetails(db, req.params.id)));
  router.get('/loans/:id/repayments', (req, res) => ok(res, loans.getLoanRepayments(db, req.params.id)));

  router.post('/repayments', (req, res) => ok(res, repayments.recordRepayment(db, req.body), 201));
  router.get('/repayments', (req, res) => ok(res, repayments.listAllRepayments(db)));

  router.get('/dashboard', (req, res) => ok(res, dashboard.getDashboard(db)));
  return router;
};
