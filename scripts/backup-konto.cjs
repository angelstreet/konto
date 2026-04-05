/**
 * backup-konto.cjs — Konto Turso DB backup (CJS)
 * Cron: 0 3 * * * node /home/jndoye/shared/projects/konto/scripts/backup-konto.cjs
 */
const { createClient } = require('../node_modules/@libsql/client/lib-cjs/node.js');
const fs   = require('fs');
const path = require('path');

const BACKUP_DIR     = path.resolve(__dirname, '..', 'backups');
const RETENTION_DAYS = 7;
const TURSO_URL      = process.env.TURSO_KONTO_URL;
const TURSO_TOKEN    = process.env.TURSO_KONTO_TOKEN;

if (!TURSO_URL || !TURSO_TOKEN) { console.error('Missing env'); process.exit(1); }

function ts() { return new Date().toISOString().replace(/[:.]/g,'-').slice(0,19); }

async function main() {
  const dateStr     = new Date().toISOString().slice(0,10);
  const backupFile  = path.join(BACKUP_DIR, `konto-${dateStr}.sqlite`);
  const tmpFile     = path.join(BACKUP_DIR, `.konto-${Date.now()}.sqlite`);
  const client      = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

  console.log(`[${ts()}] Backup start`);

  // Schema
  let dump = '';
  const schema = await client.execute(
    "SELECT name,sql FROM sqlite_master WHERE type IN ('table','index','view','trigger') ORDER BY name"
  );
  for (const r of schema.rows) if (r.sql) dump += `${r.sql};\n\n`;

  // Data
  const tables = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  for (const tr of tables.rows) {
    const tbl  = tr.name;
    const cols = (await client.execute(`PRAGMA table_info("${tbl}")`)).rows.map(r => r.name);
    if (!cols.length) continue;
    const data = await client.execute(`SELECT * FROM "${tbl}"`);
    for (const row of data.rows) {
      const vals = cols.map(c => {
        const v = row[c];
        if (v === null || v === undefined) return 'NULL';
        if (typeof v === 'number') return String(v);
        return `'${String(v).replace(/'/g,"''")}'`;
      });
      dump += `INSERT INTO "${tbl}" (${cols.map(c=>`"${c}"`).join(',')}) VALUES (${vals.join(',')});\n`;
    }
  }

  fs.writeFileSync(tmpFile, dump);
  fs.renameSync(tmpFile, backupFile);
  const stat = fs.statSync(backupFile);
  console.log(`  Written: ${path.basename(backupFile)} (${(stat.size/1024).toFixed(1)} KB)`);

  // Cleanup old
  const cutoff = Date.now() - RETENTION_DAYS * 86400000;
  let n = 0;
  for (const f of fs.readdirSync(BACKUP_DIR)) {
    if (f.startsWith('.') || !f.endsWith('.sqlite')) continue;
    if (fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs < cutoff) {
      fs.unlinkSync(path.join(BACKUP_DIR, f));
      console.log(`  Removed: ${f}`);
      n++;
    }
  }

  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.sqlite')).sort();
  console.log(`  Backups: ${files.join(', ')}`);
  console.log(`[${ts()}] Done.`);
  await client.close();
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
