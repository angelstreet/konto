# Konto Demo / Sandbox

## Current State (as of 2026-02-27)

Konto demo mode is currently client-side:

- activated from login (`Essayer en mode démo`) or URL (`?demo=1`)
- marked by `localStorage.konto_sandbox = "true"`
- API responses mocked by `frontend/src/sandbox.ts` fetch interceptor
- visible in UI with a compact `Mode démo` badge

This mode allows full UI interaction (add/edit/delete) but changes are stored in browser localStorage only.

## Known Limitation

Client-side interception is fragile: if frontend and mock payload schemas drift, pages can regress.

Example regressions already seen:

- dashboard scoped request shape mismatch
- analytics payload key mismatch (`totalIncome` vs `total_income`)

## Target Architecture (Recommended)

Move demo to backend-driven isolation while keeping same API contract:

1. Use Clerk-authenticated demo sessions only (no hardcoded password in frontend).
2. Route demo sessions to an isolated demo dataset (preferably dedicated demo DB).
3. Keep API endpoints identical to production.
4. Reset demo dataset daily from seed snapshot (or scheduled restore).
5. Keep frontend logic minimal: only show demo badge.

This removes most schema drift risk because demo and production share the same backend response builders.

## E2E Test Coverage

`tests/e2e/sandbox.test.ts` verifies:

- demo activation works from login
- demo badge is visible
- mock API shape contains required keys
- analytics and dashboard pages do not crash in demo mode

## Files

- `frontend/src/sandbox.ts`
- `frontend/src/main.tsx`
- `frontend/src/components/Layout.tsx`
- `tests/e2e/sandbox.test.ts`
