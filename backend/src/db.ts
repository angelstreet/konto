import { createClient, Client } from '@libsql/client';

// Mutable reference — enables hot-swap on token rotation
let _client: Client = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:./db/konto.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

/**
 * Swap the underlying libsql client with a new one using the rotated token.
 * All existing callers using the db proxy will transparently use the new client.
 */
export function swapDbClient(newToken: string): void {
  const old = _client;
  _client = createClient({
    url: process.env.TURSO_DATABASE_URL || 'file:./db/konto.db',
    authToken: newToken,
  });
  try { old.close(); } catch { /* ignore */ }
  console.log('[db] Client swapped with rotated token');
}

// Proxy forwards all method calls to the current _client (transparent hot-swap)
const db = new Proxy({} as Client, {
  get(_: Client, prop: string | symbol) {
    const val = (_client as any)[prop as string];
    if (typeof val === 'function') return val.bind(_client);
    return val;
  },
});

// Graceful shutdown: flush WAL to prevent data loss on kill/restart
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.on(sig, async () => {
    try {
      await _client.execute('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {}
    _client.close();
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
      provider_bank_id TEXT,
      provider_bank_name TEXT,
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

    CREATE TABLE IF NOT EXISTS user_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      email TEXT,
      name TEXT,
      phone TEXT,
      address TEXT,
      country TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

    CREATE TABLE IF NOT EXISTS patrimoine_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      categories TEXT,
      scopes TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS loan_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      bank_account_id INTEGER NOT NULL UNIQUE REFERENCES bank_accounts(id) ON DELETE CASCADE,
      loan_type TEXT NOT NULL DEFAULT 'amortizing',
      principal_amount REAL,
      start_date TEXT,
      end_date TEXT,
      duration_months INTEGER,
      installments_paid INTEGER,
      interest_rate REAL,
      monthly_payment REAL,
      insurance_monthly REAL DEFAULT 0,
      fees_total REAL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS loan_milestone_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
      milestone INTEGER NOT NULL,
      triggered_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, bank_account_id, milestone)
    );

    CREATE TABLE IF NOT EXISTS fiscal_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      year INTEGER NOT NULL,
      revenu_brut_global REAL,
      revenu_imposable REAL,
      parts_fiscales REAL NOT NULL DEFAULT 1,
      taux_marginal REAL,
      taux_moyen REAL,
      breakdown_salaries REAL,
      breakdown_lmnp REAL,
      breakdown_dividendes REAL,
      breakdown_revenus_fonciers REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, year)
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

  // Powens institution metadata for robust bank-level grouping
  try {
    await db.execute("SELECT provider_bank_id FROM bank_accounts LIMIT 1");
  } catch {
    await db.execute("ALTER TABLE bank_accounts ADD COLUMN provider_bank_id TEXT");
  }
  try {
    await db.execute("SELECT provider_bank_name FROM bank_accounts LIMIT 1");
  } catch {
    await db.execute("ALTER TABLE bank_accounts ADD COLUMN provider_bank_name TEXT");
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

  // Add phone and address to users for profile page
  for (const col of ['phone TEXT', 'address TEXT']) {
    const name = col.split(' ')[0];
    try { await db.execute(`SELECT ${name} FROM users LIMIT 1`); } catch {
      await db.execute(`ALTER TABLE users ADD COLUMN ${col}`);
    }
  }

  // Add raw_text and extraction_method to invoice_cache for OCR results
  for (const col of ['raw_text TEXT', 'extraction_method TEXT']) {
    const name = col.split(' ')[0];
    try { await db.execute(`SELECT ${name} FROM invoice_cache LIMIT 1`); } catch {
      await db.execute(`ALTER TABLE invoice_cache ADD COLUMN ${col}`);
    }
  }

  // Add country to user_profiles
  try {
    await db.execute("SELECT country FROM user_profiles LIMIT 1");
  } catch {
    await db.execute("ALTER TABLE user_profiles ADD COLUMN country TEXT");
  }

  // Add city to user_profiles (PII cleanup task #950)
  try {
    await db.execute("SELECT city FROM user_profiles LIMIT 1");
  } catch {
    await db.execute("ALTER TABLE user_profiles ADD COLUMN city TEXT");
  }

  // PII separation: migrate name/email/phone/address from users → user_profiles
  // Create table if needed
  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      email TEXT,
      name TEXT,
      phone TEXT,
      address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Check if PII still lives in users table (real emails, not placeholders)
  const piiCheck = await db.execute(
    "SELECT COUNT(*) AS cnt FROM users WHERE email NOT LIKE '%konto.internal%'"
  );
  const piiCount = (piiCheck.rows[0] as any)?.cnt ?? 0;
  if (piiCount > 0) {
    // Copy PII from users into user_profiles (only if profile has no email yet)
    await db.execute(`
      INSERT INTO user_profiles (user_id, email, name, phone, address, created_at)
      SELECT id, email, name, phone, address, created_at FROM users
      WHERE id NOT IN (SELECT user_id FROM user_profiles WHERE email IS NOT NULL)
      ON CONFLICT(user_id) DO UPDATE SET
        email = COALESCE(excluded.email, user_profiles.email),
        name  = COALESCE(excluded.name,  user_profiles.name),
        phone = COALESCE(excluded.phone, user_profiles.phone),
        address = COALESCE(excluded.address, user_profiles.address)
    `);
    // Replace PII in users table with placeholders (keeps NOT NULL constraints valid)
    await db.execute(
      "UPDATE users SET email = 'pii_' || id || '@konto.internal', name = 'User', phone = NULL, address = NULL"
    );
  }


  // audit_log table: tracks all API access for security monitoring
  await db.execute(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      user_id INTEGER REFERENCES users(id),
      ip TEXT,
      country TEXT,
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      status INTEGER,
      details TEXT
    )
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp)
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_audit_log_ip ON audit_log(ip)
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id)
  `);

  // ip_blacklist table: auto and manual IP blocking
  await db.execute(`
    CREATE TABLE IF NOT EXISTS ip_blacklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL UNIQUE,
      reason TEXT,
      blocked_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT,
      auto INTEGER NOT NULL DEFAULT 1
    )
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_ip_blacklist_ip ON ip_blacklist(ip)
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_ip_blacklist_expires_at ON ip_blacklist(expires_at)
  `);

  // Ensure user_profiles rows exist for any users added after migration
  await db.execute(`
    INSERT OR IGNORE INTO user_profiles (user_id)
    SELECT id FROM users WHERE id NOT IN (SELECT user_id FROM user_profiles)
  `);

  // API keys table for agent/AI access
  await db.execute(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      key_hash TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      name TEXT DEFAULT 'default',
      scope TEXT NOT NULL DEFAULT 'personal',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      active INTEGER NOT NULL DEFAULT 1
    )
  `);

  // Loan details and milestone notifications tables
  await db.execute(`
    CREATE TABLE IF NOT EXISTS loan_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      bank_account_id INTEGER NOT NULL UNIQUE REFERENCES bank_accounts(id) ON DELETE CASCADE,
      loan_type TEXT NOT NULL DEFAULT 'amortizing',
      principal_amount REAL,
      start_date TEXT,
      end_date TEXT,
      duration_months INTEGER,
      installments_paid INTEGER,
      interest_rate REAL,
      monthly_payment REAL,
      insurance_monthly REAL DEFAULT 0,
      fees_total REAL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS loan_milestone_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
      milestone INTEGER NOT NULL,
      triggered_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, bank_account_id, milestone)
    )
  `);
}

