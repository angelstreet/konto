# Authentication Strategy - All Apps

## Overview

All applications use a **hybrid authentication approach**:
- **Production**: Clerk (third-party auth service)
- **Development/Local**: SQLite with user/user test account

This allows seamless development without external dependencies while maintaining production security.

---

## Authentication Modes

### Production Mode (Clerk)
When `CLERK_SECRET_KEY` environment variable is set:
- Users authenticate via Clerk (OAuth, email/password, etc.)
- Clerk handles: registration, login, session management, JWT tokens
- User records synced to local database via Clerk webhooks

### Development Mode (Local SQLite)
When `CLERK_SECRET_KEY` is **NOT** set:
- Authentication bypassed or uses local SQLite
- Default test account: `user@user.com` / `user`
- User sessions managed via simple JWT or session tokens

---

## Standard Test Account

**All apps MUST have this default test account for local development:**

```
Email:    user@user.com
Password: user
Name:     Test User
Role:     user (or equivalent)
```

This account should be automatically created on first run if missing.

---

## Implementation Checklist

For each app, ensure:

### Backend
- [ ] Clerk middleware that checks for `CLERK_SECRET_KEY`
- [ ] If Clerk not configured, bypass auth or use local auth
- [ ] Local auth endpoints: `POST /auth/signin`, `POST /auth/signup`
- [ ] User table with: id, email, name, role, clerk_id (nullable)
- [ ] Seed script to create `user@user.com` test account

### Frontend
- [ ] Clerk provider wrapped around app (production)
- [ ] Dev mode detection (no Clerk publishable key)
- [ ] Local login form for dev mode
- [ ] Auth context that works in both modes

### Environment Variables
```bash
# Production
CLERK_SECRET_KEY=sk_live_...
CLERK_PUBLISHABLE_KEY=pk_live_...

# Development (leave empty or unset)
# CLERK_SECRET_KEY=
# CLERK_PUBLISHABLE_KEY=
```

---

## Password Hashing (Local Mode)

All apps use consistent password hashing:

```javascript
const crypto = require('crypto');
const JWT_SECRET = process.env.JWT_SECRET || 'local-dev-secret';

function hashPassword(password) {
  return crypto
    .createHash('sha256')
    .update(password + JWT_SECRET)
    .digest('hex');
}
```

---

## Apps Status

| App | Clerk (Prod) | Local (Dev) | Test Account | Docs |
|-----|-------------|-------------|--------------|------|
| konto | ✅ | ⚠️ Need | ❌ | ❌ |
| kozy | ✅ | ⚠️ Need | ❌ | ❌ |
| ezplanner | ❌ | ✅ | ✅ | ✅ |
| pikaboard | ✅ | ⚠️ Need | ❌ | ❌ |

---

## Migration Plan

1. **Document** - Copy this file to each app's `docs/` folder
2. **Implement** - Add local auth fallback to konto, kozy, pikaboard
3. **Test** - Verify `user@user.com/user` works in all apps
4. **Standardize** - Use same middleware pattern across all apps

---

## Clerk Configuration (Production)

### Shared Clerk Application
All apps can share the same Clerk application for SSO:
- Single sign-on across all apps
- Shared user pool
- Consistent auth experience

**Clerk Dashboard**: https://dashboard.clerk.com

### Per-App Configuration
Alternatively, each app can have its own Clerk app:
- Independent user pools
- Separate billing
- More isolation

---

## Security Notes

- Local auth is **DEVELOPMENT ONLY** - never enable in production
- Always check `process.env.NODE_ENV === 'production'` before bypassing Clerk
- Local password hashing is intentionally simple (SHA256) - not for production
- Clerk handles production security (rate limiting, breach detection, etc.)

---

## Quick Start (Local Development)

1. Clone repo
2. `npm install`
3. **Don't set** `CLERK_SECRET_KEY` in `.env`
4. `npm run dev`
5. Login with `user@user.com` / `user`

Done! 🎯
