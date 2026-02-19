import { createClient, Client } from '@libsql/client';

const db: Client = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:./db/konto.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Graceful shutdown: flush WAL to prevent data loss on kill/restart
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.on(sig, async () => {
    try {
      await db.execute('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {}
    db.close();
    process.exit(0);
  });
}

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
      user_id INTEGER REFERENCES users(id),
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

    CREATE TABLE IF NOT EXISTS investments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
      provider_investment_id TEXT,
      label TEXT NOT NULL,
      isin_code TEXT,
      code_type TEXT DEFAULT 'ISIN',
      quantity REAL DEFAULT 0,
      unit_price REAL DEFAULT 0,
      unit_value REAL DEFAULT 0,
      valuation REAL DEFAULT 0,
      diff REAL DEFAULT 0,
      diff_percent REAL DEFAULT 0,
      portfolio_share REAL DEFAULT 0,
      currency TEXT DEFAULT 'EUR',
      vdate TEXT,
      last_update TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_investments_unique ON investments(bank_account_id, isin_code);

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
      notary_fees REAL,
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

    CREATE TABLE IF NOT EXISTS binance_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      api_key TEXT NOT NULL,
      api_secret TEXT NOT NULL,
      account_name TEXT NOT NULL DEFAULT 'Binance',
      status TEXT NOT NULL DEFAULT 'active',
      last_sync TEXT,
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
      net_annual REAL,
      start_date TEXT,
      end_date TEXT,
      company_id INTEGER REFERENCES companies(id),
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

    CREATE TABLE IF NOT EXISTS drive_folder_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      purpose TEXT NOT NULL,
      folder_id TEXT NOT NULL,
      folder_path TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, purpose)
    );

    CREATE TABLE IF NOT EXISTS payslips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      drive_file_id TEXT,
      filename TEXT,
      gross REAL,
      net REAL,
      employer TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, year, month)
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
      raw_text TEXT,
      extraction_method TEXT,
      scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(drive_file_id)
    );
  `);
}

// Migration: add new columns if missing (for existing databases)
export async function migrateDatabase() {
  try {
    await db.execute("SELECT clerk_id FROM users LIMIT 1");
  } catch {
    await db.execute("ALTER TABLE users ADD COLUMN clerk_id TEXT");
    await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_clerk_id ON users(clerk_id) WHERE clerk_id IS NOT NULL");
  }
  try {
    await db.execute("SELECT user_id FROM bank_accounts LIMIT 1");
  } catch {
    await db.execute("ALTER TABLE bank_accounts ADD COLUMN user_id INTEGER REFERENCES users(id)");
    // Migrate existing accounts: assign to user 1
    await db.execute("UPDATE bank_accounts SET user_id = 1 WHERE user_id IS NULL");
  }
  try {
    await db.execute("SELECT notary_fees FROM assets LIMIT 1");
  } catch {
    await db.execute("ALTER TABLE assets ADD COLUMN notary_fees REAL");
  }
  // income_entries: add new columns
  for (const col of ['net_annual REAL', 'start_date TEXT', 'end_date TEXT', 'company_id INTEGER REFERENCES companies(id)']) {
    const name = col.split(' ')[0];
    try { await db.execute(`SELECT ${name} FROM income_entries LIMIT 1`); } catch {
      await db.execute(`ALTER TABLE income_entries ADD COLUMN ${col}`);
    }
  }
  try {
    await db.execute("SELECT company_id FROM assets LIMIT 1");
  } catch {
    await db.execute("ALTER TABLE assets ADD COLUMN company_id INTEGER REFERENCES companies(id)");
  }
  try {
    await db.execute("SELECT travaux FROM assets LIMIT 1");
  } catch {
    await db.execute("ALTER TABLE assets ADD COLUMN travaux REAL");
  }
  try {
    await db.execute("SELECT usage FROM assets LIMIT 1");
  } catch {
    await db.execute("ALTER TABLE assets ADD COLUMN usage TEXT NOT NULL DEFAULT 'personal'");
  }

  // Add subtype column to bank_accounts (for investment sub-classification)
  try {
    await db.execute("SELECT subtype FROM bank_accounts LIMIT 1");
  } catch {
    await db.execute("ALTER TABLE bank_accounts ADD COLUMN subtype TEXT");
    // Auto-populate subtype for existing investment accounts
    await db.execute("UPDATE bank_accounts SET subtype = 'crypto' WHERE type = 'investment' AND (provider = 'blockchain' OR provider = 'coinbase')");
    await db.execute("UPDATE bank_accounts SET subtype = 'stocks' WHERE type = 'investment' AND subtype IS NULL AND (LOWER(name) LIKE '%pea%' OR LOWER(name) LIKE '%action%' OR LOWER(name) LIKE '%bourse%' OR LOWER(name) LIKE '%trading%')");
    await db.execute("UPDATE bank_accounts SET subtype = 'other' WHERE type = 'investment' AND subtype IS NULL");
  }

  // Add powens_refresh_token to bank_connections for automatic token refresh
  try {
    await db.execute("SELECT powens_refresh_token FROM bank_connections LIMIT 1");
  } catch {
    await db.execute("ALTER TABLE bank_connections ADD COLUMN powens_refresh_token TEXT");
  }

  // Track SCA state per account so frontend can show re-auth indicators
  try {
    await db.execute("SELECT sca_required FROM bank_accounts LIMIT 1");
  } catch {
    await db.execute("ALTER TABLE bank_accounts ADD COLUMN sca_required INTEGER NOT NULL DEFAULT 0");
  }

  // Add tx_hash column to transactions for blockchain transaction dedup
  try {
    await db.execute("SELECT tx_hash FROM transactions LIMIT 1");
  } catch {
    await db.execute("ALTER TABLE transactions ADD COLUMN tx_hash TEXT");
    await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_tx_hash ON transactions(bank_account_id, tx_hash)");
  }

  // Add folder_path to drive_connections (stores human-readable path label)
  try {
    await db.execute("SELECT folder_path FROM drive_connections LIMIT 1");
  } catch {
    await db.execute("ALTER TABLE drive_connections ADD COLUMN folder_path TEXT");
  }

  // Add raw_text and extraction_method to invoice_cache for OCR results
  for (const col of ['raw_text TEXT', 'extraction_method TEXT']) {
    const name = col.split(' ')[0];
    try { await db.execute(`SELECT ${name} FROM invoice_cache LIMIT 1`); } catch {
      await db.execute(`ALTER TABLE invoice_cache ADD COLUMN ${col}`);
    }
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
    args: [`user_${clerkId}@konto.app`, 'User', 'user', clerkId]
  });
  return Number(ins.lastInsertRowid);
}

export default db;
