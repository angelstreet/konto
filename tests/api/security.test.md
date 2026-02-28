# Security Middleware Tests — Konto API

Test coverage for CSRF protection (#763) and rate limiting (#762).

## Setup

```bash
# Start backend
cd backend && npm run dev
# Backend runs on http://localhost:3004
```

---

## CSRF Protection (feat: #763)

### TC-CSRF-01 — Allowed origin passes through

```bash
curl -X POST http://localhost:3004/api/companies \
  -H "Origin: http://localhost:5173" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Test SARL"}'
# Expected: 200 or 201 (not 403)
```

### TC-CSRF-02 — Invalid origin is blocked

```bash
curl -X POST http://localhost:3004/api/companies \
  -H "Origin: https://evil.attacker.com" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Test SARL"}'
# Expected: 403
# Body: {"error":"Forbidden: invalid Origin header"}
```

### TC-CSRF-03 — No origin header passes (same-origin / server-to-server)

```bash
curl -X POST http://localhost:3004/api/companies \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Test SARL"}'
# Expected: 200 or 201 (no 403 — missing Origin is treated as same-origin)
```

### TC-CSRF-04 — Vercel preview deployment origin allowed

```bash
curl -X POST http://localhost:3004/api/companies \
  -H "Origin: https://konto-preview-abc123.vercel.app" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Test SARL"}'
# Expected: 200 or 201
```

### TC-CSRF-05 — GET requests are not CSRF-checked

```bash
curl -X GET http://localhost:3004/api/companies \
  -H "Origin: https://evil.attacker.com" \
  -H "Authorization: Bearer $TOKEN"
# Expected: 200 (CSRF check does not apply to GET)
```

### TC-CSRF-06 — Skipped paths bypass CSRF check

```bash
# Health endpoint
curl -X POST http://localhost:3004/api/health \
  -H "Origin: https://evil.attacker.com"
# Expected: 200 (skipped)

# Bank callback
curl -X GET http://localhost:3004/api/bank-callback \
  -H "Origin: https://evil.attacker.com"
# Expected: Not 403 (skipped)
```

---

## Rate Limiting (feat: #762)

### TC-RATE-01 — General limit: 100 req/min

```bash
# Send 101 rapid requests
for i in $(seq 1 101); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $TOKEN" \
    http://localhost:3004/api/dashboard)
  echo "Request $i: $STATUS"
done
# Expected: first 100 → 200, request 101+ → 429
```

### TC-RATE-02 — Auth limit: 10 req/min

```bash
# Send 11 rapid login attempts
for i in $(seq 1 11); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST http://localhost:3004/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@test.com","password":"wrong"}')
  echo "Request $i: $STATUS"
done
# Expected: first 10 → non-429, request 11 → 429
```

### TC-RATE-03 — 429 response includes required headers

```bash
# After hitting the rate limit...
curl -v -X POST http://localhost:3004/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"wrong"}'
# Expected headers present:
# Retry-After: <seconds>
# X-RateLimit-Limit: 10
# X-RateLimit-Remaining: 0
# X-RateLimit-Reset: <unix timestamp>
```

### TC-RATE-04 — Rate limit resets after window

```bash
# After hitting limit, wait 60 seconds
sleep 60
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3004/api/dashboard)
echo "After reset: $STATUS"
# Expected: 200 (counter reset)
```

---

## Security Headers

### TC-SEC-01 — Security headers present on all responses

```bash
curl -I http://localhost:3004/api/health
# Expected headers:
# X-Content-Type-Options: nosniff
# X-Frame-Options: DENY
# Strict-Transport-Security: max-age=...
# Permissions-Policy: camera=(), microphone=(), geolocation=()
```
