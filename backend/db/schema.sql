-- Inuka Africa Loan Repayment Tracker - SQLite schema.
-- All money columns are INTEGER Kenyan shillings (no decimals => no floating-point errors).

CREATE TABLE IF NOT EXISTS users (            -- staff and clients who may log in
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,              -- bcrypt hash, never the password
  role          TEXT    NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'client')),
  force_password_change INTEGER NOT NULL DEFAULT 0 CHECK (force_password_change IN (0, 1)),
  client_id     INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_number TEXT    NOT NULL UNIQUE,        -- unique at DB level
  full_name     TEXT    NOT NULL CHECK (length(trim(full_name)) > 0),
  phone         TEXT,
  email         TEXT COLLATE NOCASE,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS loans (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_reference TEXT    NOT NULL UNIQUE,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  loan_amount    INTEGER NOT NULL CHECK (typeof(loan_amount) = 'integer' AND loan_amount > 0),
  total_due      INTEGER NOT NULL CHECK (typeof(total_due)   = 'integer' AND total_due > 0),
  created_at     TEXT    NOT NULL DEFAULT (date('now')),   -- loan creation date (YYYY-MM-DD)
  CHECK (total_due >= loan_amount)
);

CREATE TABLE IF NOT EXISTS repayments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id           INTEGER NOT NULL REFERENCES loans(id) ON DELETE RESTRICT,
  amount            INTEGER NOT NULL CHECK (typeof(amount) = 'integer' AND amount > 0),
  payment_reference TEXT    NOT NULL UNIQUE,    -- unique across the whole application
  payment_date      TEXT    NOT NULL,           -- YYYY-MM-DD
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS loan_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  requested_amount INTEGER NOT NULL CHECK (typeof(requested_amount) = 'integer' AND requested_amount > 0),
  purpose       TEXT    NOT NULL CHECK (length(trim(purpose)) > 0),
  status        TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note   TEXT,
  reviewed_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  loan_id       INTEGER REFERENCES loans(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  reviewed_at   TEXT
);

-- Indexes for the lookups the app does most (UNIQUE columns already get an index).
CREATE INDEX IF NOT EXISTS idx_clients_full_name ON clients(full_name);
CREATE INDEX IF NOT EXISTS idx_loans_client_id   ON loans(client_id);
CREATE INDEX IF NOT EXISTS idx_repayments_loan   ON repayments(loan_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_loan_requests_client ON loan_requests(client_id, id);
CREATE INDEX IF NOT EXISTS idx_loan_requests_status ON loan_requests(status, id);

-- Last line of defence: even if application code had a bug, the database itself
-- refuses a repayment that would push total repaid above total due.
CREATE TRIGGER IF NOT EXISTS trg_repayment_no_overpayment
BEFORE INSERT ON repayments
WHEN (SELECT COALESCE(SUM(amount), 0) FROM repayments WHERE loan_id = NEW.loan_id) + NEW.amount
     > (SELECT total_due FROM loans WHERE id = NEW.loan_id)
BEGIN
  SELECT RAISE(ABORT, 'OVERPAYMENT');
END;
