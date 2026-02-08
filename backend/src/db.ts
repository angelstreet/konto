import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, '..', 'db', 'kompta.db');

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    siren TEXT,
    name TEXT NOT NULL,
    address TEXT,
    naf_code TEXT,
    capital REAL,
    legal_form TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bank_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER REFERENCES companies(id),
    provider TEXT,
    provider_account_id TEXT,
    name TEXT NOT NULL,
    custom_name TEXT,
    bank_name TEXT,
    account_number TEXT,
    iban TEXT,
    balance REAL DEFAULT 0,
    hidden INTEGER DEFAULT 0,
    last_sync TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    label TEXT,
    category TEXT,
    is_pro INTEGER DEFAULT 1,
    invoice_id INTEGER REFERENCES invoices(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bank_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    company_id INTEGER REFERENCES companies(id),
    powens_connection_id TEXT,
    powens_token TEXT NOT NULL,
    provider_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    last_sync TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    number TEXT,
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    vendor TEXT,
    file_path TEXT,
    matched_transaction_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Add type and usage columns (idempotent)
try { db.exec(`ALTER TABLE bank_accounts ADD COLUMN type TEXT NOT NULL DEFAULT 'checking'`); } catch (_) {}
try { db.exec(`ALTER TABLE bank_accounts ADD COLUMN usage TEXT NOT NULL DEFAULT 'personal'`); } catch (_) {}

// Backfill type from name heuristic for existing rows still at default
db.exec(`
  UPDATE bank_accounts SET type = 'savings'
  WHERE type = 'checking'
    AND (LOWER(name) LIKE '%livret%' OR LOWER(name) LIKE '%épargne%' OR LOWER(name) LIKE '%epargne%' OR LOWER(name) LIKE '%ldd%');

  UPDATE bank_accounts SET type = 'investment'
  WHERE type = 'checking'
    AND (LOWER(name) LIKE '%pea%' OR LOWER(name) LIKE '%per %' OR LOWER(name) LIKE '%assurance%');

  UPDATE bank_accounts SET type = 'loan'
  WHERE type = 'checking'
    AND (LOWER(name) LIKE '%prêt%' OR LOWER(name) LIKE '%pret%' OR LOWER(name) LIKE '%crédit%' OR LOWER(name) LIKE '%credit%' OR LOWER(name) LIKE '%loan%' OR LOWER(name) LIKE '%immo%');

  UPDATE bank_accounts SET usage = 'professional'
  WHERE company_id IS NOT NULL;

  UPDATE bank_accounts SET last_sync = created_at
  WHERE last_sync IS NULL;
`);

export default db;
