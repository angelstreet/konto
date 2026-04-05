# Deployment

## Production (Vercel)

**Auto-deploy:** Push to `main` → GitHub triggers Vercel build → deployed to `konto.angelstreet.io`

No manual deploy step needed. `npx vercel --prod` is redundant.

### What happens on deploy

1. GitHub push triggers Vercel webhook
2. Vercel runs `npm install` then `cd frontend && npm run build` (Vite)
3. `api/index.ts` is bundled as a serverless function
4. Frontend static assets served from Vercel CDN
5. API routes handled by serverless function → Turso DB

### Pre-push hook (runs locally)

The repo has a pre-push hook that runs before every `git push`:
- TypeScript check (`tsc --noEmit`)
- Production build (`npm run build`)
- Screenshot generation (Playwright)
- PDF showcase

Fixes must pass all checks before push is allowed.

### Environment variables

Managed via Vercel dashboard or CLI:
```bash
npx vercel env ls --token $VERCEL_TOKEN
npx vercel env add VAR_NAME production --token $VERCEL_TOKEN
```

Token stored in `~/.openclaw/secrets/vercel.env`.

Key env vars: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `CLERK_SECRET_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, `POWENS_*`, `DB_ENCRYPTION_KEY`, `ALLOWED_ORIGINS`, `ETHERSCAN_API_KEY`.

### Service worker update

After deploy, the PWA service worker updates automatically (`registerType: 'autoUpdate'`). Users may need to hard-refresh (Ctrl+Shift+R) once for critical changes to take effect immediately.

## Dev (VM 133)

PM2 processes on openclaw-vm. tsx watch auto-reloads on file changes (shared filesystem).

```bash
# Restart manually
ssh openclaw-vm "PATH=/home/jndoye/.nvm/versions/node/v22.22.0/bin:\$PATH pm2 restart konto-backend"

# Check logs
ssh openclaw-vm "PATH=/home/jndoye/.nvm/versions/node/v22.22.0/bin:\$PATH pm2 logs konto-backend --lines 30"
```

No build step — Vite dev server + tsx watch handle everything.

## Vercel project info

- **Project:** `angelstreets-projects/konto`
- **Project ID:** `prj_QyLVFV2kfS5IAGr8Tp43ZZCA6KMx`
- **Framework:** Vite
- **Build output:** `frontend/dist`
- **Serverless function:** `api/index.ts`
