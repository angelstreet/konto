# Troubleshoot: `/api/preferences` returns 500 in production

## Scope
This document is specific to the production incident where:
- `GET https://konto.angelstreet.io/api/preferences` returns `500`
- frontend settings/sandbox can fail to initialize
- local environment works, but production breaks

## Symptom
Browser/network log:
- `GET /api/preferences 500 (Internal Server Error)`

Frontend impact:
- settings may not load correctly
- sandbox defaults can appear inconsistent if bootstrapping depends on preferences response

## Root cause (confirmed)
The backend fallback path in `getUserId()` attempted to create a demo user when no direct match existed.
On production, another user row already owned the same email (`admin@example.com`), causing:
- `SQLITE_CONSTRAINT: UNIQUE constraint failed: users.email`

That exception bubbled up and produced HTTP 500 on `/api/preferences`.

## Why local could work while prod fails
Local DB and prod DB diverged:
- local: no conflicting row for fallback insert
- prod: conflicting existing row with same unique email

So code path was valid locally but failed against production data.

## Fix that was applied
1. Backend bootstrap hardening for serverless path
- Ensure Vercel entrypoint initializes DB/migrations before serving routes.
- Files:
  - `backend/api/index.ts`
  - `backend/src/index.ts`

2. `getUserId()` fallback corrected
- Reuse existing admin/demo user when present.
- Do **not** blindly insert duplicate email.
- File:
  - `backend/src/shared.ts`

3. Preferences endpoint resilience
- Add safe defaults and normalization.
- `GET` and `PATCH` now return safe JSON even on unexpected DB/logic errors.
- File:
  - `backend/src/routes/preferences.ts`

4. Frontend resilience
- Preferences context starts from defaults and tolerates fetch/update failures.
- File:
  - `frontend/src/PreferencesContext.tsx`

## Verification checklist
Run all checks after deploy:

```bash
# 1) Endpoint should be healthy
curl -sS -D - https://konto.angelstreet.io/api/preferences -o /tmp/prefs.json
cat /tmp/prefs.json

# 2) Status must be 200
curl -sS -o /dev/null -w "%{http_code}\n" https://konto.angelstreet.io/api/preferences

# 3) Response must be valid JSON with preference keys
jq . /tmp/prefs.json
```

Expected:
- HTTP status `200`
- valid JSON payload (not HTML error page)

## Data checks for this exact incident
If you suspect duplicate-user fallback again:

```bash
# Example with Turso/libsql shell or equivalent SQL client
SELECT id, email FROM users WHERE email IN ('admin@example.com', 'demo@konto.app');
```

If unique-email collision exists, code must reuse existing row, not insert a duplicate.

## Prevention rules
- Never let `/api/preferences` crash user boot:
  - backend returns defaults on failure
  - frontend already has defaults before network response
- Keep preference response shape stable even on partial DB failures.
- Add regression test for duplicate-email fallback in `getUserId()`.

## Fast triage playbook
1. Confirm 500 from production endpoint.
2. Check deployment logs for route exceptions.
3. Check DB for unique-email collisions in fallback identities.
4. Verify `/api/preferences` returns 200 + JSON.
5. Verify frontend settings page loads with sane defaults if backend is temporarily degraded.
