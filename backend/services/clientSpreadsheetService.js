const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { validation } = require('../utils/errors');
const { createClient, normalizeClientInput, getClientRow, listClients } = require('./clientService');
const bcrypt = require('bcryptjs');

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 100;
const HEADERS = ['Client number', 'Full name', 'Phone number', 'Email'];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (quoted) throw validation('The CSV file contains an unclosed quoted field.');
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function makeImportRows(rows) {
  if (!rows.length) throw validation('The import file is empty.');
  const header = rows[0].map(normalizeHeader);
  const positions = {
    client_number: header.findIndex((value) => value === 'client number'),
    full_name: header.findIndex((value) => value === 'full name'),
    phone: header.findIndex((value) => value === 'phone number' || value === 'phone'),
    email: header.findIndex((value) => value === 'email' || value === 'email address'),
  };
  for (const field of ['full_name', 'phone', 'email']) {
    if (positions[field] < 0) throw validation(`The import file must include a "${field === 'full_name' ? 'Full name' : field === 'phone' ? 'Phone number' : 'Email'}" column.`);
  }
  const records = rows.slice(1)
    .map((values, index) => ({ values, rowNumber: index + 2 }))
    .filter(({ values }) => values.some((value) => String(value ?? '').trim() !== ''));
  if (!records.length) throw validation('The import file has no client rows.');
  if (records.length > MAX_IMPORT_ROWS) throw validation(`Import at most ${MAX_IMPORT_ROWS} clients at a time.`);
  return records.map(({ values, rowNumber }) => {
    const value = (key) => positions[key] < 0 ? '' : values[positions[key]] ?? '';
    const client = {
      rowNumber,
      client_number: String(value('client_number')).trim() || undefined,
      full_name: String(value('full_name')).trim(),
      phone: String(value('phone')).trim(),
      email: String(value('email')).trim(),
    };
    for (const [field, label] of [['full_name', 'Full name'], ['phone', 'Phone number'], ['email', 'Email']]) {
      if (!client[field]) throw validation(`Row ${rowNumber}: ${label} is required.`);
    }
    return client;
  });
}

async function readImportRows(fileName, data) {
  if (typeof fileName !== 'string' || typeof data !== 'string') throw validation('Choose a CSV or Excel file to import.');
  const extension = path.extname(fileName).toLowerCase();
  if (!['.csv', '.xlsx'].includes(extension)) throw validation('Import a .csv or .xlsx file.');
  if (!/^[A-Za-z0-9._ -]{1,120}$/.test(path.basename(fileName))) throw validation('The import file name is invalid.');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
    throw validation('The uploaded file is not valid base64 data.');
  }
  const buffer = Buffer.from(data, 'base64');
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) throw validation('The file must be between 1 byte and 5 MB.');

  if (extension === '.csv') {
    return makeImportRows(parseCsv(buffer.toString('utf8').replace(/^\uFEFF/, '')));
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw validation('The Excel file could not be read. Use a valid .xlsx workbook.');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw validation('The Excel workbook has no worksheets.');
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (excelRow) => {
    const values = excelRow.values.slice(1).map((cell) => {
      if (cell && typeof cell === 'object' && ('formula' in cell || 'sharedFormula' in cell)) {
        throw validation('Formulas are not allowed in imported client data.');
      }
      if (cell instanceof Date) return cell.toISOString().slice(0, 10);
      if (cell && typeof cell === 'object' && 'text' in cell) return cell.text;
      return cell == null ? '' : String(cell);
    });
    rows.push(values);
  });
  return makeImportRows(rows);
}

async function importClients(db, fileName, data) {
  const rows = await readImportRows(fileName, data);
  const emails = new Set();
  for (const row of rows) {
    const email = row.email.toLowerCase();
    if (emails.has(email)) throw validation(`Row ${row.rowNumber}: the email is repeated in this file.`);
    emails.add(email);
  }

  const credentials = [];
  const insertAll = db.transaction(() => {
    for (const row of rows) {
      try {
        const normalized = normalizeClientInput(row);
        const existing = normalized.manualNumber
          ? db.prepare('SELECT id FROM clients WHERE client_number = ?').get(normalized.manualNumber)
          : null;
        let client;
        if (existing) {
          db.prepare('UPDATE clients SET full_name = ?, phone = ?, email = ? WHERE id = ?')
            .run(normalized.fullName, normalized.phone, normalized.email, existing.id);
          client = getClientRow(db, existing.id);
        } else {
          client = createClient(db, row);
        }
        const temporaryPassword = crypto.randomBytes(18).toString('base64url');
        const passwordHash = bcrypt.hashSync(temporaryPassword, 10);
        db.prepare(`INSERT INTO users (username, password_hash, role, force_password_change, client_id)
                    VALUES (?, ?, 'client', 1, ?)`).run(client.email, passwordHash, client.id);
        credentials.push({
          client_number: client.client_number,
          full_name: client.full_name,
          email: client.email,
          temporary_password: temporaryPassword,
        });
      } catch (err) {
        if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw validation(`Row ${row.rowNumber}: the client number or email is already in use.`);
        }
        if (err && typeof err.status === 'number') throw validation(`Row ${row.rowNumber}: ${err.message}`);
        throw err;
      }
    }
  });
  insertAll();
  return { imported: credentials.length, credentials };
}

function escapeCsv(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function clientRecords(db) {
  return listClients(db).map((client) => [client.client_number, client.full_name, client.phone || '', client.email || '']);
}

function exportCsv(db) {
  const lines = [HEADERS.map(escapeCsv).join(',')];
  for (const record of clientRecords(db)) lines.push(record.map(escapeCsv).join(','));
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}

async function exportXlsx(db) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Clients');
  sheet.addRow(HEADERS);
  for (const record of clientRecords(db)) {
    const row = sheet.addRow(record.map((value) => String(value)));
    row.eachCell({ includeEmpty: true }, (cell) => { cell.numFmt = '@'; });
  }
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((column) => { column.width = 24; });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

module.exports = { importClients, exportCsv, exportXlsx, readImportRows };
