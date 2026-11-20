/* Loan Track System - frontend (plain JavaScript, no framework).
   Sections: helpers -> API client -> pages -> router -> login/boot.
   The frontend only DISPLAYS balances the server calculated; it never computes or sends them. */
'use strict';

// ---------- small helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kes = (n) => `KES ${Number(n).toLocaleString('en-KE')}`;
const today = () => new Date().toISOString().slice(0, 10);
const badge = (s) => `<span class="badge ${s === 'Fully Paid' ? 'paid' : 'out'}">${esc(s)}</span>`;
const spinner = '<div class="loading"><span class="spinner"></span> Loading...</div>';

const ICONS = {
  dashboard: '<path d="M3 13h8V3H3zM13 21h8v-8h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  loan: '<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 10h20M6 15h4"/>',
  cash: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5C9.5 8.4 10.6 8 12 8s2.5.6 2.5 1.7c0 2.3-5 1.3-5 3.8 0 1.2 1.1 1.8 2.5 1.8s2.5-.5 2.5-1.7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

function toast(message, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast ${type === 'error' ? 'error' : ''}`;
  t.textContent = message;
  const box = $('#toasts'); box.appendChild(t);
  while (box.children.length > 3) box.firstChild.remove();   // keep at most 3 on screen
  setTimeout(() => t.remove(), 4500);
}

function debounce(fn, ms = 300) { let id; return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); }; }

// ---------- API client ----------
const session = {
  get token() { try { return sessionStorage.getItem('inuka_token'); } catch { return null; } },
  set token(v) { try { v ? sessionStorage.setItem('inuka_token', v) : sessionStorage.removeItem('inuka_token'); } catch { /* ignore */ } },
};

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json;
  try { json = await res.json(); } catch { json = null; }
  if (res.status === 401 && path !== '/auth/login') { logout(); throw new Error('Please sign in again.'); }
  if (!res.ok || !json || !json.success) throw new Error((json && json.error && json.error.message) || 'Request failed. Please try again.');
  return json.data;
}

// Wire up a form: disables the button + shows a spinner while saving, and shows server errors in the form.
function handleForm(form, onSubmit) {
  const btn = $('button[type=submit]', form);
  const label = btn.innerHTML;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving...';
    try { await onSubmit(); }
    catch (err) { showFormError(form, err.message); }   // message appears inside the form
    finally { btn.disabled = false; btn.innerHTML = label; }
  });
}
function clearErrors(form) { $('.form-banner', form)?.remove(); form.querySelectorAll('.invalid').forEach((i) => i.classList.remove('invalid')); }
function showFormError(form, msg) {
  clearErrors(form);
  const d = document.createElement('div'); d.className = 'form-banner error'; d.setAttribute('role', 'alert'); d.textContent = msg;
  form.querySelector('button[type=submit]').before(d);
}
// Light client-side check (the server re-checks everything and is the real authority).
function requireFields(form, ids) {
  let ok = true;
  ids.forEach((id) => { const el = $('#' + id, form); if (!el.value.trim()) { el.classList.add('invalid'); ok = false; } });
  if (!ok) throw new Error('Please fill in all required fields.');
}
const cleanMoney = (v) => v.replace(/[,\s]/g, '');

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

async function downloadClientFile(format) {
  const res = await fetch(`/api/clients/export?format=${format}`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  if (!res.ok) {
    let message = 'Could not download client data.';
    try { message = (await res.json()).error.message || message; } catch { /* use the default message */ }
    throw new Error(message);
  }
  downloadBlob(await res.blob(), `clients.${format}`);
}

async function fileAsBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

const tableOrEmpty = (rows, headers, rowHtml, emptyMsg) => rows.length
  ? `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th${h.startsWith('>') ? ' class="num"' : ''}>${esc(h.replace('>', ''))}</th>`).join('')}</tr></thead><tbody>${rows.map(rowHtml).join('')}</tbody></table></div>`
  : `<p class="empty">${esc(emptyMsg)}</p>`;

const repaymentRows = (withLoan) => (r) => `<tr>
  <td>${esc(r.payment_date)}</td>
  ${withLoan ? `<td><a href="#/loans/${r.loan_id}" class="mono">${esc(r.loan_reference)}</a></td><td>${esc(r.client_name)}</td>` : ''}
  <td class="mono">${esc(r.payment_reference)}</td>
  <td class="num">${kes(r.amount)}</td>
  ${r.balance_after !== undefined ? `<td class="num">${kes(r.balance_after)}</td>` : ''}</tr>`;

// ---------- pages ----------
const pages = {
  async dashboard(root) {
    const d = await api('/dashboard');
    const stat = (cls, ico, label, value) => `<div class="card stat ${cls}"><div class="ico">${icon(ico)}</div><div><div class="label">${label}</div><div class="value">${value}</div></div></div>`;
    const due = d.total_repayments_received + d.total_outstanding_balance;
    const pct = due ? Math.round((d.total_repayments_received / due) * 100) : 0;
    root.innerHTML = `
      <div class="stats">
        ${stat('', 'users', 'Registered clients', d.total_clients)}
        ${stat('', 'loan', 'Loans registered', d.total_loans)}
        ${stat('', 'trend', 'Total loans issued', kes(d.total_loan_amount_issued))}
        ${stat('green', 'cash', 'Repayments received', kes(d.total_repayments_received))}
        ${stat('red', 'clock', 'Outstanding balance', kes(d.total_outstanding_balance))}
        ${stat('green', 'check', 'Fully paid loans', d.fully_paid_loans)}
        ${stat('red', 'clock', 'Loans with balance', d.outstanding_loans)}
      </div>
      <div class="card">
        <div class="card-head"><h2>Collection progress</h2><span class="muted">${pct}% of total amount due collected</span></div>
        <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Recent repayments</h2><a href="#/repayments" class="btn btn-secondary btn-sm">Record repayment</a></div>
        ${tableOrEmpty(d.recent_repayments, ['Date', 'Loan', 'Client', 'Reference', '>Amount'], repaymentRows(true), 'No repayments recorded yet.')}
      </div>`;
  },

  async clients(root) {
    root.innerHTML = `
      <div class="two-col">
        <div class="card">
          <div class="card-head"><h2>Register client</h2></div>
          <form id="client-form" novalidate>
            <label for="full_name">Full name *</label>
            <input id="full_name" maxlength="120" autocomplete="off" placeholder="e.g. Amina Wanjiru">
            <label for="client_number">Client number</label>
            <input id="client_number" maxlength="30" autocomplete="off" placeholder="Leave blank to auto-assign">
            <p class="hint">Must be unique. Letters, numbers and - _ / . only.</p>
            <button class="btn btn-primary btn-block" type="submit">Register client</button>
          </form>
        </div>
        <div class="card">
          <div class="card-head"><h2>All clients</h2>
            <div class="toolbar"><input id="client-search" type="search" placeholder="Search by name or client number" aria-label="Search clients"></div></div>
          <div id="client-table">${spinner}</div>
        </div>
      </div>`;
    root.insertAdjacentHTML('beforeend', `
      <div class="card">
        <div class="card-head"><h2>Client spreadsheet</h2></div>
        <p class="hint">Import a .csv or .xlsx file with columns: Client number (optional), Full name, Phone number, Email. Imports create client accounts with one-time passwords that must be changed at first sign-in. Save the credentials shown after import; they cannot be viewed again.</p>
        <div class="toolbar spreadsheet-actions">
          <label class="file-label">Choose client file <input id="client-import-file" type="file" accept=".csv,.xlsx"></label>
          <button id="client-import-button" class="btn btn-primary btn-sm" type="button">Import clients</button>
          <button class="btn btn-secondary btn-sm" type="button" data-export-format="csv">Download CSV</button>
          <button class="btn btn-secondary btn-sm" type="button" data-export-format="xlsx">Download Excel</button>
          <button id="client-template-button" class="btn btn-secondary btn-sm" type="button">Download blank CSV template</button>
        </div>
        <div id="client-import-result" class="credential-result" hidden></div>
      </div>`);
    const load = async () => {
      const q = $('#client-search').value.trim();
      const rows = await api(`/clients${q ? `?search=${encodeURIComponent(q)}` : ''}`);
      $('#client-table').innerHTML = tableOrEmpty(rows, ['Client no.', 'Name', 'Phone', 'Email', '>Loans', 'Registered', ''],
        (c) => `<tr><td class="mono">${esc(c.client_number)}</td><td>${esc(c.full_name)}</td><td>${esc(c.phone || '')}</td><td>${esc(c.email || '')}</td><td class="num">${c.loan_count}</td>
          <td>${esc(c.created_at.slice(0, 10))}</td><td class="num"><a class="btn btn-secondary btn-sm" href="#/clients/${c.id}">View</a></td></tr>`,
        q ? 'No clients match your search.' : 'No clients yet. Register the first one.');
    };
    $('#client-search').addEventListener('input', debounce(() => load().catch((e) => toast(e.message, 'error'))));
    root.querySelectorAll('[data-export-format]').forEach((button) => {
      button.addEventListener('click', () => downloadClientFile(button.dataset.exportFormat).catch((e) => toast(e.message, 'error')));
    });
    $('#client-template-button').addEventListener('click', () => {
      const csv = ['Client number,Full name,Phone number,Email'].join('\r\n') + '\r\n';
      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'client-import-template.csv');
    });
    $('#client-import-button').addEventListener('click', async () => {
      const file = $('#client-import-file').files[0];
      if (!file) { toast('Choose a CSV or Excel file first.', 'error'); return; }
      const button = $('#client-import-button');
      button.disabled = true; button.textContent = 'Importing...';
      try {
        const result = await api('/clients/import', {
          method: 'POST',
          body: { file_name: file.name, data: await fileAsBase64(file) },
        });
        const credentials = result.credentials;
        const panel = $('#client-import-result');
        panel.hidden = false;
        panel.innerHTML = `<h3>${result.imported} client account(s) created</h3>
          <p>These temporary passwords are shown only now. Download or record them and share securely; each client must change their password at first sign-in.</p>
          <button id="download-credentials" class="btn btn-secondary btn-sm" type="button">Download temporary credentials</button>
          ${tableOrEmpty(credentials, ['Client no.', 'Name', 'Email', 'Temporary password'],
            (c) => `<tr><td class="mono">${esc(c.client_number)}</td><td>${esc(c.full_name)}</td><td>${esc(c.email)}</td><td class="mono">${esc(c.temporary_password)}</td></tr>`,
            'No credentials were created.')}`;
        $('#download-credentials').addEventListener('click', () => {
          const csv = [['Client number', 'Full name', 'Email', 'Temporary password'], ...credentials.map((c) =>
            [c.client_number, c.full_name, c.email, c.temporary_password])]
            .map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
          downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'client-temporary-credentials.csv');
        });
        $('#client-import-file').value = '';
        toast(`${result.imported} client account(s) imported.`);
        await load();
      } catch (e) { toast(e.message, 'error'); }
      finally { button.disabled = false; button.textContent = 'Import clients'; }
    });
    handleForm($('#client-form'), async () => {
      requireFields($('#client-form'), ['full_name']);
      const c = await api('/clients', { method: 'POST', body: { full_name: $('#full_name').value, client_number: $('#client_number').value } });
      toast(`Client registered: ${c.client_number} - ${c.full_name}`);
      $('#client-form').reset();
      await load();
    });
    await load();
  },

  async loanRequests(root) {
    const requests = await api('/admin/loan-requests');
    root.innerHTML = requests.length ? requests.map((r) => `
      <div class="card request-card">
        <div class="card-head">
          <h2>${esc(r.client_name)} <span class="mono">${esc(r.client_number)}</span></h2>
          <span class="request-status ${esc(r.status)}">${esc(r.status)}</span>
        </div>
        <div class="kv">
          <div><div class="k">Requested</div><div class="v">${kes(r.requested_amount)}</div></div>
          <div><div class="k">Email</div><div class="v">${esc(r.client_email)}</div></div>
          <div><div class="k">Submitted</div><div class="v">${esc(r.created_at)}</div></div>
          ${r.loan_reference ? `<div><div class="k">Issued loan</div><div class="v mono">${esc(r.loan_reference)}</div></div>` : ''}
        </div>
        <p><b>Purpose:</b> ${esc(r.purpose)}</p>
        ${r.review_note ? `<p><b>Staff note:</b> ${esc(r.review_note)}</p>` : ''}
        ${r.status === 'pending' ? `<form class="request-review-form" data-request-id="${r.id}">
          <div class="review-fields">
            <div><label>Approved loan amount (KES)</label><input class="approved-amount" inputmode="numeric" value="${r.requested_amount}" required></div>
            <div><label>Total amount due (KES)</label><input class="approved-total" inputmode="numeric" value="${r.requested_amount}" required></div>
            <div><label>Loan date</label><input class="approved-date" type="date" value="${today()}"></div>
            <div><label>Staff note</label><input class="review-note" maxlength="500" placeholder="Optional"></div>
          </div>
          <div class="toolbar review-actions">
            <button class="btn btn-primary btn-sm" type="submit" data-action="approve">Approve and issue loan</button>
            <button class="btn btn-secondary btn-sm" type="submit" data-action="reject">Reject request</button>
          </div>
        </form>` : ''}
      </div>`).join('') : '<div class="card"><p class="empty">No loan requests yet.</p></div>';
    root.querySelectorAll('.request-review-form').forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const action = event.submitter?.dataset.action;
        if (!action) return;
        const buttons = form.querySelectorAll('button');
        buttons.forEach((button) => { button.disabled = true; });
        try {
          const body = { review_note: $('.review-note', form).value.trim() };
          if (action === 'approve') {
            body.loan_amount = cleanMoney($('.approved-amount', form).value);
            body.total_due = cleanMoney($('.approved-total', form).value);
            body.created_at = $('.approved-date', form).value || undefined;
          }
          await api(`/admin/loan-requests/${form.dataset.requestId}/${action}`, { method: 'POST', body });
          toast(action === 'approve' ? 'Request approved and loan issued.' : 'Loan request rejected.');
          await pages.loanRequests(root);
        } catch (e) { toast(e.message, 'error'); buttons.forEach((button) => { button.disabled = false; }); }
      });
    });
  },

  async clientHome(root) {
    const [client, requests] = await Promise.all([api('/client/profile'), api('/client/loan-requests')]);
    root.innerHTML = `
      <div class="card">
        <div class="card-head"><h2>My account</h2><span class="mono">${esc(client.client_number)}</span></div>
        <div class="kv">
          <div><div class="k">Name</div><div class="v">${esc(client.full_name)}</div></div>
          <div><div class="k">Email</div><div class="v">${esc(client.email)}</div></div>
          <div><div class="k">Phone</div><div class="v">${esc(client.phone)}</div></div>
        </div>
      </div>
      <div class="two-col card-row">
        <div class="card">
          <div class="card-head"><h2>Request a loan</h2></div>
          <form id="client-request-form" novalidate>
            <label for="request-amount">Requested amount (KES) *</label>
            <input id="request-amount" inputmode="numeric" autocomplete="off" placeholder="e.g. 50000">
            <label for="request-purpose">Purpose *</label>
            <textarea id="request-purpose" rows="4" maxlength="500" placeholder="Briefly explain why you need the loan"></textarea>
            <p class="hint">Your request is not a loan until staff review and issue it.</p>
            <button class="btn btn-primary btn-block" type="submit">Submit request</button>
          </form>
        </div>
        <div class="card">
          <div class="card-head"><h2>My requests</h2></div>
          ${tableOrEmpty(requests, ['Submitted', '>Requested', 'Purpose', 'Status', 'Staff note', 'Loan'],
            (r) => `<tr><td>${esc(r.created_at)}</td><td class="num">${kes(r.requested_amount)}</td><td>${esc(r.purpose)}</td>
              <td><span class="request-status ${esc(r.status)}">${esc(r.status)}</span></td><td>${esc(r.review_note || '')}</td>
              <td class="mono">${esc(r.loan_reference || '')}</td></tr>`, 'You have not submitted any loan requests.') }
        </div>
      </div>
      <div class="card"><div class="card-head"><h2>My loans</h2></div>
        ${tableOrEmpty(client.loans, ['Reference', 'Date', '>Loan amount', '>Total due', '>Repaid', '>Outstanding', 'Status'],
          (l) => `<tr><td class="mono">${esc(l.loan_reference)}</td><td>${esc(l.created_at)}</td><td class="num">${kes(l.loan_amount)}</td>
            <td class="num">${kes(l.total_due)}</td><td class="num">${kes(l.total_repaid)}</td>
            <td class="num"><b>${kes(l.outstanding_balance)}</b></td><td>${badge(l.status)}</td></tr>`, 'No loans have been issued to you yet.')}
      </div>`;
    handleForm($('#client-request-form'), async () => {
      requireFields($('#client-request-form'), ['request-amount', 'request-purpose']);
      const amount = cleanMoney($('#request-amount').value);
      if (!/^\d+$/.test(amount)) throw new Error('Requested amount must be a whole number of Kenyan shillings.');
      await api('/client/loan-requests', {
        method: 'POST',
        body: { requested_amount: amount, purpose: $('#request-purpose').value },
      });
      toast('Loan request sent to staff for review.');
      await pages.clientHome(root);
    });
  },

  async clientDetail(root, id) {
    const c = await api(`/clients/${id}`);
    const paid = c.loans.reduce((s, l) => s + l.total_repaid, 0);
    const owed = c.loans.reduce((s, l) => s + l.outstanding_balance, 0);
    root.innerHTML = `
      <p><a href="#/clients">&larr; Back to clients</a></p>
      <div class="card">
        <div class="card-head"><h2>${esc(c.full_name)}</h2><a class="btn btn-primary btn-sm" href="#/loans?client=${c.id}">New loan</a></div>
        <div class="kv">
          <div><div class="k">Client number</div><div class="v mono">${esc(c.client_number)}</div></div>
          <div><div class="k">Registered</div><div class="v">${esc(c.created_at.slice(0, 10))}</div></div>
          <div><div class="k">Loans</div><div class="v">${c.loans.length}</div></div>
          <div><div class="k">Total repaid</div><div class="v">${kes(paid)}</div></div>
          <div><div class="k">Outstanding</div><div class="v big">${kes(owed)}</div></div>
        </div>
      </div>
      <div class="card"><div class="card-head"><h2>Loans</h2></div>
        ${tableOrEmpty(c.loans, ['Reference', 'Date', '>Loan amount', '>Total due', '>Repaid', '>Outstanding', 'Status', ''], loanRow(false), 'This client has no loans yet.')}
      </div>`;
  },

  async loans(root, query) {
    const [clients] = await Promise.all([api('/clients')]);
    const preselect = query.get('client') || '';
    root.innerHTML = `
      <div class="two-col">
        <div class="card">
          <div class="card-head"><h2>Register loan</h2></div>
          <form id="loan-form" novalidate>
            <label for="client_id">Client *</label>
            <select id="client_id"><option value="">Select a client...</option>
              ${clients.map((c) => `<option value="${c.id}" ${String(c.id) === preselect ? 'selected' : ''}>${esc(c.client_number)} - ${esc(c.full_name)}</option>`).join('')}
            </select>
            <label for="loan_amount">Original loan amount (KES) *</label>
            <input id="loan_amount" inputmode="numeric" autocomplete="off" placeholder="e.g. 50000">
            <label for="total_due">Total amount due (KES) *</label>
            <input id="total_due" inputmode="numeric" autocomplete="off" placeholder="e.g. 56000">
            <p class="hint">Amount the client must repay in total. Cannot be less than the loan amount. Whole shillings only.</p>
            <label for="created_at">Loan date</label>
            <input id="created_at" type="date" value="${today()}">
            <p class="hint">A unique loan reference is generated automatically.</p>
            <button class="btn btn-primary btn-block" type="submit">Create loan</button>
          </form>
        </div>
        <div class="card">
          <div class="card-head"><h2>All loans</h2>
            <div class="toolbar">
              <input id="loan-search" type="search" placeholder="Search reference or client" aria-label="Search loans">
              <select id="loan-status" aria-label="Filter by status"><option value="">All statuses</option><option value="outstanding">Outstanding</option><option value="paid">Fully paid</option></select>
            </div></div>
          <div id="loan-table">${spinner}</div>
        </div>
      </div>`;
    const load = async () => {
      const p = new URLSearchParams();
      if ($('#loan-search').value.trim()) p.set('search', $('#loan-search').value.trim());
      if ($('#loan-status').value) p.set('status', $('#loan-status').value);
      const rows = await api(`/loans${p.toString() ? `?${p}` : ''}`);
      $('#loan-table').innerHTML = tableOrEmpty(rows, ['Reference', 'Client', '>Loan amount', '>Total due', '>Repaid', '>Outstanding', 'Status', ''], loanRow(true), 'No loans found.');
    };
    const reload = () => load().catch((e) => toast(e.message, 'error'));
    $('#loan-search').addEventListener('input', debounce(reload));
    $('#loan-status').addEventListener('change', reload);
    const form = $('#loan-form');
    $('#loan_amount').addEventListener('blur', () => { if (!$('#total_due').value) $('#total_due').placeholder = `At least ${$('#loan_amount').value || '...'}`; });
    handleForm(form, async () => {
      requireFields(form, ['client_id', 'loan_amount', 'total_due']);
      const loan = await api('/loans', { method: 'POST', body: {
        client_id: Number($('#client_id').value), loan_amount: cleanMoney($('#loan_amount').value),
        total_due: cleanMoney($('#total_due').value), created_at: $('#created_at').value || undefined } });
      toast(`Loan ${loan.loan_reference} created for ${loan.client_name}`);
      form.reset(); $('#created_at').value = today();
      await load();
    });
    await load();
  },

  async loanDetail(root, id) {
    const l = await api(`/loans/${id}`);
    const pct = Math.min(100, Math.round((l.total_repaid / l.total_due) * 100));
    root.innerHTML = `
      <p><a href="#/loans">&larr; Back to loans</a></p>
      <div class="card">
        <div class="card-head"><h2><span class="mono">${esc(l.loan_reference)}</span> ${badge(l.status)}</h2>
          ${l.outstanding_balance > 0 ? `<a class="btn btn-primary btn-sm" href="#/repayments?loan=${l.id}">Record repayment</a>` : ''}</div>
        <div class="kv">
          <div><div class="k">Client</div><div class="v"><a href="#/clients/${l.client_id}">${esc(l.client_name)}</a></div></div>
          <div><div class="k">Client number</div><div class="v mono">${esc(l.client_number)}</div></div>
          <div><div class="k">Loan date</div><div class="v">${esc(l.created_at)}</div></div>
          <div><div class="k">Original loan amount</div><div class="v">${kes(l.loan_amount)}</div></div>
          <div><div class="k">Total amount due</div><div class="v">${kes(l.total_due)}</div></div>
          <div><div class="k">Total repaid</div><div class="v">${kes(l.total_repaid)}</div></div>
          <div><div class="k">Outstanding balance</div><div class="v big">${kes(l.outstanding_balance)}</div></div>
        </div>
        <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
      </div>
      <div class="card"><div class="card-head"><h2>Repayment history</h2><span class="muted">${l.repayments.length} payment(s)</span></div>
        ${tableOrEmpty(l.repayments, ['Date', 'Reference', '>Amount', '>Balance after'], repaymentRows(false), 'No repayments recorded for this loan yet.')}
      </div>`;
  },

  async repayments(root, query) {
    const [loans] = await Promise.all([api('/loans?status=outstanding')]);
    const byId = new Map(loans.map((l) => [String(l.id), l]));
    const preselect = query.get('loan') || '';
    root.innerHTML = `
      <div class="two-col">
        <div class="card">
          <div class="card-head"><h2>Record repayment</h2></div>
          <form id="pay-form" novalidate>
            <label for="loan-filter">Find loan</label>
            <input id="loan-filter" type="search" placeholder="Type reference or client name" autocomplete="off">
            <label for="loan_id">Loan *</label>
            <select id="loan_id"></select>
            <div id="loan-preview" class="preview" hidden></div>
            <label for="amount">Repayment amount (KES) *</label>
            <input id="amount" inputmode="numeric" autocomplete="off" placeholder="e.g. 3000">
            <label for="payment_reference">Payment reference *</label>
            <input id="payment_reference" autocomplete="off" maxlength="50" placeholder="e.g. MPESA-QK81A2">
            <p class="hint">Must be unique across the whole system.</p>
            <label for="payment_date">Payment date *</label>
            <input id="payment_date" type="date" value="${today()}">
            <button class="btn btn-primary btn-block" type="submit">Save repayment</button>
          </form>
        </div>
        <div class="card">
          <div class="card-head"><h2>Repayment history</h2></div>
          <div id="pay-table">${spinner}</div>
        </div>
      </div>`;
    const select = $('#loan_id');
    const fillOptions = (keep) => {
      const f = $('#loan-filter').value.trim().toLowerCase();
      const list = loans.filter((l) => !f || `${l.loan_reference} ${l.client_name} ${l.client_number}`.toLowerCase().includes(f));
      select.innerHTML = `<option value="">${list.length ? 'Select a loan...' : 'No outstanding loans match'}</option>` +
        list.map((l) => `<option value="${l.id}">${esc(l.loan_reference)} - ${esc(l.client_name)} (owes ${kes(l.outstanding_balance)})</option>`).join('');
      if (keep && list.some((l) => String(l.id) === keep)) select.value = keep;
      showPreview();
    };
    // Preview is for convenience only - the server recalculates and enforces everything.
    const showPreview = () => {
      const l = byId.get(select.value); const box = $('#loan-preview');
      if (!l) { box.hidden = true; return; }
      const amt = Number(cleanMoney($('#amount').value));
      const over = Number.isSafeInteger(amt) && amt > l.outstanding_balance;
      const after = Number.isSafeInteger(amt) && amt > 0
        ? (over ? ' &middot; <b>this amount is more than the outstanding balance</b>' : ` &middot; after this payment: <b>${kes(l.outstanding_balance - amt)}</b>`) : '';
      box.hidden = false; box.classList.toggle('warn', over);
      box.innerHTML = `${esc(l.client_name)} &middot; total due <b>${kes(l.total_due)}</b> &middot; outstanding <b>${kes(l.outstanding_balance)}</b>${after}`;
    };
    $('#loan-filter').addEventListener('input', () => fillOptions(select.value));
    select.addEventListener('change', showPreview);
    $('#amount').addEventListener('input', showPreview);
    fillOptions(preselect);

    const loadHistory = async () => {
      const rows = await api('/repayments');
      $('#pay-table').innerHTML = tableOrEmpty(rows, ['Date', 'Loan', 'Client', 'Reference', '>Amount', '>Balance after'], repaymentRows(true), 'No repayments recorded yet.');
    };
    const form = $('#pay-form');
    handleForm(form, async () => {
      requireFields(form, ['loan_id', 'amount', 'payment_reference', 'payment_date']);
      const res = await api('/repayments', { method: 'POST', body: {
        loan_id: Number(select.value), amount: cleanMoney($('#amount').value),
        payment_reference: $('#payment_reference').value, payment_date: $('#payment_date').value } });
      const { loan } = res;
      toast(`Saved ${kes(res.repayment.amount)} for ${loan.loan_reference}. Outstanding: ${kes(loan.outstanding_balance)}${loan.outstanding_balance === 0 ? ' - Fully paid!' : ''}`);
      // refresh local loan list from the server's answer
      if (loan.outstanding_balance === 0) byId.delete(String(loan.id)); else byId.set(String(loan.id), loan);
      loans.length = 0; loans.push(...byId.values());
      $('#amount').value = ''; $('#payment_reference').value = '';
      fillOptions(loan.outstanding_balance === 0 ? '' : String(loan.id));
      await loadHistory();
    });
    await loadHistory();
  },
};

