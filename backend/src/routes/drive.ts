import { execSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

import { Hono } from 'hono';
import db from '../db.js';
import { encrypt, decrypt } from '../crypto.js';
import { getUserId, decryptBankConn, decryptCoinbaseConn, decryptBinanceConn, decryptDriveConn,
         POWENS_CLIENT_ID, POWENS_CLIENT_SECRET, POWENS_DOMAIN, POWENS_API, REDIRECT_URI,
         classifyAccountType, classifyAccountSubtype, classifyAccountUsage, extractPowensBankMeta,
         refreshPowensToken, getDriveAccessToken, sha256, generateApiKey, getClientIP,
         calcInvestmentDiff, calcInvDiff, formatCurrencyFR, escapeHtml } from '../shared.js';


const router = new Hono();


// ========== INVOICE MATCHING (Google Drive) ==========

// Get drive connection status
router.get('/api/drive/status', async (c) => {
  const userId = await getUserId(c);
  const companyId = c.req.query('company_id');

  if (companyId) {
    // Try company-specific first, fall back to global
    const specific = await db.execute({
      sql: 'SELECT id, company_id, folder_id, folder_path, status, created_at FROM drive_connections WHERE user_id = ? AND company_id = ? AND status = ? LIMIT 1',
      args: [userId, parseInt(companyId), 'active'],
    });
    if (specific.rows.length > 0) {
      const conn: any = specific.rows[0];
      return c.json({ connected: true, ...conn });
    }
    // Fall back to global connection
    const global = await db.execute({
      sql: 'SELECT id, company_id, folder_id, folder_path, status, created_at FROM drive_connections WHERE user_id = ? AND company_id IS NULL AND status = ? LIMIT 1',
      args: [userId, 'active'],
    });
    if (global.rows.length > 0) {
      const conn: any = global.rows[0];
      return c.json({ connected: true, ...conn });
    }
    return c.json({ connected: false });
  }

  const result = await db.execute({
    sql: 'SELECT id, company_id, folder_id, folder_path, status, created_at FROM drive_connections WHERE user_id = ? AND company_id IS NULL AND status = ? LIMIT 1',
    args: [userId, 'active'],
  });
  if (result.rows.length === 0) return c.json({ connected: false });
  const conn: any = result.rows[0];
  return c.json({ connected: conn.status === 'active', ...conn });
});

// POST /api/drive/connect → generate Google OAuth URL
router.post('/api/drive/connect', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const companyId = body.company_id || null;
  const returnTo = body.return_to || null;
  const withUpload = body.with_upload || false;

  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const DRIVE_REDIRECT_URI = process.env.GOOGLE_DRIVE_REDIRECT_URI || process.env.APP_URL ? `${process.env.APP_URL}/api/drive-callback` : 'http://localhost:3003/api/drive-callback';

  if (!GOOGLE_CLIENT_ID) {
    return c.json({ error: 'Google Drive not configured' }, 500);
  }

  // Encode company_id and return_to in state parameter for OAuth callback
  const stateData: any = {};
  if (companyId) stateData.company_id = companyId;
  if (returnTo) stateData.return_to = returnTo;
  const state = Object.keys(stateData).length > 0 ? Buffer.from(JSON.stringify(stateData)).toString('base64') : '';

  // Use drive scope: read + copy (for OCR) + upload
  const scope = 'https://www.googleapis.com/auth/drive';

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: DRIVE_REDIRECT_URI,
    scope,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    ...(state && { state }),
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return c.json({ url });
});

router.delete('/api/drive/disconnect', async (c) => {
  const userId = await getUserId(c);
  const companyId = c.req.query('company_id');

  const sql = companyId
    ? 'DELETE FROM drive_connections WHERE user_id = ? AND company_id = ?'
    : 'DELETE FROM drive_connections WHERE user_id = ? AND company_id IS NULL';

  const args = companyId ? [userId, parseInt(companyId)] : [userId];

  await db.execute({ sql, args });
  return c.json({ ok: true });
});

