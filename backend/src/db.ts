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

  CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1,
    type TEXT NOT NULL CHECK(type IN ('real_estate','vehicle','valuable','other')),
    name TEXT NOT NULL,
    purchase_price REAL,
    purchase_date TEXT,
    current_value REAL,
    current_value_date TEXT,
    photo_url TEXT,
    linked_loan_account_id INTEGER REFERENCES bank_accounts(id),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS asset_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    amount REAL NOT NULL,
    frequency TEXT NOT NULL CHECK(frequency IN ('monthly','yearly','one_time')),
    category TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS asset_revenues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    amount REAL NOT NULL,
    frequency TEXT NOT NULL CHECK(frequency IN ('monthly','yearly','one_time')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Add estimation columns to assets (idempotent)
try { db.exec(`ALTER TABLE assets ADD COLUMN address TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE assets ADD COLUMN citycode TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE assets ADD COLUMN latitude REAL`); } catch (_) {}
try { db.exec(`ALTER TABLE assets ADD COLUMN longitude REAL`); } catch (_) {}
try { db.exec(`ALTER TABLE assets ADD COLUMN surface REAL`); } catch (_) {}
try { db.exec(`ALTER TABLE assets ADD COLUMN property_type TEXT`); } catch (_) {} // Appartement or Maison
try { db.exec(`ALTER TABLE assets ADD COLUMN estimated_value REAL`); } catch (_) {} // DVF estimation
try { db.exec(`ALTER TABLE assets ADD COLUMN estimated_price_m2 REAL`); } catch (_) {}
try { db.exec(`ALTER TABLE assets ADD COLUMN estimation_date TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE assets ADD COLUMN property_usage TEXT DEFAULT 'principal'`); } catch (_) {} // principal, rented_long, rented_short, vacant
try { db.exec(`ALTER TABLE assets ADD COLUMN monthly_rent REAL`); } catch (_) {}
try { db.exec(`ALTER TABLE assets ADD COLUMN tenant_name TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE assets ADD COLUMN kozy_property_id TEXT`); } catch (_) {} // Link to Kozy

// Coinbase connections table
db.exec(`
  CREATE TABLE IF NOT EXISTS coinbase_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Add type and usage columns (idempotent)
try { db.exec(`ALTER TABLE bank_accounts ADD COLUMN type TEXT NOT NULL DEFAULT 'checking'`); } catch (_) {}
try { db.exec(`ALTER TABLE bank_accounts ADD COLUMN usage TEXT NOT NULL DEFAULT 'personal'`); } catch (_) {}

// Add blockchain columns (idempotent)
try { db.exec(`ALTER TABLE bank_accounts ADD COLUMN blockchain_address TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE bank_accounts ADD COLUMN blockchain_network TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE bank_accounts ADD COLUMN currency TEXT DEFAULT 'EUR'`); } catch (_) {}

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

// Patrimoine snapshots for historical tracking
db.exec(`
  CREATE TABLE IF NOT EXISTS patrimoine_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    user_id INTEGER NOT NULL DEFAULT 1,
    category TEXT NOT NULL,
    total_value REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(date, user_id, category)
  );
`);

// Market rates for credit simulation
db.exec(`
  CREATE TABLE IF NOT EXISTS market_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    duration INTEGER NOT NULL,
    best_rate REAL,
    avg_rate REAL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(duration)
  );
`);

export default db;
