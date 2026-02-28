/**
 * Cron job: rotate Turso database auth token daily.
 *
 * Flow:
 *   1. Call Turso Platform API to generate a new database JWT
 *   2. Hot-swap the libsql client with the new token (zero downtime)
 *   3. Call Turso Platform API to invalidate all old tokens
 *
 * Required env vars:
 *   TURSO_API_TOKEN     — Turso Platform API token (not the DB JWT)
 *   TURSO_ORG           — Turso organization slug
 *   TURSO_DB_NAME       — Turso database name
 *   TURSO_DATABASE_URL  — libsql:// or https:// DB URL
 *   TURSO_AUTH_TOKEN    — current DB JWT (updated in memory on rotation)
 *
 * Graceful fallback: if rotation fails the existing token stays active and
 * the job retries on the next scheduled run (up to MAX_RETRIES per cycle).
 */

import { swapDbClient } from '../db.js';
import { cronMonitor } from './cronMonitor.js';

const JOB_NAME = 'turso-token-rotation';
const TURSO_API = 'https://api.turso.tech/v1';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 30_000; // 30 s between retries

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function createDatabaseToken(
  apiToken: string,
  org: string,
  dbName: string,
): Promise<string> {
  const url = `${TURSO_API}/organizations/${encodeURIComponent(org)}/databases/${encodeURIComponent(dbName)}/auth/tokens?expiration=never&authorization=full-access`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Turso create-token failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { jwt: string };
  if (!data.jwt) throw new Error('Turso API returned no jwt field');
  return data.jwt;
}

async function invalidateOldTokens(
  apiToken: string,
  org: string,
  dbName: string,
): Promise<void> {
  const url = `${TURSO_API}/organizations/${encodeURIComponent(org)}/databases/${encodeURIComponent(dbName)}/auth/rotate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Turso rotate (invalidate) failed (${res.status}): ${body}`);
  }
}

async function rotateTursoToken(): Promise<void> {
  const apiToken = process.env.TURSO_API_TOKEN;
  const org = process.env.TURSO_ORG;
  const dbName = process.env.TURSO_DB_NAME;

  if (!apiToken || !org || !dbName) {
    const missing: string[] = [];
    if (!apiToken) missing.push('TURSO_API_TOKEN');
    if (!org) missing.push('TURSO_ORG');
    if (!dbName) missing.push('TURSO_DB_NAME');
    console.warn(`[${JOB_NAME}] Skipping — missing env vars: ${missing.join(', ')}`);
    return;
  }

  console.log(`[${JOB_NAME}] Starting daily Turso token rotation…`);

  // Step 1: obtain new token
  const newToken = await createDatabaseToken(apiToken, org, dbName);
  console.log(`[${JOB_NAME}] New DB token obtained`);

  // Step 2: hot-swap client (zero downtime — all subsequent DB calls use new token)
  swapDbClient(newToken);

  // Step 3: persist new token in process env (for any future client re-creation)
  process.env.TURSO_AUTH_TOKEN = newToken;

  // Step 4: invalidate all old tokens
  await invalidateOldTokens(apiToken, org, dbName);
  console.log(`[${JOB_NAME}] Old tokens invalidated`);
}

async function rotateTursoTokenWithRetry(): Promise<void> {
  cronMonitor.startRun(JOB_NAME);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await rotateTursoToken();
      cronMonitor.recordSuccess(JOB_NAME, 'Token rotated and old tokens invalidated');
      console.log(`[${JOB_NAME}] ✅ Rotation complete`);
      return;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${JOB_NAME}] ❌ Attempt ${attempt}/${MAX_RETRIES} failed: ${msg}`);
      if (attempt < MAX_RETRIES) {
        console.log(`[${JOB_NAME}] Retrying in ${RETRY_DELAY_MS / 1000}s…`);
        await sleep(RETRY_DELAY_MS);
      } else {
        cronMonitor.recordError(
          JOB_NAME,
          `Rotation failed after ${MAX_RETRIES} attempts. Old token remains active. Last error: ${msg}`,
        );
        console.error(
          `[${JOB_NAME}] ⚠️  All ${MAX_RETRIES} attempts exhausted — keeping existing token active.`,
        );
      }
    }
  }
}

// Register with the cron monitor (schedule label only — we drive timing below)
cronMonitor.registerJob(JOB_NAME, '0 3 * * *');

// Schedule first run at next 03:00 UTC, then every 24 h
const DAILY_MS = 24 * 60 * 60 * 1000;

const now = new Date();
const nextRun = new Date(
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, 0, 0, 0),
);
if (nextRun <= now) nextRun.setUTCDate(nextRun.getUTCDate() + 1);

const msUntilFirst = nextRun.getTime() - Date.now();
console.log(
  `[${JOB_NAME}] ⏰ First rotation scheduled at ${nextRun.toISOString()} (in ${Math.round(msUntilFirst / 3_600_000 * 10) / 10}h)`,
);

setTimeout(() => {
  rotateTursoTokenWithRetry();
  setInterval(rotateTursoTokenWithRetry, DAILY_MS);
}, msUntilFirst);