function loanRow(showClient) {
  return (l) => `<tr>
    <td><a class="mono" href="#/loans/${l.id}">${esc(l.loan_reference)}</a></td>
    ${showClient ? `<td><a href="#/clients/${l.client_id}">${esc(l.client_name)}</a></td>` : `<td>${esc(l.created_at)}</td>`}
    <td class="num">${kes(l.loan_amount)}</td><td class="num">${kes(l.total_due)}</td>
    <td class="num">${kes(l.total_repaid)}</td><td class="num"><b>${kes(l.outstanding_balance)}</b></td>
    <td>${badge(l.status)}</td><td class="num"><a class="btn btn-secondary btn-sm" href="#/loans/${l.id}">Details</a></td></tr>`;
}

// ---------- router ----------
const ADMIN_NAV = [
  { hash: '#/dashboard', title: 'Dashboard', icon: 'dashboard' },
  { hash: '#/clients', title: 'Clients', icon: 'users' },
  { hash: '#/loanRequests', title: 'Loan requests', icon: 'clock' },
  { hash: '#/loans', title: 'Loans', icon: 'loan' },
  { hash: '#/repayments', title: 'Repayments', icon: 'cash' },
];
const CLIENT_NAV = [{ hash: '#/clientHome', title: 'My account', icon: 'users' }];
let currentUser = null;
let currentNav = ADMIN_NAV;

