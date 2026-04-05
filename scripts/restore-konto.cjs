/**
 * restore-konto.cjs — Restore Konto DB from local backup (append mode)
 * Usage: node scripts/restore-konto.cjs [YYYY-MM-DD]
 */
const { createClient } = require('../node_modules/@libsql/client/lib-cjs/node.js');
const fs   = require('fs');
const path = require('path');

const BACKUP_DIR  = path.resolve(__dirname, '..', 'backups');
const TURSO_URL   = process.env.TURSO_KONTO_URL;
const TURSO_TOKEN = process.env.TURSO_KONTO_TOKEN;

if (!TURSO_URL || !TURSO_TOKEN) { console.error('Missing env'); process.exit(1); }

const dateArg = process.argv[2];

if (!dateArg) {
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.sqlite')).sort().reverse();
  console.log('Backups:');
  for (const f of files) {
    const s = fs.statSync(path.join(BACKUP_DIR, f));
    console.log(`  ${f} (${(s.size/1024).toFixed(1)} KB, ${s.mtime.toISOString().slice(0,10)})`);
  }
  process.exit(0);
}

const fpath = path.join(BACKUP_DIR, `konto-${dateArg}.sqlite`);
if (!fs.existsSync(fpath)) { console.error('Not found:', fpath); process.exit(1); }

const sql    = fs.readFileSync(fpath, 'utf8');
const stmts = sql.split(/;\s*\n/).map(s => s.trim()).filter(s => s && !s.startsWith('--'));
const client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
let executed = 0, errors = 0;

(async () => {
  for (const stmt of stmts) {
    try {
      await client.execute(stmt);
      executed++;
    } catch (e) {
      const m = e.message;
      if (!m.includes('already exists') && !m.includes('UNIQUE') && !m.includes('FOREIGN KEY')) {
        console.error(`  ERR: ${m.slice(0,100)}`);
        errors++;
      } else executed++;
    }
  }
  client.close();
  console.log(`Done. Executed: ${executed}, Errors: ${errors}`);
})();
