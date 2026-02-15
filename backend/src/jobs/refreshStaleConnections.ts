import cron from 'node-cron';
import db from '../db.js';
import 'dotenv/config';

const POWENS_DOMAIN = process.env.POWENS_DOMAIN || 'konto-sandbox.biapi.pro';
const POWENS_API = `https://${POWENS_DOMAIN}/2.0`;

// Copy classify functions from index.ts
const SAVINGS_TYPES = new Set(['savings', 'deposit', 'livreta', 'livretb', 'ldds', 'cel', 'pel']);
const INVESTMENT_TYPES = new Set(['market', 'pea', 'pee', 'per', 'perco', 'perp', 'lifeinsurance', 'madelin', 'capitalisation', 'crowdlending', 'realEstate', 'article83']);
const LOAN_TYPES = new Set(['loan']);

function classifyAccountType(powensType: string | undefined, name: string): string {
  if (powensType) {
    if (powensType === 'checking' || powensType === 'card') return 'checking';
    if (SAVINGS_TYPES.has(powensType)) return 'savings';
    if (LOAN_TYPES.has(powensType)) return 'loan';
    if (INVESTMENT_TYPES.has(powensType)) return 'investment';
    return powensType;
  }
  const lower = (name || '').toLowerCase();
  if (lower.includes('livret') || lower.includes('épargne') || lower.includes('epargne') || lower.includes('ldd')) return 'savings';
  if (lower.includes('pea') || lower.includes('per ') || lower.includes('assurance')) return 'investment';
  if (lower.includes('prêt') || lower.includes('pret') || lower.includes('crédit') || lower.includes('credit') || lower.includes('loan') || lower.includes('immo')) return 'loan';
  return 'checking';
}

function classifyAccountSubtype(type: string, provider: string | undefined, name: string): string | null {
  if (type !== 'investment') return null;
  if (provider === 'blockchain' || provider === 'coinbase' || provider === 'binance') return 'crypto';
  const lower = (name || '').toLowerCase();
  if (lower.includes('pea') || lower.includes('action') || lower.includes('bourse') || lower.includes('trading') || lower.includes('stock')) return 'stocks';
  if (lower.includes('or ') || lower.includes('gold') || lower.includes('métaux') || lower.includes('metaux')) return 'gold';
  return 'other';
}

function classifyAccountUsage(powensUsage: string | undefined | null, companyId: number | null): string {
  if (powensUsage === 'professional') return 'professional';
  if (powensUsage === 'private') return 'private';
  return companyId ? 'professional' : 'personal';
}

async function refreshStaleConnections() {
  console.log('🚀 Starting auto-refresh job...');

  // Count total stale accounts
  const staleCountRes = await db.execute({
    sql: `
      SELECT COUNT(DISTINCT ba.id) as total_stale
      FROM bank_accounts ba
      WHERE ba.provider = 'powens'
        AND (
          (ba.last_sync IS NULL OR julianday('now') - julianday(ba.last_sync) > 7)
          OR NOT EXISTS (SELECT 1 FROM transactions t WHERE t.bank_account_id = ba.id)
        )
    `,
  });
  const X = (staleCountRes.rows[0] as any).total_stale || 0;

  if (X === 0) {
    console.log('No stale accounts found.');
    return;
  }

  // Get unique users with stale accounts
  const usersRes = await db.execute({
    sql: `
      SELECT DISTINCT ba.user_id
      FROM bank_accounts ba
      WHERE ba.provider = 'powens'
        AND (
          (ba.last_sync IS NULL OR julianday('now') - julianday(ba.last_sync) > 7)
          OR NOT EXISTS (SELECT 1 FROM transactions t WHERE t.bank_account_id = ba.id)
        )
    `,
  });
  const staleUsers = usersRes.rows as any[];

  let Y = 0;
  let Z = 0;

  for (const userRow of staleUsers) {
    const userId = userRow.user_id;
    try {
      // Get active token for user
      const connRes = await db.execute({
        sql: 'SELECT powens_token FROM bank_connections WHERE user_id = ? AND status = "active" LIMIT 1',
        args: [userId],
      });
      const token = (connRes.rows[0] as any)?.powens_token;
      if (!token) {
        console.warn(`No active Powens connection for user ${userId}`);
        Z++;
        continue;
      }

      // Fetch accounts from Powens
      const accountsRes = await fetch(`${POWENS_API}/users/me/accounts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!accountsRes.ok) {
        console.error(`Powens fetch accounts failed: ${accountsRes.status}`);
        Z++;
        continue;
      }
      const accountsData = await accountsRes.json() as any;
      const powensAccounts = accountsData.accounts || [];

      let accountsUpdated = 0;
      let txsFetched = 0;

      for (const powensAcc of powensAccounts) {
        const providerId = String(powensAcc.id);
        const accRes = await db.execute({
          sql: 'SELECT id, company_id FROM bank_accounts WHERE provider = "powens" AND provider_account_id = ?',
          args: [providerId],
        });
        const ba = accRes.rows[0] as any;
        if (!ba) continue;

        const accType = classifyAccountType(powensAcc.type, powensAcc.name || powensAcc.original_name || '');
        const accUsage = classifyAccountUsage(powensAcc.usage, ba.company_id);
        const subtype = classifyAccountSubtype(accType, 'powens', powensAcc.name || powensAcc.original_name || '');

        // Update balance, sync, type, usage, subtype
        await db.execute({
          sql: `
            UPDATE bank_accounts 
            SET balance = ?, last_sync = ?, type = ?, usage = ?, subtype = ?
            WHERE id = ?
          `,
          args: [
            powensAcc.balance || 0,
            new Date().toISOString(),
            accType,
            accUsage,
            subtype,
            ba.id,
          ],
        });
        accountsUpdated++;

        // Check if needs transactions (0 txs)
        const txCountRes = await db.execute({
          sql: 'SELECT COUNT(*) as cnt FROM transactions WHERE bank_account_id = ?',
          args: [ba.id],
        });
        const txCount = (txCountRes.rows[0] as any).cnt;
        if (txCount === 0) {
          const txRes = await fetch(`${POWENS_API}/users/me/accounts/${providerId}/transactions?limit=100`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (txRes.ok) {
            const txData = await txRes.json() as any;
            const transactions = txData.transactions || [];
            for (const tx of transactions) {
              await db.execute({
                sql: `
                  INSERT OR IGNORE INTO transactions 
                  (bank_account_id, date, amount, label, category)
                  VALUES (?, ?, ?, ?, ?)
                `,
                args: [
                  ba.id,
                  tx.date || tx.rdate,
                  tx.value || tx.amount,
                  tx.original_wording || tx.wording,
                  tx.category?.name || null,
                ],
              });
            }
            txsFetched += transactions.length;
          }
        }
      }

      if (accountsUpdated > 0) {
        Y++;
        console.log(`✅ Refreshed ${accountsUpdated} accounts (fetched ${txsFetched} new txs) for user ${userId}`);
      }
    } catch (err: any) {
      console.error(`❌ Auto-refresh failed for user ${userId}:`, err.message);
      Z++;
    }
  }

  console.log(`📊 Auto-refresh complete: ${X} stale accounts found, ${Y} connections refreshed, ${Z} errors`);
}

// Schedule every 6 hours
cron.schedule('0 */6 * * *', refreshStaleConnections);

// Init log
console.log('⏰ Stale connections auto-refresh cron initialized (every 6 hours)');
