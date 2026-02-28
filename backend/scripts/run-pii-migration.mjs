// Run PII migration manually: moves PII from users → user_profiles
import { createClient } from '@libsql/client';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '../db/konto.db');

const db = createClient({ url: 'file:' + dbPath });

async function run() {
  console.log('\n=== PII Migration: users → user_profiles ===\n');
  console.log('DB:', dbPath);

  // 1. Create table if needed
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
  console.log('✅ user_profiles table ready');

  // 2. Check how many users still have real emails
  const piiCheck = await db.execute(
    "SELECT COUNT(*) AS cnt FROM users WHERE email NOT LIKE '%konto.internal%'"
  );
  const piiCount = Number(piiCheck.rows[0]?.cnt ?? 0);
  console.log(`   Users with real PII still in users table: ${piiCount}`);

  if (piiCount > 0) {
    // 3. Copy PII into user_profiles
    const result = await db.execute(`
      INSERT INTO user_profiles (user_id, email, name, phone, address, created_at)
      SELECT id, email, name, phone, address, created_at FROM users
      ON CONFLICT(user_id) DO UPDATE SET
        email = COALESCE(excluded.email, user_profiles.email),
        name  = COALESCE(excluded.name,  user_profiles.name),
        phone = COALESCE(excluded.phone, user_profiles.phone),
        address = COALESCE(excluded.address, user_profiles.address)
    `);
    console.log(`✅ Migrated PII to user_profiles (${result.rowsAffected} rows updated)`);

    // 4. Zero out PII in users table
    const cleared = await db.execute(
      "UPDATE users SET email = 'pii_' || id || '@konto.internal', name = 'User', phone = NULL, address = NULL"
    );
    console.log(`✅ Cleared PII from users table (${cleared.rowsAffected} rows)`);
  } else {
    console.log('   Nothing to migrate (PII already moved or no users)');
  }

  // 5. Ensure every user has a profile row
  await db.execute(`
    INSERT OR IGNORE INTO user_profiles (user_id)
    SELECT id FROM users WHERE id NOT IN (SELECT user_id FROM user_profiles)
  `);

  // 6. Verify final state
  console.log('\n--- Final State ---');
  const profiles = await db.execute(`
    SELECT u.id, u.email AS users_email, u.name AS users_name,
           up.email AS profile_email, up.name AS profile_name,
           up.phone, up.address
    FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id
  `);
  for (const row of profiles.rows) {
    console.log(`  User #${row.id}:`);
    console.log(`    users.email  = ${row.users_email}  (should be placeholder)`);
    console.log(`    users.name   = ${row.users_name}`);
    console.log(`    profile.email = ${row.profile_email}`);
    console.log(`    profile.name  = ${row.profile_name}`);
  }

  console.log('\n✅ Migration complete.\n');
  db.close();
}

run().catch(e => { console.error('FAILED:', e); process.exit(1); });
