# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it responsibly:

- **Email:** security@angelstreet.io
- **Do NOT open a public issue** for security vulnerabilities

We will acknowledge receipt within 48 hours and aim to provide a fix within 7 days for critical issues.

## Security Architecture

### Authentication
- **Production:** Clerk (JWT-based, supports MFA)
- **Local dev:** Legacy username/password bypass (no Clerk required)
- Auth middleware validates JWT on every API request in production

### Data Protection
- **Encryption at rest:** Sensitive columns (bank tokens, connection credentials) encrypted with AES-256-GCM
- **Encryption key:** Stored in `DB_ENCRYPTION_KEY` env variable, never in code
- **Database:** SQLite (local) or Turso (cloud) — no plaintext secrets in DB

### API Security
- CSRF protection on state-changing endpoints
- Rate limiting on auth and sensitive endpoints
- API token required for admin/system endpoints
- Geo-blocking configurable per deployment
- IP blacklisting for abuse prevention

### Banking Data
- Bank credentials are **never stored** — Powens handles authentication
- Only OAuth access tokens are stored (encrypted)
- Tokens auto-refresh; expired connections require user re-authentication
- PII (names, emails) stored in separate `user_profiles` table

### Sandbox / Demo Mode
- Demo user (`demo@konto.app`) has pre-seeded data for testing
- Sandbox uses Powens sandbox environment (no real bank connections)
- No real financial data is included in the repository

## What's NOT in This Repository

- No API keys, tokens, or secrets
- No real user data or database files
- No production configuration
- No internal deployment scripts

## Dependencies

Run `npm audit` regularly. We aim for zero critical/high vulnerabilities.

## Environment Variables

See `.env.example` for all required/optional variables. Never commit `.env` files.

## Checklist for Contributors

- [ ] No hardcoded secrets, tokens, or API keys
- [ ] No personal data (emails, names, IPs) in code
- [ ] Environment variables for all external service configuration
- [ ] Input validation on all user-facing endpoints
- [ ] Auth checks on all protected routes
