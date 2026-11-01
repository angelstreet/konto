# Deployment

## Production (Vercel)

**Auto-deploy:** Push to `main` → GitHub triggers Vercel build → deployed to `konto.angelstreet.io`

No manual deploy step needed. `npx vercel --prod` is redundant.

### What happens on deploy

1. GitHub push reaches Vercel through its **GitHub App** installation
2. Vercel runs `npm install` then `cd frontend && npm run build` (Vite)
3. `api/index.ts` is bundled as a serverless function
4. Frontend static assets served from Vercel CDN
5. API routes handled by serverless function → Turso DB

### The Git link, and how to repair it

Vercel stores the connection as `link.repoId` — a **GitHub repository id**, not
the name. Read it with:

```bash
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects/konto?teamId=$VERCEL_TEAM_ID" | jq .link
```

Two things follow, both learned the hard way on 1 Nov 2026 when the repository
was deleted and recreated to purge private data from its history:

- **Recreating or renaming the repository breaks the link**, because the new
  repository has a new id while Vercel keeps the old one. Pushes then land in
  GitHub and build nothing.
- **It is fixable from a shell** — no dashboard click. Unlink first, or the
  second call fails with `cant_link_project`:

  ```bash
  curl -s -X DELETE -H "Authorization: Bearer $VERCEL_TOKEN" \
    "https://api.vercel.com/v9/projects/$PROJECT_ID/link?teamId=$VERCEL_TEAM_ID"
  curl -s -X POST -H "Authorization: Bearer $VERCEL_TOKEN" \
    -H 'Content-Type: application/json' \
    "https://api.vercel.com/v9/projects/$PROJECT_ID/link?teamId=$VERCEL_TEAM_ID" \
    -d '{"type":"github","repo":"angelstreet/konto"}'
  ```

  The Vercel CLI and the MCP tools cannot do this: `create_git_project`
  explicitly does not reconnect an already-linked project, and
  `update_project`'s `gitSources` is a deployment-source policy, not the link.

**Do not diagnose the link through webhooks.** A GitHub App integration
registers no repository webhook, so `gh api repos/angelstreet/konto/hooks`
returning `0` is normal and says nothing about whether deploys work. Check
`link.repoId` against the live repository id
(`gh api repos/angelstreet/konto --jq .id`).

### Watching a deploy without tripping the firewall

The backend auto-blacklists an IP for an hour after 20 404s in 5 minutes
(`scanning_detected`). Polling a not-yet-deployed route to find out whether a
deploy has landed is exactly that pattern, and it locks the poller out of
everything but `/api/health`. Poll a route that returns 200 and watch a field
change, or list deployments from the Vercel API instead. See
[ARCHITECTURE.md](ARCHITECTURE.md) for how to clear a block.

### Pre-push hook (runs locally)

The repo has a pre-push hook that runs before every `git push`:
- TypeScript check (`tsc --noEmit`)
- Production build (`npm run build`)
- Screenshot generation (Playwright, skipped when no local app URL responds)

Fixes must pass all checks before push is allowed.

`core.hooksPath` is an absolute path to the **main checkout's** `.husky`, so a
worktree runs that copy, not its own. A fix to the hook therefore does not apply
in a worktree until `main` is checked out in the main repository; until then,
run `npm run build` by hand and push with `--no-verify`.

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