function buildNav() {
  currentNav = currentUser && currentUser.role === 'client' ? CLIENT_NAV : ADMIN_NAV;
  $('#nav').innerHTML = currentNav.map((n) => `<a href="${n.hash}" data-hash="${n.hash}">${icon(n.icon)}<span>${n.title}</span></a>`).join('');
  $('#menu-btn').innerHTML = icon('menu');
}

let navToken = 0;   // guards against a slow page finishing after the user already moved on
async function route() {
  if (!session.token) return showLogin();
  const [path, qs] = (location.hash || '#/dashboard').split('?');
  const query = new URLSearchParams(qs || '');
  const parts = path.replace('#/', '').split('/');
  let title, section, run;
  if (currentUser && currentUser.role === 'client') {
    if (parts[0] !== 'clientHome') { location.hash = '#/clientHome'; return; }
    title = 'My account'; section = 'clientHome'; run = (r) => pages.clientHome(r);
  } else if (parts[0] === 'clients' && parts[1]) { title = 'Client details'; section = 'clients'; run = (r) => pages.clientDetail(r, parts[1]); }
  else if (parts[0] === 'loans' && parts[1]) { title = 'Loan details'; section = 'loans'; run = (r) => pages.loanDetail(r, parts[1]); }
  else if (pages[parts[0]] && parts[0] !== 'clientDetail' && parts[0] !== 'loanDetail') {
    if (!currentNav.some((n) => n.hash === `#/${parts[0]}`)) { location.hash = currentNav[0].hash; return; }
    section = parts[0]; title = currentNav.find((n) => n.hash === `#/${section}`).title; run = (r) => pages[section](r, query);
  } else { location.hash = '#/dashboard'; return; }

  $('#page-title').textContent = title;
  document.title = `${title} - Loan Track System`;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.hash === `#/${section}`));
  closeMenu();
  const me = ++navToken; const root = $('#page');
  root.innerHTML = spinner;
  try { await run(root); }
  catch (err) { if (me === navToken) root.innerHTML = `<div class="card"><p class="form-banner error">${esc(err.message)}</p><p><a href="#/dashboard">Back to dashboard</a></p></div>`; }
}

