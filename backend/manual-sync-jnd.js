#!/usr/bin/env node
import db from './dist/db.js';
import 'dotenv/config';

const POWENS_DOMAIN = process.env.POWENS_DOMAIN || 'konto-sandbox.biapi.pro';
const POWENS_API = `https://${POWENS_DOMAIN}/2.0`;

async function syncJNDConsulting() {
  console.log('🔄 Manually syncing JND CONSULTING transactions...\n');

  // Get JND CONSULTING accounts (12, 13, 14)
  const accounts = await db.execute({
    sql: 'SELECT * FROM bank_accounts WHERE company_id = 3',
  });

  console.log(`Found ${accounts.rows.length} JND CONSULTING accounts\n`);

  // Get user's Powens token
  const connRes = await db.execute({
    sql: `SELECT powens_token FROM bank_connections WHERE user_id = 1 AND status = 'active' LIMIT 1`,
  });
  const token = connRes.rows[0]?.powens_token;

  if (!token) {
    console.error('❌ No active Powens connection found');
    return;
  }

  let totalTxs = 0;

  for (const account of accounts.rows) {
    const providerId = account.provider_account_id;
    console.log(`\n📊 Syncing: ${account.name} (provider_account_id: ${providerId})`);

    try {
      // Fetch transactions from Powens
      const txRes = await fetch(`${POWENS_API}/users/me/accounts/${providerId}/transactions?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!txRes.ok) {
        console.error(`  ❌ Powens API error: ${txRes.status} ${txRes.statusText}`);
        continue;
      }

      const txData = await txRes.json();
      const transactions = txData.transactions || [];

      console.log(`  📥 Found ${transactions.length} transactions`);

      let inserted = 0;
      for (const tx of transactions) {
        const result = await db.execute({
          sql: `
            INSERT OR IGNORE INTO transactions 
            (bank_account_id, date, amount, label, category, is_pro)
            VALUES (?, ?, ?, ?, ?, 1)
          `,
          args: [
            account.id,
            tx.date || tx.rdate,
            tx.value || tx.amount,
            tx.original_wording || tx.wording,
            tx.category?.name || null,
          ],
        });

        if (result.rowsAffected > 0) inserted++;
      }

      totalTxs += inserted;
      console.log(`  ✅ Inserted ${inserted} new transactions`);

      // Update last_sync
      await db.execute({
        sql: 'UPDATE bank_accounts SET last_sync = ? WHERE id = ?',
        args: [new Date().toISOString(), account.id],
      });

    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`);
    }
  }

  console.log(`\n✅ SYNC COMPLETE: ${totalTxs} total transactions imported for JND CONSULTING`);
}

syncJNDConsulting().catch(console.error);
