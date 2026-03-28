-- ============================================================
-- MIGRATION: Identify Duplicate Bank Accounts (user_id = 1)
-- Purpose: List duplicate bank accounts for review before deletion
-- Run: turso execute konto-angelstreet "$(cat src/scripts/dedup-bank-accounts.sql)"
-- ============================================================

-- 1. Duplicate groups by (company_id, provider, provider_account_id)
--    These are the most dangerous duplicates — same account imported twice
-- ============================================================
.print '=== DUPLICATES by (company_id, provider, provider_account_id) ==='
SELECT
  company_id,
  provider,
  provider_account_id,
  COUNT(*) as duplicate_count,
  GROUP_CONCAT(id) as account_ids,
  GROUP_CONCAT(name) as names,
  GROUP_CONCAT(iban) as ibans,
  MAX(last_sync) as latest_sync,
  MIN(last_sync) as oldest_sync
FROM bank_accounts
WHERE user_id = 1
  AND provider IS NOT NULL
  AND provider_account_id IS NOT NULL
GROUP BY company_id, provider, provider_account_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, company_id, provider;

-- 2. Duplicate groups by (user_id, provider, iban) where iban is not null/empty
--    These catch accounts that got different provider_account_ids but same IBAN
-- ============================================================
.print ''
.print '=== DUPLICATES by (user_id, provider, iban) ==='
SELECT
  user_id,
  company_id,
  provider,
  iban,
  COUNT(*) as duplicate_count,
  GROUP_CONCAT(id) as account_ids,
  GROUP_CONCAT(provider_account_id) as provider_account_ids,
  GROUP_CONCAT(name) as names,
  MAX(last_sync) as latest_sync
FROM bank_accounts
WHERE user_id = 1
  AND iban IS NOT NULL
  AND iban != ''
GROUP BY user_id, provider, iban
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- 3. Detailed listing of ALL accounts for user 1 — for manual review
-- ============================================================
.print ''
.print '=== ALL BANK ACCOUNTS FOR USER 1 (for manual review) ==='
SELECT
  id,
  company_id,
  provider,
  provider_account_id,
  name,
  iban,
  balance,
  last_sync,
  created_at,
  CASE
    WHEN iban IN (
      SELECT iban FROM bank_accounts
      WHERE user_id = 1 AND iban IS NOT NULL AND iban != ''
      GROUP BY iban HAVING COUNT(*) > 1
    ) THEN '⚠️ IBAN_DUPLICATE'
    WHEN (company_id, provider, provider_account_id) IN (
      SELECT company_id, provider, provider_account_id FROM bank_accounts
      WHERE user_id = 1 AND provider IS NOT NULL AND provider_account_id IS NOT NULL
      GROUP BY company_id, provider, provider_account_id HAVING COUNT(*) > 1
    ) THEN '⚠️ PROVIDER_ID_DUPLICATE'
    ELSE 'OK'
  END as status
FROM bank_accounts
WHERE user_id = 1
ORDER BY status, name;

-- 4. Action plan: for each duplicate group, which row to KEEP (most recent last_sync)
-- ============================================================
.print ''
.print '=== ACTION PLAN: Rows to KEEP per duplicate group (most recent last_sync) ==='
WITH ranked AS (
  SELECT
    id, company_id, provider, provider_account_id, iban, name,
    last_sync,
    ROW_NUMBER() OVER (
      PARTITION BY company_id, provider, provider_account_id
      ORDER BY last_sync DESC NULLS LAST
    ) as rn
  FROM bank_accounts
  WHERE user_id = 1
    AND provider IS NOT NULL
    AND provider_account_id IS NOT NULL
)
SELECT
  company_id, provider, provider_account_id,
  COUNT(*) as total_rows,
  SUM(rn) as keep_id,
  MAX(CASE WHEN rn = 1 THEN id END) as keep_this_id,
  MAX(CASE WHEN rn > 1 THEN id END) as delete_this_id
FROM ranked
GROUP BY company_id, provider, provider_account_id
HAVING COUNT(*) > 1;
