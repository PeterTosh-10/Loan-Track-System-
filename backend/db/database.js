// Opens the SQLite database, turns on foreign keys and creates the tables.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma('foreign_keys = ON');            // SQLite ignores foreign keys unless this is set per connection
  if (file !== ':memory:') db.pragma('journal_mode = WAL');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  migrateExistingSchema(db);
  return db;
}

function migrateExistingSchema(db) {
  const columns = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
  const ensureColumn = (table, name, definition) => {
    if (!columns(table).has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  };
  ensureColumn('clients', 'phone', 'TEXT');
  ensureColumn('clients', 'email', 'TEXT COLLATE NOCASE');
  ensureColumn('users', 'role', "TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'client'))");
  ensureColumn('users', 'force_password_change', 'INTEGER NOT NULL DEFAULT 0 CHECK (force_password_change IN (0, 1))');
  ensureColumn('users', 'client_id', 'INTEGER REFERENCES clients(id) ON DELETE CASCADE');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_email ON clients(email) WHERE email IS NOT NULL');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_client_id ON users(client_id) WHERE client_id IS NOT NULL');
}

module.exports = { openDatabase, migrateExistingSchema };