// GET /api/drive/folders - List folders from Google Drive
router.get('/api/drive/folders', async (c) => {
  const userId = await getUserId(c);
  const companyId = c.req.query('company_id');

  let driveConn: any = null;
  if (companyId) {
    const specific = await db.execute({ sql: 'SELECT * FROM drive_connections WHERE user_id = ? AND company_id = ? AND status = ? LIMIT 1', args: [userId, parseInt(companyId), 'active'] });
    if (specific.rows.length > 0) driveConn = decryptDriveConn(specific.rows[0]);
    else {
      const global = await db.execute({ sql: 'SELECT * FROM drive_connections WHERE user_id = ? AND company_id IS NULL AND status = ? LIMIT 1', args: [userId, 'active'] });
      if (global.rows.length > 0) driveConn = decryptDriveConn(global.rows[0]);
    }
  } else {
    const result = await db.execute({ sql: 'SELECT * FROM drive_connections WHERE user_id = ? AND company_id IS NULL AND status = ? LIMIT 1', args: [userId, 'active'] });
    if (result.rows.length > 0) driveConn = decryptDriveConn(result.rows[0]);
  }

  if (!driveConn) {
    return c.json({ error: 'No active Google Drive connection' }, 400);
  }
  const accessToken = await getDriveAccessToken(driveConn);

  try {
    // Get parent folder ID from query (for nested navigation)
    const parentFolderId = c.req.query('parent_id');

    // Build query for folders
    let query = "mimeType='application/vnd.google-apps.folder'";
    if (parentFolderId) {
      query += ` and '${parentFolderId}' in parents`;
    } else {
      // Root level: folders not in trash and in "My Drive" (not shared drives)
      query += " and 'root' in parents";
    }

    const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&orderBy=name&pageSize=100`;
    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!listRes.ok) {
      const err = await listRes.text();
      return c.json({ error: 'Drive API error', details: err }, 502);
    }

    const listData: any = await listRes.json();
    return c.json({ folders: listData.files || [] });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// PATCH /api/drive/folder - Update folder for a drive connection
router.patch('/api/drive/folder', async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json();
  const { company_id, folder_id, folder_name } = body;

  const sql = company_id
    ? 'UPDATE drive_connections SET folder_id = ?, folder_path = ? WHERE user_id = ? AND company_id = ? AND status = ?'
    : 'UPDATE drive_connections SET folder_id = ?, folder_path = ? WHERE user_id = ? AND company_id IS NULL AND status = ?';

  const args = company_id
    ? [folder_id || null, folder_name || null, userId, company_id, 'active']
    : [folder_id || null, folder_name || null, userId, 'active'];

  await db.execute({ sql, args });
  return c.json({ ok: true });
});

// GET /api/drive-callback?code=... → exchange code for tokens
router.get('/api/drive-callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  // Extract company_id and return_to from state parameter
  let companyId = null;
  let returnTo = '/konto/invoices';
  if (state) {
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
      companyId = decoded.company_id || null;
      returnTo = decoded.return_to || '/konto/invoices';
    } catch (e) {
      console.error('Failed to decode state:', e);
    }
  }

  if (error) {
    return c.html(`<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">Drive connection failed</h1><p>${error}</p>
      <a href="${returnTo}" style="color:#d4a812;">← Retour</a>
    </body></html>`);
  }
  if (!code) {
    return c.html(`<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">No code received</h1>
      <a href="${returnTo}" style="color:#d4a812;">← Retour</a>
    </body></html>`);
  }

  const userId = await getUserId(c);

  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const DRIVE_REDIRECT_URI = process.env.GOOGLE_DRIVE_REDIRECT_URI || process.env.APP_URL ? `${process.env.APP_URL}/api/drive-callback` : 'http://localhost:3003/api/drive-callback';

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID!,
        client_secret: GOOGLE_CLIENT_SECRET!,
        code,
        redirect_uri: DRIVE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }).toString(),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenData.error_description || tokenData.error || 'Token exchange failed');

    const { access_token, refresh_token, expires_in } = tokenData;
    const expiry = expires_in ? new Date(Date.now() + expires_in * 1000).toISOString() : null;

    await db.execute({
      sql: `INSERT INTO drive_connections (user_id, company_id, access_token, refresh_token, token_expiry, status)
            VALUES (?, ?, ?, ?, ?, 'active')
            ON CONFLICT(id) DO UPDATE SET
              access_token = excluded.access_token,
              refresh_token = excluded.refresh_token,
              token_expiry = excluded.token_expiry,
              status = 'active'`,
      args: [userId, companyId, encrypt(access_token), encrypt(refresh_token), expiry]
    });

    return c.html(`<html><head><meta http-equiv="refresh" content="2;url=${returnTo}"></head><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#10b981;">✅ Drive connecté !</h1>
      <p>Redirection en cours...</p>
      <a href="${returnTo}" style="color:#d4a812;">← Retour</a>
    </body></html>`);
  } catch (err: any) {
    console.error('Drive callback error:', err);
    return c.html(`<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">Error</h1><p>${err.message}</p>
      <a href="${returnTo}" style="color:#d4a812;">← Retour</a>
    </body></html>`);
  }
});

// Recursively collect all subfolder IDs under a given Drive folder (max 5 levels)
async function collectDriveFolderIds(rootId: string, token: string, depth = 0): Promise<string[]> {
  if (depth > 4) return [rootId];
  const ids = [rootId];
  const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and '${rootId}' in parents and trashed=false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=100`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return ids;
  const data: any = await res.json();
  for (const sub of (data.files || [])) {
    const subIds = await collectDriveFolderIds(sub.id, token, depth + 1);
    ids.push(...subIds);
  }
  return ids;
}

// --- In-memory scan status tracker ---
interface ScanStatus {
  status: 'running' | 'done' | 'error';
  total: number;
  processed: number;
  scanned: number;
  matched: number;
  errors: string[];
  started_at: number;
  finished_at?: number;
}
const scanJobs = new Map<string, ScanStatus>();

// Clean up old scan jobs (>1h)
setInterval(() => {
  const cutoff = Date.now() - 3600_000;
  for (const [id, job] of scanJobs) {
    if (job.finished_at && job.finished_at < cutoff) scanJobs.delete(id);
  }
}, 600_000);

// List all PDFs from Drive folder, handling pagination (>100 files)
async function listAllDrivePdfs(folderId: string | null, accessToken: string): Promise<{ id: string; name: string; modifiedTime: string }[]> {
  let query = "mimeType='application/pdf' and trashed=false";
  if (folderId) {
    const allFolderIds = await collectDriveFolderIds(folderId, accessToken);
    const parentClause = allFolderIds.map(id => `'${id}' in parents`).join(' or ');
    query += ` and (${parentClause})`;
  }

  const files: { id: string; name: string; modifiedTime: string }[] = [];
  let pageToken: string | null = null;

  do {
    const params = new URLSearchParams({
      q: query,
      fields: 'nextPageToken,files(id,name,modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: '200',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) break;
    const data: any = await res.json();
    files.push(...(data.files || []));
    pageToken = data.nextPageToken || null;
  } while (pageToken && files.length < 1000); // safety cap

  return files;
}

// Start scan — returns scan_id, processes in background
router.post('/api/invoices/scan', async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json().catch(() => ({}));
  const companyId = body.company_id || null;

  // Drive connection is global (one per user), folders are per-company
  const conn = await db.execute({ sql: 'SELECT * FROM drive_connections WHERE user_id = ? AND status = ? ORDER BY company_id IS NULL DESC LIMIT 1', args: [userId, 'active'] });
  if (conn.rows.length === 0) {
    return c.json({ error: 'No active Google Drive connection. Connect in Settings first.' }, 400);
  }

  const driveConn: any = decryptDriveConn(conn.rows[0]);
  const accessToken = await getDriveAccessToken(driveConn);
  if (!accessToken) return c.json({ error: 'Missing Drive access token' }, 400);

  // Resolve folder
  let folderId = driveConn.folder_id;
  const scanYear = body.year || null;
  if (scanYear) {
    const purpose = companyId ? `invoices_${scanYear}_${companyId}` : `invoices_${scanYear}`;
    const mapping = await db.execute({ sql: 'SELECT folder_id FROM drive_folder_mappings WHERE user_id = ? AND purpose = ?', args: [userId, purpose] });
    if (mapping.rows.length > 0 && mapping.rows[0].folder_id) folderId = String(mapping.rows[0].folder_id);
  }

  // Force re-scan: clear existing cache for this scope
  if (body.force) {
    const delSql = companyId
      ? 'DELETE FROM invoice_cache WHERE user_id = ? AND company_id = ?'
      : 'DELETE FROM invoice_cache WHERE user_id = ? AND company_id IS NULL';
    const delArgs = companyId ? [userId, companyId] : [userId];
    await db.execute({ sql: delSql, args: delArgs });
  }

  const scanId = `scan_${userId}_${Date.now()}`;
  const job: ScanStatus = { status: 'running', total: 0, processed: 0, scanned: 0, matched: 0, errors: [], started_at: Date.now() };
  scanJobs.set(scanId, job);

  // Return immediately — process in background
  // (Do NOT await this promise)
  (async () => {
    try {
      const files = await listAllDrivePdfs(folderId, accessToken);
      job.total = files.length;

      for (const file of files) {
        try {
          // Skip already cached
          const existing = await db.execute({
            sql: 'SELECT id FROM invoice_cache WHERE drive_file_id = ?',
            args: [file.id]
          });
          if (existing.rows.length > 0) {
            job.processed++;
            continue;
          }

          // Download PDF
          const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          if (!dlRes.ok) {
            job.errors.push(`Download failed: ${file.name}`);
            job.processed++;
            continue;
          }

          const buffer = Buffer.from(await dlRes.arrayBuffer());

          // Extract metadata: filename → pdf-parse → Drive OCR
          const extracted = await extractInvoiceMetadata(file.name, buffer, file.id, accessToken);

          // Weighted transaction matching — needs 2 of 3 signals: amount, date, label
          let matchedTxId: number | null = null;
          let bestScore = 0;
          const dateStr = extracted.date || file.modifiedTime?.slice(0, 10) || '';
          const invAmt = extracted.amount ? Math.abs(extracted.amount) : null;

          console.log(`[SCAN] ${file.name} → extracted: amount=${invAmt}, date=${dateStr}, vendor=${extracted.vendor}, method=${extracted.extraction_method}`);

          // Helper: extract USD amount from bank label (e.g. "100,05 USD" → 100.05)
          function extractUsdFromLabel(label: string): number | null {
            const m = label.match(/([\d]+[,.][\d]{2})\s*USD/i);
            if (m) return parseFloat(m[1].replace(',', '.'));
            return null;
          }

          if (invAmt || (extracted.vendor && dateStr)) {
            // Search by date range only — scoring handles the rest
            const matchQuery = companyId
              ? `SELECT t.id, t.label, t.amount, t.date FROM transactions t
                 JOIN bank_accounts ba ON t.bank_account_id = ba.id
                 WHERE ba.company_id = ? AND ba.type = 'checking'
                 AND t.date BETWEEN date(?, '-30 days') AND date(?, '+30 days')
                 AND t.id NOT IN (SELECT transaction_id FROM invoice_cache WHERE transaction_id IS NOT NULL)
                 AND ${blocklist_sql}
                 LIMIT 50`
              : `SELECT t.id, t.label, t.amount, t.date FROM transactions t
                 WHERE t.date BETWEEN date(?, '-30 days') AND date(?, '+30 days')
                 AND t.id NOT IN (SELECT transaction_id FROM invoice_cache WHERE transaction_id IS NOT NULL)
                 LIMIT 50`;
            const matchArgs = companyId
              ? [companyId, dateStr, dateStr]
              : [dateStr, dateStr];

            const txMatches = await db.execute({ sql: matchQuery, args: matchArgs });
            console.log(`[SCAN] ${file.name} → ${txMatches.rows.length} candidates in date range`);

            for (const tx of txMatches.rows as any[]) {
              let score = 0;
              const label = (tx.label as string) || '';

              // Amount scoring — check EUR amount and USD amount from label
              if (invAmt) {
                const eurDiff = Math.abs(Math.abs(tx.amount as number) - invAmt);
                const usdInLabel = extractUsdFromLabel(label);
                const usdDiff = usdInLabel ? Math.abs(usdInLabel - invAmt) : null;

                // Best of EUR or USD match
                const bestDiff = usdDiff !== null ? Math.min(eurDiff, usdDiff) : eurDiff;
                if (bestDiff < 0.02) score += 50;
                else if (bestDiff < 0.5) score += 40;
                else if (bestDiff < 2) score += 25;
                else if (bestDiff / invAmt < 0.05) score += 20;
              }

              // Date scoring
              if (dateStr && tx.date) {
                const daysDiff = Math.abs((new Date(tx.date as string).getTime() - new Date(dateStr).getTime()) / 86400000);
                if (daysDiff <= 1) score += 35;
                else if (daysDiff <= 3) score += 25;
                else if (daysDiff <= 7) score += 15;
                else if (daysDiff <= 14) score += 8;
                else score += 3;
              }

              // Vendor/label scoring
              if (extracted.vendor) {
                const v = extracted.vendor.toLowerCase();
                const l = label.toLowerCase();
                if (l.includes(v) || v.includes(l)) score += 30;
                else {
                  const vWords = v.split(/[\s.,·\-]+/).filter((w: string) => w.length > 3);
                  const matched = vWords.filter((w: string) => l.includes(w));
                  if (matched.length > 0) score += 20;
                }
              }

              if (score > bestScore) {
                bestScore = score;
                matchedTxId = tx.id as number;
              }
            }
            // Need score > 60 — requires at least 2 strong signals (e.g. date+label, date+amount, amount+label)
            console.log(`[SCAN] ${file.name} → best score=${bestScore}, matchedTxId=${matchedTxId}`);
            if (bestScore <= 60) { matchedTxId = null; bestScore = 0; }
            if (matchedTxId) job.matched++;
          } else {
            console.log(`[SCAN] ${file.name} → NO AMOUNT or VENDOR+DATE, skipping matching`);
          }

          // Truncate raw_text for storage (keep first 2000 chars)
          const storedText = extracted.raw_text ? extracted.raw_text.slice(0, 2000) : null;

          await db.execute({
            sql: `INSERT INTO invoice_cache (user_id, company_id, transaction_id, drive_file_id, filename, vendor, amount_ht, tva_amount, tva_rate, date, invoice_number, match_confidence, raw_text, extraction_method)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [userId, companyId, matchedTxId, file.id, file.name,
                   extracted.vendor || null, extracted.amount || null,
                   extracted.tva_amount || null, extracted.tva_rate || null,
                   extracted.date || null, extracted.invoice_number || null,
                   matchedTxId ? bestScore / 100 : null,
                   storedText, extracted.extraction_method]
          });
          job.scanned++;
        } catch (e: any) {
          job.errors.push(`${file.name}: ${e.message}`);
        }
        job.processed++;
      }

      job.status = 'done';
      job.finished_at = Date.now();
    } catch (e: any) {
      job.status = 'error';
      job.errors.push(e.message);
      job.finished_at = Date.now();
    }
  })();

  return c.json({ scan_id: scanId, total: 0, status: 'running' });
});

// Debug: show cached invoices extraction results and why they didn't match
router.get('/api/invoices/debug', async (c) => {
  const userId = await getUserId(c);
  const companyId = c.req.query('company_id');
  if (!companyId) return c.json({ error: 'company_id required' });
  const cid = Number(companyId);
  const invoices = await db.execute({
    sql: `SELECT id, filename, vendor, amount_ht, date, extraction_method, transaction_id, match_confidence
          FROM invoice_cache WHERE user_id = ? AND company_id = ? ORDER BY date DESC`,
    args: [userId, cid]
  });
  // For unmatched invoices with an amount, show nearest transactions
  const results = [];
  for (const inv of invoices.rows as any[]) {
    const entry: any = { ...inv };
    if (!inv.transaction_id && inv.amount_ht) {
      const dateStr = inv.date || '2025-01-01';
      const amt = Math.abs(inv.amount_ht);
      const candidates = await db.execute({
        sql: `SELECT t.id, t.label, t.amount, t.date, ABS(ABS(t.amount) - ?) as amt_diff
              FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id
              WHERE ba.company_id = ? AND ba.type = 'checking'
              AND t.date BETWEEN date(?, '-60 days') AND date(?, '+60 days')
              ORDER BY ABS(ABS(t.amount) - ?) LIMIT 5`,
        args: [amt, cid, dateStr, dateStr, amt]
      });
      entry.nearest_transactions = candidates.rows;
    }
    results.push(entry);
  }
  return c.json(results);
});

// Poll scan progress
router.get('/api/invoices/scan/:scanId', async (c) => {
  const scanId = c.req.param('scanId');
  const job = scanJobs.get(scanId);
  if (!job) return c.json({ status: 'not_found' }, 404);
  return c.json(job);
});

// --- Tesseract OCR: PDF → images → text (local, fast, no network) ---
async function tesseractOcrExtractText(buffer: Buffer): Promise<string | null> {
  try {
    // Check tesseract is available
    execSync('which tesseract', { stdio: 'ignore' });
  } catch {
    console.log('[SCAN] Tesseract not installed, skipping');
    return null;
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-'));
  try {
    const pdfPath = path.join(tmpDir, 'input.pdf');
    fs.writeFileSync(pdfPath, buffer);
    // Convert PDF to PNG images (one per page)
    execSync(`pdftoppm -png -r 300 "${pdfPath}" "${path.join(tmpDir, 'page')}"`, { timeout: 15000 });
    // OCR each page
    const pages = fs.readdirSync(tmpDir).filter(f => f.startsWith('page') && f.endsWith('.png')).sort();
    let fullText = '';
    for (const page of pages) {
      const imgPath = path.join(tmpDir, page);
      const text = execSync(`tesseract "${imgPath}" - -l eng+fra 2>/dev/null`, { timeout: 15000 }).toString();
      fullText += text + '\n';
    }
    return fullText.trim() || null;
  } catch (e: any) {
    console.log(`[SCAN] Tesseract error: ${e.message}`);
    return null;
  } finally {
    // Cleanup temp files
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
  }
}

// --- Drive OCR: copy PDF as Google Doc → export text → delete temp doc ---
async function driveOcrExtractText(driveFileId: string, accessToken: string): Promise<string | null> {
  try {
    // 1. Copy the file as a Google Doc (triggers OCR)
    const copyRes = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}/copy`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mimeType: 'application/vnd.google-apps.document', name: '_ocr_temp' }),
    });
    if (!copyRes.ok) {
      console.error('Drive OCR copy failed:', await copyRes.text());
      return null;
    }
    const copyData: any = await copyRes.json();
    const tempDocId = copyData.id;

    // 2. Export as plain text
    const exportRes = await fetch(`https://www.googleapis.com/drive/v3/files/${tempDocId}/export?mimeType=text/plain`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const text = exportRes.ok ? await exportRes.text() : null;

    // 3. Delete temp doc (fire-and-forget)
    fetch(`https://www.googleapis.com/drive/v3/files/${tempDocId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => {});

    return text && text.trim().length > 5 ? text : null;
  } catch (e: any) {
    console.error('Drive OCR error:', e.message);
    return null;
  }
}

// Parse structured fields from raw text (used for both pdf-parse and Drive OCR output)
function parseInvoiceText(text: string): { vendor?: string; amount?: number; date?: string; invoice_number?: string; tva_amount?: number; tva_rate?: number } {
  const result: { vendor?: string; amount?: number; date?: string; invoice_number?: string; tva_amount?: number; tva_rate?: number } = {};

  // Date: DD/MM/YYYY or DD.MM.YYYY
  const pdfDate = text.match(/(\d{2})[/.](\d{2})[/.](\d{4})/);
  if (pdfDate) result.date = `${pdfDate[3]}-${pdfDate[2]}-${pdfDate[1]}`;

  // Date: English format "Month DD, YYYY" or "due Month DD, YYYY"
  const monthMapEn: Record<string, string> = { january:'01', february:'02', march:'03', april:'04', may:'05', june:'06', july:'07', august:'08', september:'09', october:'10', november:'11', december:'12' };
  if (!result.date) {
    const engDate = text.match(/(?:due\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i);
    if (engDate) result.date = `${engDate[3]}-${monthMapEn[engDate[1].toLowerCase()]}-${String(engDate[2]).padStart(2, '0')}`;
  }

  // Date: French format "21 novembre 2025"
  const monthMapFr: Record<string, string> = { janvier:'01', 'février':'02', fevrier:'02', mars:'03', avril:'04', mai:'05', juin:'06', juillet:'07', 'août':'08', aout:'08', septembre:'09', octobre:'10', novembre:'11', 'décembre':'12', decembre:'12' };
  if (!result.date) {
    const frDate = text.match(/(\d{1,2})\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre)\s+(\d{4})/i);
    if (frDate) result.date = `${frDate[3]}-${monthMapFr[frDate[2].toLowerCase()]}-${String(frDate[1]).padStart(2, '0')}`;
  }

  // Date: YYYY-MM-DD (ISO)
  if (!result.date) {
    const isoDate = text.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoDate) result.date = `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;
  }

  // Invoice number
  const pdfInv = text.match(/(?:facture|invoice|n°|nummer|rechnung)\s*:?\s*([A-Z]*-?\d{4,}[-/]?\d*)/i);
  if (pdfInv) result.invoice_number = pdfInv[1];

  // Total TTC — most reliable amount for matching (ordered by specificity)
  const ttcPatterns = [
    // "Amount due" / "Montant dû" — the most reliable final amount
    /montant\s+d[ûu]\s*:?\s*(?:[$€])?\s*([\d\s,.]+\d{2})/i,
    /amount\s+due\s*:?\s*(?:[$€])?\s*([\d\s,.]+\d{2})/i,
    // Standard French/German patterns
    /total\s+t\.?t\.?c\.?\s*:?\s*([\d\s]+[.,]\d{2})/i,
    /montant\s+t\.?t\.?c\.?\s*:?\s*([\d\s]+[.,]\d{2})/i,
    /net\s+[àa]\s+payer\s*:?\s*([\d\s]+[.,]\d{2})/i,
    /gesamtbetrag\s*:?\s*([\d\s]+[.,]\d{2})/i,
    /total\s*:?\s*([\d\s]+[.,]\d{2})\s*€?$/im,
  ];
  for (const pat of ttcPatterns) {
    const m = text.match(pat);
    if (m) {
      const val = parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
      if (val > 0 && val < 1_000_000) { result.amount = val; break; }
    }
  }

  // Total HT
  if (!result.amount) {
    const htMatch = text.match(/total\s+h\.?t\.?\s*:?\s*([\d\s]+[.,]\d{2})/i)
      || text.match(/montant\s+h\.?t\.?\s*:?\s*([\d\s]+[.,]\d{2})/i);
    if (htMatch) {
      const ht = parseFloat(htMatch[1].replace(/\s/g, '').replace(',', '.'));
      if (ht > 0) result.amount = ht;
    }
  }

  // Currency-prefixed amounts: $30.00, €21.60, USD 30.00, EUR 21.60
  if (!result.amount) {
    const currMatch = text.match(/[$€]\s*([\d,]+\.\d{2})/);
    if (currMatch) {
      const val = parseFloat(currMatch[1].replace(',', ''));
      if (val > 0 && val < 1_000_000) result.amount = val;
    }
  }
  if (!result.amount) {
    const currMatch2 = text.match(/([\d\s]+[.,]\d{2})\s*(?:USD|EUR|€|\$)/);
    if (currMatch2) {
      const val = parseFloat(currMatch2[1].replace(/\s/g, '').replace(',', '.'));
      if (val > 0 && val < 1_000_000) result.amount = val;
    }
  }

  // TVA
  const tvaMatch = text.match(/t\.?v\.?a\.?\s*(?:\(?\s*(\d+(?:[.,]\d+)?)\s*%?\)?)?\s*:?\s*([\d\s]+[.,]\d{2})/i);
  if (tvaMatch) {
    if (tvaMatch[1]) result.tva_rate = parseFloat(tvaMatch[1].replace(',', '.'));
    result.tva_amount = parseFloat(tvaMatch[2].replace(/\s/g, '').replace(',', '.'));
  }

  // Vendor: first substantial line that isn't a header/date/number
  const lines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 3 && !/^\d+$/.test(l));
  const vendorLine = lines.find((l: string) => !/^\d/.test(l) && !/facture|invoice|date|siret|siren|tva|iban|total|montant/i.test(l) && l.length < 60);
  if (vendorLine) result.vendor = vendorLine;

  return result;
}

interface ExtractionResult {
  vendor?: string;
  amount?: number;
  date?: string;
  invoice_number?: string;
  tva_amount?: number;
  tva_rate?: number;
  raw_text?: string;
  extraction_method: string; // 'filename' | 'pdf-parse' | 'drive-ocr'
}

// Extract invoice metadata: filename → pdf-parse → Drive OCR fallback
async function extractInvoiceMetadata(filename: string, buffer: Buffer, driveFileId: string, accessToken: string): Promise<ExtractionResult> {
  const result: ExtractionResult = { extraction_method: 'filename' };

  // --- 1. Parse from filename (always) ---
  const dateMatch = filename.match(/(\d{4})-(\d{2})-(\d{2})/) || filename.match(/(\d{2})-(\d{2})-(\d{4})/);
  if (dateMatch) {
    result.date = dateMatch[1].length === 4
      ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
      : `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
  }
  const amountMatch = filename.match(/(\d+[.,]\d{2})/);
  if (amountMatch) result.amount = parseFloat(amountMatch[1].replace(',', '.'));

  const cleaned = filename.replace(/\.pdf$/i, '').replace(/[\d_-]+/g, ' ').trim();
  const words = cleaned.split(/\s+/).filter(w => w.length > 2);
  if (words.length > 0) result.vendor = words.join(' ');

  const invMatch = filename.match(/(F|FA|INV|FACT)[- ]?\d+[- ]?\d*/i);
  if (invMatch) result.invoice_number = invMatch[0];

  // --- 2. Try pdf-parse (fast, for text-based PDFs) ---
  let rawText = '';
  try {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse(new Uint8Array(buffer));
    const pdfResult = await parser.getText();
    rawText = pdfResult.text || '';
  } catch {}

  if (rawText.trim().length > 200) {
    // Substantial text from pdf-parse — trust it
    result.extraction_method = 'pdf-parse';
    result.raw_text = rawText;
    const parsed = parseInvoiceText(rawText);
    if (parsed.date) result.date = parsed.date;
    if (parsed.amount) result.amount = parsed.amount;
    if (parsed.vendor) result.vendor = parsed.vendor;
    if (parsed.invoice_number) result.invoice_number = parsed.invoice_number;
    if (parsed.tva_amount) result.tva_amount = parsed.tva_amount;
    if (parsed.tva_rate) result.tva_rate = parsed.tva_rate;
    if (result.amount && result.date) return result;
    console.log(`[SCAN] pdf-parse text >200 chars but missing amount or date, trying Tesseract`);
  } else if (rawText.trim().length > 0) {
    console.log(`[SCAN] pdf-parse got only ${rawText.trim().length} chars, falling through to Tesseract`);
  }

  // --- 3. Tesseract OCR (local, fast, no network) ---
  const tesseractText = await tesseractOcrExtractText(buffer);
  if (tesseractText && tesseractText.trim().length > 20) {
    result.extraction_method = 'tesseract';
    result.raw_text = tesseractText;
    const parsed = parseInvoiceText(tesseractText);
    if (parsed.date) result.date = parsed.date;
    if (parsed.amount) result.amount = parsed.amount;
    if (parsed.vendor) result.vendor = parsed.vendor;
    if (parsed.invoice_number) result.invoice_number = parsed.invoice_number;
    if (parsed.tva_amount) result.tva_amount = parsed.tva_amount;
    if (parsed.tva_rate) result.tva_rate = parsed.tva_rate;
    if (result.amount || result.date) return result;
    console.log(`[SCAN] Tesseract got text but no useful fields, falling through to Drive OCR`);
  }

  // --- 4. Last resort: Drive OCR (network-dependent) ---
  const ocrText = await driveOcrExtractText(driveFileId, accessToken);
  if (ocrText && ocrText.trim().length > 20) {
    result.extraction_method = 'drive-ocr';
    result.raw_text = ocrText;
    const parsed = parseInvoiceText(ocrText);
    if (parsed.date) result.date = parsed.date;
    if (parsed.amount) result.amount = parsed.amount;
    if (parsed.vendor) result.vendor = parsed.vendor;
    if (parsed.invoice_number) result.invoice_number = parsed.invoice_number;
    if (parsed.tva_amount) result.tva_amount = parsed.tva_amount;
    if (parsed.tva_rate) result.tva_rate = parsed.tva_rate;
  }

  return result;
}

// Get all cached invoices
router.get('/api/invoices', async (c) => {
  const userId = await getUserId(c);
  const companyId = c.req.query('company_id');
  const matched = c.req.query('matched'); // 'true', 'false', or omit for all

  let sql = 'SELECT ic.*, t.label as tx_label, t.amount as tx_amount, t.date as tx_date FROM invoice_cache ic LEFT JOIN transactions t ON ic.transaction_id = t.id WHERE ic.user_id = ?';
  const args: any[] = [userId];

  if (companyId) {
    sql += ' AND ic.company_id = ?';
    args.push(Number(companyId));
  }
  if (matched === 'true') {
    sql += ' AND ic.transaction_id IS NOT NULL';
  } else if (matched === 'false') {
    sql += ' AND ic.transaction_id IS NULL';
  }

  sql += ' ORDER BY ic.date DESC, ic.scanned_at DESC';

  const result = await db.execute({ sql, args });
  return c.json(result.rows);
});

// Delete cached invoice
router.delete('/api/invoices/:id', async (c) => {
  const id = c.req.param('id');
  await db.execute({ sql: 'DELETE FROM invoice_cache WHERE id = ?', args: [Number(id)] });
  return c.json({ ok: true });
});

// Manual match: link invoice to transaction
router.post('/api/invoices/:id/match', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { transaction_id } = body;
  await db.execute({
    sql: 'UPDATE invoice_cache SET transaction_id = ?, match_confidence = 1.0 WHERE id = ?',
    args: [transaction_id, Number(id)]
  });
  return c.json({ ok: true });
});

// Unmatch invoice
router.post('/api/invoices/:id/unmatch', async (c) => {
  const id = c.req.param('id');
  await db.execute({
    sql: 'UPDATE invoice_cache SET transaction_id = NULL, match_confidence = NULL WHERE id = ?',
    args: [Number(id)]
  });
  return c.json({ ok: true });
});

// Transactions starting with these prefixes are excluded from rapprochement
// (justified by annual bank statements / IFU — no individual justificatif needed)
const RAPPROCHEMENT_LABEL_BLOCKLIST = [
  'COUPONS',
];
const blocklist_sql = RAPPROCHEMENT_LABEL_BLOCKLIST.map(p => `t.label NOT LIKE '${p}%'`).join(' AND ');

// Invoice stats — transaction-centric for companies, file-centric for personal
router.get('/api/invoices/stats', async (c) => {
  const userId = await getUserId(c);
  const companyId = c.req.query('company_id');
  const year = parseInt(c.req.query('year') || String(new Date().getFullYear() - 1));

  if (companyId) {
    const start = `${year}-01-01`, end = `${year + 1}-01-01`;
    const cid = Number(companyId);
    const totalRes = await db.execute({
      sql: `SELECT COUNT(*) as c FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id WHERE ba.company_id = ? AND ba.type = 'checking' AND t.date >= ? AND t.date < ? AND ${blocklist_sql}`,
      args: [cid, start, end]
    });
    const matchedRes = await db.execute({
      sql: `SELECT COUNT(*) as c FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id WHERE ba.company_id = ? AND ba.type = 'checking' AND t.date >= ? AND t.date < ? AND ${blocklist_sql} AND EXISTS (SELECT 1 FROM invoice_cache ic WHERE ic.transaction_id = t.id)`,
      args: [cid, start, end]
    });
    const total = Number(totalRes.rows[0]?.c || 0);
    const matched = Number(matchedRes.rows[0]?.c || 0);
    return c.json({ total, matched, unmatched: total - matched, match_rate: total > 0 ? Math.round((matched / total) * 100) : 0, year });
  }

  const args: any[] = [userId];
  const total = await db.execute({ sql: `SELECT COUNT(*) as c FROM invoice_cache WHERE user_id = ?`, args });
  const matchedCount = await db.execute({ sql: `SELECT COUNT(*) as c FROM invoice_cache WHERE user_id = ? AND transaction_id IS NOT NULL`, args });
  const unmatchedCount = await db.execute({ sql: `SELECT COUNT(*) as c FROM invoice_cache WHERE user_id = ? AND transaction_id IS NULL`, args });
  const totalVal = Number(total.rows[0]?.c || 0);
  const matchedVal = Number(matchedCount.rows[0]?.c || 0);
  return c.json({ total: totalVal, matched: matchedVal, unmatched: Number(unmatchedCount.rows[0]?.c || 0), match_rate: totalVal > 0 ? Math.round((matchedVal / totalVal) * 100) : 0 });
});

// Transactions with invoice status (for company rapprochement view)
router.get('/api/invoices/transactions', async (c) => {
  const companyId = c.req.query('company_id');
  const year = parseInt(c.req.query('year') || String(new Date().getFullYear() - 1));
  const matched = c.req.query('matched');
  if (!companyId) return c.json([]);
  const start = `${year}-01-01`, end = `${year + 1}-01-01`;
  let sql = `SELECT t.id, t.label, t.amount, t.date, t.category,
    ic.id as invoice_id, ic.filename, ic.drive_file_id, ic.vendor, ic.amount_ht, ic.date as invoice_date
    FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id
    LEFT JOIN invoice_cache ic ON ic.transaction_id = t.id
    WHERE ba.company_id = ? AND ba.type = 'checking' AND t.date >= ? AND t.date < ? AND ${blocklist_sql}`;
  const args: any[] = [Number(companyId), start, end];
  if (matched === 'true') sql += ' AND ic.id IS NOT NULL';
  else if (matched === 'false') sql += ' AND ic.id IS NULL';
  sql += ' ORDER BY t.date DESC';
  const result = await db.execute({ sql, args });
  return c.json(result.rows);
});

// List all Drive files for a company (for manual linking)
router.get('/api/invoices/files', async (c) => {
  const userId = await getUserId(c);
  const companyId = c.req.query('company_id');
  if (!companyId) return c.json([]);
  const result = await db.execute({
    sql: `SELECT ic.id, ic.filename, ic.drive_file_id, ic.date, ic.vendor, ic.amount_ht, ic.transaction_id
          FROM invoice_cache ic WHERE ic.user_id = ? AND ic.company_id = ?
          ORDER BY ic.transaction_id IS NOT NULL, ic.scanned_at DESC`,
    args: [userId, Number(companyId)]
  });
  return c.json(result.rows);
});

// Manually link an existing Drive file (invoice_cache) to a transaction
router.post('/api/invoices/link', async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json().catch(() => ({}));
  const { invoice_id, transaction_id } = body;
  if (!invoice_id || !transaction_id) return c.json({ error: 'Missing fields' }, 400);
  // Verify ownership
  const check = await db.execute({ sql: 'SELECT id FROM invoice_cache WHERE id = ? AND user_id = ?', args: [invoice_id, userId] });
  if (check.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  // Unlink any existing invoice for this transaction first
  await db.execute({ sql: 'UPDATE invoice_cache SET transaction_id = NULL WHERE transaction_id = ? AND user_id = ?', args: [transaction_id, userId] });
  // Link
  await db.execute({ sql: 'UPDATE invoice_cache SET transaction_id = ?, match_confidence = 1.0 WHERE id = ? AND user_id = ?', args: [transaction_id, invoice_id, userId] });
  return c.json({ ok: true });
});

// Upload invoice file to Drive and link to transaction
router.post('/api/invoices/upload', async (c) => {
  const userId = await getUserId(c);
  const formData = await c.req.formData();
  const file = formData.get('file') as File;
  const transactionId = Number(formData.get('transaction_id'));
  const companyId = formData.get('company_id') ? Number(formData.get('company_id')) : null;
  if (!file || !transactionId) return c.json({ error: 'Missing file or transaction_id' }, 400);

  const connSql = companyId
    ? 'SELECT * FROM drive_connections WHERE user_id = ? AND company_id = ? AND status = ? LIMIT 1'
    : 'SELECT * FROM drive_connections WHERE user_id = ? AND company_id IS NULL AND status = ? LIMIT 1';
  const connArgs = companyId ? [userId, companyId, 'active'] : [userId, 'active'];
  const conn = await db.execute({ sql: connSql, args: connArgs });
  if (conn.rows.length === 0) return c.json({ error: 'No Drive connection' }, 400);

  const driveConn: any = decryptDriveConn(conn.rows[0]);
  const accessToken = await getDriveAccessToken(driveConn);
  const folderId = driveConn.folder_id;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const metadata = JSON.stringify({ name: file.name, ...(folderId ? { parents: [folderId] } : {}) });
  const boundary = 'konto_upload_boundary';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${file.type || 'application/pdf'}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--`)
  ]);

  const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary="${boundary}"` },
    body
  });
  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    return c.json({ error: 'Drive upload failed', details: err }, 502);
  }
  const uploaded: any = await uploadRes.json();

  // Remove any existing invoice link for this transaction then insert new one
  await db.execute({ sql: 'DELETE FROM invoice_cache WHERE transaction_id = ? AND user_id = ?', args: [transactionId, userId] });
  await db.execute({
    sql: `INSERT INTO invoice_cache (user_id, company_id, transaction_id, drive_file_id, filename, match_confidence) VALUES (?, ?, ?, ?, ?, 1.0)`,
    args: [userId, companyId, transactionId, uploaded.id, file.name]
  });
  return c.json({ ok: true, drive_file_id: uploaded.id, filename: file.name });
});


// ========== PAYSLIPS (Global Drive + Monthly Payslips) ==========

// --- Drive folder mappings (per purpose) ---

router.get('/api/drive/folder-mapping', async (c) => {
  const userId = await getUserId(c);
  const purpose = c.req.query('purpose');
  if (!purpose) return c.json({ error: 'purpose required' }, 400);

  const result = await db.execute({
    sql: 'SELECT * FROM drive_folder_mappings WHERE user_id = ? AND purpose = ?',
    args: [userId, purpose]
  });
  if (result.rows.length === 0) return c.json({ mapping: null });
  return c.json({ mapping: result.rows[0] });
});

router.put('/api/drive/folder-mapping', async (c) => {
  const userId = await getUserId(c);
  const { purpose, folder_id, folder_path } = await c.req.json();
  if (!purpose || !folder_id) return c.json({ error: 'purpose and folder_id required' }, 400);

  await db.execute({
    sql: `INSERT INTO drive_folder_mappings (user_id, purpose, folder_id, folder_path)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, purpose) DO UPDATE SET folder_id = excluded.folder_id, folder_path = excluded.folder_path`,
    args: [userId, purpose, folder_id, folder_path || null]
  });
  return c.json({ ok: true });
});

router.delete('/api/drive/folder-mapping', async (c) => {
  const userId = await getUserId(c);
  const purpose = c.req.query('purpose');
  if (!purpose) return c.json({ error: 'purpose required' }, 400);
  await db.execute({ sql: 'DELETE FROM drive_folder_mappings WHERE user_id = ? AND purpose = ?', args: [userId, purpose] });
  return c.json({ ok: true });
});

// --- Payslips CRUD ---

router.get('/api/payslips', async (c) => {
  const userId = await getUserId(c);
  const year = parseInt(c.req.query('year') || String(new Date().getFullYear()));

  const result = await db.execute({
    sql: 'SELECT * FROM payslips WHERE user_id = ? AND year = ? ORDER BY month',
    args: [userId, year]
  });
  return c.json({ payslips: result.rows });
});

router.patch('/api/payslips/:id', async (c) => {
  const userId = await getUserId(c);
  const id = parseInt(c.req.param('id'));
  const body = await c.req.json();

  const fields: string[] = [];
  const args: any[] = [];

  for (const key of ['gross', 'net', 'employer', 'status', 'drive_file_id', 'filename']) {
    if (body[key] !== undefined) {
      fields.push(`${key} = ?`);
      args.push(body[key]);
    }
  }

  if (fields.length === 0) return c.json({ error: 'No fields to update' }, 400);
  args.push(id, userId);

  await db.execute({
    sql: `UPDATE payslips SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
    args
  });
  return c.json({ ok: true });
});

router.delete('/api/payslips/:id', async (c) => {
  const userId = await getUserId(c);
  const id = parseInt(c.req.param('id'));
  await db.execute({ sql: 'DELETE FROM payslips WHERE id = ? AND user_id = ?', args: [id, userId] });
  return c.json({ ok: true });
});

// --- Payslip link (link existing Drive file to a month) ---

router.post('/api/payslips/link', async (c) => {
  const userId = await getUserId(c);
  const { year, month, drive_file_id, filename } = await c.req.json();
  if (!year || !month || !drive_file_id) return c.json({ error: 'year, month, drive_file_id required' }, 400);

  await db.execute({
    sql: `INSERT INTO payslips (user_id, year, month, drive_file_id, filename, status)
          VALUES (?, ?, ?, ?, ?, 'pending')
          ON CONFLICT(user_id, year, month) DO UPDATE SET drive_file_id = excluded.drive_file_id, filename = excluded.filename, status = 'pending'`,
    args: [userId, year, month, drive_file_id, filename || null]
  });

  // Try to extract from this PDF
  const conn = await db.execute({
    sql: 'SELECT * FROM drive_connections WHERE user_id = ? AND company_id IS NULL AND status = ? LIMIT 1',
    args: [userId, 'active']
  });
  if (conn.rows.length > 0) {
    const driveConn: any = decryptDriveConn(conn.rows[0]);
    try {
      const driveToken = await getDriveAccessToken(driveConn);
      const extracted = await extractPayslipFromDrive(drive_file_id, driveToken);
      if (extracted.gross || extracted.net) {
        await db.execute({
          sql: `UPDATE payslips SET gross = ?, net = ?, employer = ?, status = 'extracted' WHERE user_id = ? AND year = ? AND month = ?`,
          args: [extracted.gross || null, extracted.net || null, extracted.employer || null, userId, year, month]
        });
      }
    } catch (e: any) {
      console.error('Payslip extraction error:', e.message);
    }
  }

  const result = await db.execute({
    sql: 'SELECT * FROM payslips WHERE user_id = ? AND year = ? AND month = ?',
    args: [userId, year, month]
  });
  return c.json({ payslip: result.rows[0] || null });
});

// --- Payslip upload (upload local file to Drive folder + link) ---

router.post('/api/payslips/upload', async (c) => {
  const userId = await getUserId(c);

  const formData = await c.req.formData();
  const file = formData.get('file') as File;
  const year = parseInt(formData.get('year') as string);
  const month = parseInt(formData.get('month') as string);

  if (!file || !year || !month) return c.json({ error: 'file, year, month required' }, 400);

  // Get global drive connection
  const conn = await db.execute({
    sql: 'SELECT * FROM drive_connections WHERE user_id = ? AND company_id IS NULL AND status = ? LIMIT 1',
    args: [userId, 'active']
  });
  if (conn.rows.length === 0) return c.json({ error: 'No Drive connection' }, 400);
  const driveConn: any = decryptDriveConn(conn.rows[0]);
  const uploadToken = await getDriveAccessToken(driveConn);

  // Get payslips folder mapping
  const mapping = await db.execute({
    sql: 'SELECT * FROM drive_folder_mappings WHERE user_id = ? AND purpose = ?',
    args: [userId, 'payslips']
  });
  if (mapping.rows.length === 0) return c.json({ error: 'No payslips folder configured' }, 400);
  const folderId = (mapping.rows[0] as any).folder_id;

  try {
    // Upload to Google Drive
    const fileBuffer = await file.arrayBuffer();
    const metadata = {
      name: file.name,
      parents: [folderId],
    };

    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const body = new Uint8Array(await new Blob([
      delimiter,
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      JSON.stringify(metadata),
      delimiter,
      `Content-Type: ${file.type || 'application/pdf'}\r\n\r\n`,
      new Uint8Array(fileBuffer),
      closeDelimiter,
    ]).arrayBuffer());

    const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${uploadToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      return c.json({ error: 'Upload failed', details: err }, 502);
    }

    const uploaded: any = await uploadRes.json();

    // Link the uploaded file to the payslip
    await db.execute({
      sql: `INSERT INTO payslips (user_id, year, month, drive_file_id, filename, status)
            VALUES (?, ?, ?, ?, ?, 'pending')
            ON CONFLICT(user_id, year, month) DO UPDATE SET drive_file_id = excluded.drive_file_id, filename = excluded.filename, status = 'pending'`,
      args: [userId, year, month, uploaded.id, uploaded.name]
    });

    // Try extraction
    try {
      const extracted = await extractPayslipFromDrive(uploaded.id, uploadToken);
      if (extracted.gross || extracted.net) {
        await db.execute({
          sql: `UPDATE payslips SET gross = ?, net = ?, employer = ?, status = 'extracted' WHERE user_id = ? AND year = ? AND month = ?`,
          args: [extracted.gross || null, extracted.net || null, extracted.employer || null, userId, year, month]
        });
      }
    } catch {}

    const result = await db.execute({
      sql: 'SELECT * FROM payslips WHERE user_id = ? AND year = ? AND month = ?',
      args: [userId, year, month]
    });
    return c.json({ payslip: result.rows[0] || null });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// --- Scan payslips from Drive folder ---

router.post('/api/payslips/scan', async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json().catch(() => ({}));
  const year = parseInt(body.year || String(new Date().getFullYear()));

  // Get global drive connection
  const conn = await db.execute({
    sql: 'SELECT * FROM drive_connections WHERE user_id = ? AND company_id IS NULL AND status = ? LIMIT 1',
    args: [userId, 'active']
  });
  if (conn.rows.length === 0) return c.json({ error: 'No Drive connection' }, 400);
  const driveConn: any = decryptDriveConn(conn.rows[0]);
  const scanToken = await getDriveAccessToken(driveConn);

  // Get payslips folder mapping
  const mapping = await db.execute({
    sql: 'SELECT * FROM drive_folder_mappings WHERE user_id = ? AND purpose = ?',
    args: [userId, 'payslips']
  });
  if (mapping.rows.length === 0) return c.json({ error: 'No payslips folder configured' }, 400);
  const folderId = (mapping.rows[0] as any).folder_id;

  try {
    // List all PDFs in the payslips folder (and subfolders)
    const allFolderIds = await collectDriveFolderIds(folderId, scanToken);
    const parentClause = allFolderIds.map(id => `'${id}' in parents`).join(' or ');
    const query = `mimeType='application/pdf' and trashed=false and (${parentClause})`;

    const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,createdTime,modifiedTime)&orderBy=name&pageSize=200`;
    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${scanToken}` }
    });

    if (!listRes.ok) {
      const err = await listRes.text();
      return c.json({ error: 'Drive API error', details: err }, 502);
    }

    const listData: any = await listRes.json();
    const files = listData.files || [];

    const MONTH_NAMES_FR: Record<string, number> = {
      janvier: 1, fevrier: 2, février: 2, mars: 3, avril: 4, mai: 5, juin: 6,
      juillet: 7, aout: 8, août: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12, décembre: 12,
    };

    const results: { month: number; file_id: string; filename: string }[] = [];

    for (const file of files) {
      const name = (file.name || '').toLowerCase();

      // Try to match file to a month of the given year
      let matchedMonth: number | null = null;

      // Pattern 1: YYYY-MM in filename (e.g., "fiche-paie-2026-01.pdf")
      const ymMatch = name.match(new RegExp(`${year}[\\-_\\s]?(0[1-9]|1[0-2])`));
      if (ymMatch) matchedMonth = parseInt(ymMatch[1]);

      // Pattern 2: MM-YYYY (e.g., "01-2026.pdf")
      if (!matchedMonth) {
        const myMatch = name.match(new RegExp(`(0[1-9]|1[0-2])[\\-_\\s]?${year}`));
        if (myMatch) matchedMonth = parseInt(myMatch[1]);
      }

      // Pattern 3: French month name + year (e.g., "janvier-2026.pdf")
      if (!matchedMonth) {
        for (const [mName, mNum] of Object.entries(MONTH_NAMES_FR)) {
          if (name.includes(mName) && name.includes(String(year))) {
            matchedMonth = mNum;
            break;
          }
        }
      }

      // Pattern 4: file created/modified in the target year — use month from that date
      if (!matchedMonth && file.createdTime) {
        const created = new Date(file.createdTime);
        if (created.getFullYear() === year) {
          matchedMonth = created.getMonth() + 1;
        }
      }

      if (matchedMonth && matchedMonth >= 1 && matchedMonth <= 12) {
        // Check if we already have a better match for this month
        const existing = results.find(r => r.month === matchedMonth);
        if (!existing) {
          results.push({ month: matchedMonth, file_id: file.id, filename: file.name });
        }
      }
    }

    // For each matched file, create/update payslip entry and try extraction
    let scanned = 0;
    let extracted = 0;

    for (const match of results) {
      // Upsert payslip entry
      await db.execute({
        sql: `INSERT INTO payslips (user_id, year, month, drive_file_id, filename, status)
              VALUES (?, ?, ?, ?, ?, 'pending')
              ON CONFLICT(user_id, year, month) DO UPDATE SET
                drive_file_id = CASE WHEN payslips.status = 'confirmed' THEN payslips.drive_file_id ELSE excluded.drive_file_id END,
                filename = CASE WHEN payslips.status = 'confirmed' THEN payslips.filename ELSE excluded.filename END`,
        args: [userId, year, match.month, match.file_id, match.filename]
      });
      scanned++;

      // Try PDF extraction (skip if already confirmed)
      const existing = await db.execute({
        sql: 'SELECT * FROM payslips WHERE user_id = ? AND year = ? AND month = ?',
        args: [userId, year, match.month]
      });
      const payslip: any = existing.rows[0];
      if (payslip && payslip.status !== 'confirmed') {
        try {
          const data = await extractPayslipFromDrive(match.file_id, scanToken);
          if (data.gross || data.net) {
            await db.execute({
              sql: `UPDATE payslips SET gross = ?, net = ?, employer = ?, status = 'extracted' WHERE user_id = ? AND year = ? AND month = ?`,
              args: [data.gross || null, data.net || null, data.employer || null, userId, year, match.month]
            });
            extracted++;
          }
        } catch (e: any) {
          console.error(`Extraction failed for ${match.filename}:`, e.message);
        }
      }
    }

    // Return updated payslips
    const payslipsResult = await db.execute({
      sql: 'SELECT * FROM payslips WHERE user_id = ? AND year = ? ORDER BY month',
      args: [userId, year]
    });

    return c.json({
      ok: true,
      total_files: files.length,
      matched: results.length,
      scanned,
      extracted,
      payslips: payslipsResult.rows,
    });
  } catch (e: any) {
    return c.json({ error: 'Scan failed', details: e.message }, 500);
  }
});

