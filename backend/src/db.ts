import { createClient, Client } from '@libsql/client';

const db: Client = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:./db/kompta.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export async function initDatabase() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      clerk_id TEXT UNIQUE,
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
      type TEXT NOT NULL DEFAULT 'checking',
      usage TEXT NOT NULL DEFAULT 'personal',
      blockchain_address TEXT,
      blockchain_network TEXT,
      currency TEXT DEFAULT 'EUR',
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
      address TEXT,
      citycode TEXT,
      latitude REAL,
      longitude REAL,
      surface REAL,
      property_type TEXT,
      estimated_value REAL,
      estimated_price_m2 REAL,
      estimation_date TEXT,
      property_usage TEXT DEFAULT 'principal',
      monthly_rent REAL,
      tenant_name TEXT,
      kozy_property_id TEXT,
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

    CREATE TABLE IF NOT EXISTS coinbase_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS patrimoine_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 1,
      category TEXT NOT NULL,
      total_value REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(date, user_id, category)
    );

    CREATE TABLE IF NOT EXISTS income_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
      year INTEGER NOT NULL,
      employer TEXT NOT NULL,
      job_title TEXT,
      country TEXT NOT NULL DEFAULT 'FR',
      gross_annual REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS analytics_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
      metric_key TEXT NOT NULL,
      period TEXT NOT NULL,
      value TEXT,
      computed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, metric_key, period)
    );

    CREATE TABLE IF NOT EXISTS market_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      duration INTEGER NOT NULL,
      best_rate REAL,
      avg_rate REAL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(duration)
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
      onboarded INTEGER NOT NULL DEFAULT 0,
      display_currency TEXT NOT NULL DEFAULT 'EUR',
      crypto_display TEXT NOT NULL DEFAULT 'native',
      kozy_enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS drive_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      company_id INTEGER REFERENCES companies(id),
      folder_id TEXT,
      folder_path TEXT,
      access_token TEXT,
      refresh_token TEXT,
      token_expiry TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoice_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
      company_id INTEGER REFERENCES companies(id),
      transaction_id INTEGER REFERENCES transactions(id),
      drive_file_id TEXT,
      filename TEXT,
      vendor TEXT,
      amount_ht REAL,
      tva_amount REAL,
      tva_rate REAL,
      date TEXT,
      invoice_number TEXT,
      match_confidence REAL,
      scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(drive_file_id)
    );
  `);
}

// Migration: add clerk_id column if missing (for existing databases)
export async function migrateDatabase() {
  try {
    await db.execute("SELECT clerk_id FROM users LIMIT 1");
  } catch {
    await db.execute("ALTER TABLE users ADD COLUMN clerk_id TEXT UNIQUE");
  }
}

// Find or create user by Clerk ID. On first login, migrates existing user_id=1 data.
export async function ensureUser(clerkId: string): Promise<number> {
  // Try to find existing user with this clerk_id
  const existing = await db.execute({ sql: 'SELECT id FROM users WHERE clerk_id = ?', args: [clerkId] });
  if (existing.rows.length > 0) return existing.rows[0].id as number;

  // Check if there's a legacy user (id=1) without a clerk_id — migrate it
  const legacy = await db.execute({ sql: 'SELECT id FROM users WHERE id = 1 AND clerk_id IS NULL', args: [] });
  if (legacy.rows.length > 0) {
    await db.execute({ sql: 'UPDATE users SET clerk_id = ? WHERE id = 1', args: [clerkId] });
    return 1;
  }

  // Create new user
  const ins = await db.execute({
    sql: 'INSERT INTO users (email, name, role, clerk_id) VALUES (?, ?, ?, ?)',
    args: [`user_${clerkId}@kompta.app`, 'User', 'user', clerkId]
  });
  return Number(ins.lastInsertRowid);
}

export default db;