// ---------- login / boot ----------
function closeMenu() { $('#sidebar').classList.remove('open'); $('#scrim').hidden = true; }
function showLogin() {
  $('#app-view').hidden = true; $('#register-view').hidden = true; $('#password-view').hidden = true;
  $('#login-view').hidden = false; document.title = 'Sign in - Loan Track System';
}
function showRegister() {
  $('#app-view').hidden = true; $('#login-view').hidden = true; $('#password-view').hidden = true;
  $('#register-view').hidden = false; document.title = 'Create client account - Loan Track System';
}
function showPasswordChange() {
  $('#app-view').hidden = true; $('#login-view').hidden = true; $('#register-view').hidden = true;
  $('#password-view').hidden = false; document.title = 'Change password - Loan Track System';
}
function logout() { session.token = null; currentUser = null; showLogin(); }

async function boot() {
  buildNav();
  $('#menu-btn').addEventListener('click', () => { $('#sidebar').classList.add('open'); $('#scrim').hidden = false; });
  $('#scrim').addEventListener('click', closeMenu);
  $('#logout-btn').addEventListener('click', logout);
  window.addEventListener('hashchange', route);

  const form = $('#login-form');
  $('#show-register').addEventListener('click', showRegister);
  $('#show-login').addEventListener('click', showLogin);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', form); const err = $('#login-error'); err.textContent = '';
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Signing in...';
    try {
      const r = await api('/auth/login', { method: 'POST', body: { username: $('#login-username').value.trim(), password: $('#login-password').value } });
      session.token = r.token; currentUser = r.user;
      $('#login-password').value = '';
      if (r.user.must_change_password) showPasswordChange(); else enterApp();
    } catch (ex) { err.textContent = ex.message; }
    finally { btn.disabled = false; btn.textContent = 'Sign in'; }
  });

  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = $('#register-form'); const btn = $('button[type=submit]', form); const err = $('#register-error');
    err.textContent = ''; btn.disabled = true; btn.textContent = 'Creating account...';
    try {
      const r = await api('/auth/register', { method: 'POST', body: {
        full_name: $('#register-name').value,
        phone: $('#register-phone').value,
        email: $('#register-email').value,
        password: $('#register-password').value,
      } });
      session.token = r.token; currentUser = r.user; form.reset(); enterApp();
    } catch (ex) { err.textContent = ex.message; }
    finally { btn.disabled = false; btn.textContent = 'Create account'; }
  });

  $('#password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', $('#password-form')); const err = $('#password-error');
    err.textContent = '';
    const password = $('#new-password').value;
    if (password.length < 8) { err.textContent = 'Password must be at least 8 characters.'; return; }
    if (password !== $('#confirm-password').value) { err.textContent = 'The passwords do not match.'; return; }
    btn.disabled = true; btn.textContent = 'Saving...';
    try {
      const r = await api('/auth/change-password', { method: 'POST', body: { password } });
      session.token = r.token; currentUser = r.user; $('#password-form').reset(); enterApp();
    } catch (ex) { err.textContent = ex.message; }
    finally { btn.disabled = false; btn.textContent = 'Save password'; }
  });

  if (session.token) {
    try {
      currentUser = await api('/auth/me');
      if (currentUser.must_change_password) showPasswordChange(); else enterApp();
      return;
    }
    catch { /* token invalid -> login */ }
  }
  showLogin();
}
function enterApp() {
  $('#login-view').hidden = true; $('#register-view').hidden = true; $('#password-view').hidden = true;
  $('#whoami').textContent = `Signed in as ${currentUser.username}`;
  buildNav(); $('#app-view').hidden = false;
  location.hash = currentUser.role === 'client' ? '#/clientHome' : '#/dashboard';
  route();
}

boot();