// --- PDF extraction helper for payslips ---

async function extractPayslipFromDrive(fileId: string, accessToken: string): Promise<{ gross: number | null; net: number | null; employer: string | null }> {
  const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!dlRes.ok) throw new Error('Failed to download file');

  const buffer = Buffer.from(await dlRes.arrayBuffer());

  let text = '';
  try {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse(new Uint8Array(buffer));
    const result = await parser.getText();
    text = result.text || '';
  } catch (e: any) {
    console.error('pdf-parse error:', e.message);
    return { gross: null, net: null, employer: null };
  }

  let gross: number | null = null;
  let net: number | null = null;
  let employer: string | null = null;

  // French payslip patterns
  // "Salaire brut" or "SALAIRE BRUT" followed by an amount
  const grossMatch = text.match(/salaire\s+brut[^\d]*?([\d\s]+[.,]\d{2})/i);
  if (grossMatch) {
    gross = parseFloat(grossMatch[1].replace(/\s/g, '').replace(',', '.'));
  }

  // "Net à payer" or "NET A PAYER" or "Net à payer avant impôt"
  const netMatch = text.match(/net\s+[àa]\s+payer(?:\s+avant\s+imp[ôo]t)?[^\d]*?([\d\s]+[.,]\d{2})/i);
  if (netMatch) {
    net = parseFloat(netMatch[1].replace(/\s/g, '').replace(',', '.'));
  }

  // If net not found, try "Net imposable"
  if (!net) {
    const netImpMatch = text.match(/net\s+imposable[^\d]*?([\d\s]+[.,]\d{2})/i);
    if (netImpMatch) {
      net = parseFloat(netImpMatch[1].replace(/\s/g, '').replace(',', '.'));
    }
  }

  // Employer: often in the first few lines of the PDF
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 2);
  if (lines.length > 0) {
    // First non-numeric substantial line is often the employer
    for (const line of lines.slice(0, 10)) {
      if (line.length > 3 && !/^\d+$/.test(line) && !/bulletin/i.test(line) && !/fiche de paie/i.test(line)) {
        employer = line.substring(0, 80);
        break;
      }
    }
  }

  return { gross, net, employer };
}



export default router;
