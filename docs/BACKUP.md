# Konto Database Backup

Owner: Pika
Scope: Disaster recovery for Konto's Turso database
Canonical: `~/shared/projects/konto/docs/BACKUP.md`
Last Reviewed: 2026-03-29

---

## Overview

Daily automated backups of the Konto Turso database (`konto-angelstreet`), stored locally on the VM with 7-day rolling retention.

## Backup Scripts

| File | Purpose |
|------|---------|
| `scripts/backup-konto.cjs` | Dump Turso DB to local SQLite file |
| `scripts/restore-konto.cjs` | List backups / append restore from local file |

## Backup Location

```
~/shared/projects/konto/backups/konto-YYYY-MM-DD.sqlite
```

## Schedule

Daily at **03:00** via cron (managed in konto project, not openclaw workspace).

```cron
0 3 * * * /home/jndoye/.nvm/versions/node/v22.22.0/bin/node /home/jndoye/shared/projects/konto/scripts/backup-konto.cjs >> /home/jndoye/shared/projects/konto/backups/backup.log 2>&1
```

## Usage

### List available backups

```bash
source ~/.openclaw/secrets/turso.env
export TURSO_KONTO_URL TURSO_KONTO_TOKEN
node scripts/restore-konto.cjs
```

### Restore (append mode)

```bash
source ~/.openclaw/secrets/turso.env
export TURSO_KONTO_URL TURSO_KONTO_TOKEN
node scripts/restore-konto.cjs 2026-03-29
```

### Manual backup (one-off)

```bash
source ~/.openclaw/secrets/turso.env
export TURSO_KONTO_URL TURSO_KONTO_TOKEN
node scripts/backup-konto.cjs
```

## Restore Modes

**Append mode (default):** SQL statements from the backup are executed against the live DB. Existing data is preserved; duplicates (UNIQUE/FOREIGN KEY violations) are skipped silently.

**Full restore:** Requires manual DB reset via Turso console first, then run append restore. Contact Pika for this.

## Verification

After any restore, spot-check key data:

```bash
# Verify backup file is valid SQLite
file backups/konto-2026-03-29.sqlite

# Check it contains expected tables
node -e "const fs=require('fs'); const sql=fs.readFileSync('backups/konto-2026-03-29.sqlite','utf8'); const tables=sql.match(/CREATE TABLE \w+/g); console.log('Tables:', tables);"
```

## Secrets Required

| Variable | Source |
|----------|--------|
| `TURSO_KONTO_URL` | `~/.openclaw/secrets/turso.env` |
| `TURSO_KONTO_TOKEN` | `~/.openclaw/secrets/turso.env` |

## Limitations

- **Append-only restore** — does not delete data newer than the backup
- **No off-VM copy** — backups live on the VM disk only
- **No cross-region redundancy** — if VM disk is lost, backups are lost
- Consider adding off-VM backup (S3, GitHub releases, etc.) for stronger DR

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `TURSO_KONTO_URL or TURSO_KONTO_TOKEN not set` | Source secrets: `source ~/.openclaw/secrets/turso.env` |
| `MODULE_NOT_FOUND` on `@libsql/client` | Run from konto root: `cd ~/shared/projects/konto && node scripts/...` |
| Backup file < 1 KB | Check `backups/backup.log` for errors |
| Restore fails with foreign key errors | Expected if DB schema changed; investigate before re-restore |