// Find or create user by Clerk ID. On first login, migrates existing user_id=1 data.
export async function ensureUser(clerkId: string): Promise<number> {
  // Try to find existing user with this clerk_id
  const existing = await db.execute({ sql: 'SELECT id FROM users WHERE clerk_id = ?', args: [clerkId] });
  if (existing.rows.length > 0) {
    const userId = existing.rows[0].id as number;
    // Ensure user_profiles row exists (guard for users created before PII separation)
    await db.execute({
      sql: 'INSERT OR IGNORE INTO user_profiles (user_id) VALUES (?)',
      args: [userId]
    });
    return userId;
  }

  // Check if there's a legacy user (id=1) without a clerk_id — migrate it
  const legacy = await db.execute({ sql: 'SELECT id FROM users WHERE id = 1 AND clerk_id IS NULL', args: [] });
  if (legacy.rows.length > 0) {
    await db.execute({ sql: 'UPDATE users SET clerk_id = ? WHERE id = 1', args: [clerkId] });
    await db.execute({ sql: 'INSERT OR IGNORE INTO user_profiles (user_id) VALUES (1)', args: [] });
    return 1;
  }

  // Create new user (PII placeholder in users; real data goes in user_profiles)
  const ins = await db.execute({
    sql: 'INSERT INTO users (email, name, role, clerk_id) VALUES (?, ?, ?, ?)',
    args: [`pii_new_${clerkId}@konto.internal`, 'User', 'user', clerkId]
  });
  const userId = Number(ins.lastInsertRowid);
  // Create empty profile row — caller can populate name/email from Clerk data later
  await db.execute({
    sql: 'INSERT OR IGNORE INTO user_profiles (user_id) VALUES (?)',
    args: [userId]
  });
  return userId;
}

export default db;
