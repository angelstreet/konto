# Konto API Reference

**Base URL:** `https://your-domain.com` (prod) | `http://localhost:5004` (local)

## Authentication

All API endpoints require authentication via **API Key** or **Clerk JWT**.

### API Key (recommended for agents)
```
Authorization: Bearer konto_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
```
Keys managed in **Settings > Clés API**. Format: `konto_` + 32 hex chars.
Scopes: `personal` (own data, free) | `analytics` (cross-user insights, pro)

---

## Public API — Personal Data (scope: personal)

### GET /api/v1/summary
Complete financial overview. Best for agent quick answers.
Every amount is in **EUR** (see [MONEY.md](MONEY.md)). Figures below are made up.
```json
{
  "patrimoine_net": 270000,
  "accounts": { "count": 12, "total_balance": 120000 },
  "investments": { "count": 20, "total_value": 90000 },
  "assets": { "count": 2, "total_value": 400000 },
  "loans": { "count": 1, "total_remaining": -250000 },
  "monthly": { "income": 6000, "expenses": -4200, "savings": 1800 },
  "subscriptions": { "count": 8, "monthly": -120 },
  "top_expense_categories": [{ "name": "logement", "icon": "🏠", "pct": 32 }],
  "crypto_holdings": [{ "code": "BTC", "value": 9000 }]
}
```
`patrimoine_net` = accounts + assets at gross value − loans. `investments` is a
**breakdown of the investment accounts already inside `accounts.total_balance`**,
not value on top of it — do not add it.

### GET /api/v1/accounts
List bank accounts. Fields: id, name, bank_name, balance, currency, native_balance,
native_currency, type (checking|savings|investment|loan), usage (personal|professional).

`balance` is always converted to EUR; `native_balance` + `native_currency` are the
raw stored amount, which for a crypto wallet is a token quantity (see
[MONEY.md](MONEY.md)).

### GET /api/v1/transactions?months=6&category=logement
Transactions with auto-categorization. Params: months (default 6), category, min_amount, max_amount.
Categories: logement, assurance, telecom, auto, impôts, énergie, alimentation, shopping, transport, loisirs, virement, investissement, immobilier, juridique, services, frais bancaires, prélèvement, retrait, autre.

### GET /api/v1/investments
Portfolio positions. Fields: label, code, quantity, unit_value, current_value, type (ISIN|crypto|manual). Includes total_value.

### GET /api/v1/assets
Real estate + other assets. Fields: name, type (real_estate|vehicle|other), current_value, purchase_value, monthly_rent.

### GET /api/v1/loans
Active loans with full details.
```json
{
  "loans": [
    {
      "name": "Prêt immobilier",
      "remaining_amount": -250000,
      "monthly_payment": 1200,
      "rate": 2.6,
      "start_date": "2023-03-29",
      "end_date": "2048-03-05",
      "duration_months": 300,
      "installments_paid": 15,
      "insurance_monthly": 50,
      "provider": "Bank"
    }
  ]
}
```
Fields: name, remaining_amount (negative), monthly_payment, rate (%),
start_date (YYYY-MM-DD), end_date (YYYY-MM-DD), duration_months,
installments_paid, insurance_monthly, provider.

---

## Public API — Analytics (scope: analytics, pro only)

### GET /api/v1/analytics/demographics
total_users, avg_patrimoine, crypto_holders_pct, real_estate_holders_pct, avg_accounts_per_user

### GET /api/v1/analytics/categories
Spending distribution: category name, avg_pct, median_monthly

### GET /api/v1/analytics/investments
crypto_holders_pct, top_cryptos, avg_portfolio_size, etf_vs_stocks_ratio

### GET /api/v1/analytics/subscriptions
top_subscriptions (merchant, users_pct, avg_amount), avg_monthly_subscriptions

---

## Internal API (Clerk JWT, 125 endpoints)

| Group | Endpoints |
|-------|-----------|
| Analysis | /api/analysis/{categories,subscriptions,summary,cashflow,passive-income} |
| Settings | /api/settings/api-keys (GET/POST/DELETE, POST /:id/renew), /api/settings/integrations (GET/PUT) |
| Bank | /api/bank/{connect-url,sync,accounts,connections} |
| Dashboard | /api/dashboard, /api/dashboard/history |
| Assets | /api/assets (CRUD) |
| Companies | /api/companies (CRUD) |
| Invoices | /api/invoices/* |
| Reports | /api/report/patrimoine |
| Crypto | /api/crypto/prices, /api/binance/* |
| Integration | /api/integration/status |

### GET /api/integration/status
Returns integration/connection status for the authenticated user. Supports API Key or Clerk auth.

**Response:**
```json
{
  "app_id": "konto",
  "authenticated": true,
  "auth_mode": "api_key|clerk",
  "exists": true,
  "local_user_id": 123,
  "clerk_user_id": "user_xxxxx",
  "onboarded": true,
  "available_features": ["summary", "accounts", "transactions", "loans", "assets", "bank_sync"],
  "summary": {
    "has_bank_connections": true,
    "has_accounts": true,
    "has_loans": true,
    "has_assets": true,
    "counts": {
      "bank_connections": 2,
      "accounts": 28,
      "loans": 2,
      "assets": 4
    }
  }
}
```

### GET /api/settings/integrations
Returns per-user integration settings (e.g., Smoobu API key status).

**Response:**
```json
{
  "smoobu_api_key": "••••••••" // null if not set
}
```

### PUT /api/settings/integrations
Update per-user integration settings. Smoobu API key is AES-256-GCM encrypted before storage.

**Request:**
```json
{
  "smoobu_api_key": "your-smoobu-api-key" // null to remove
}
```

**Response:** `{ "ok": true }`

## Errors
401 Unauthorized, 403 Access denied / Analytics scope required, 404 Not found, 429 Rate limited (100 req/min)

## Notes
- All amounts in EUR. Crypto in native units with EUR valuation.
- Dates: ISO 8601 (YYYY-MM-DD)

---

## Caching

The backend keeps a **60-second in-memory GET cache per user+URL** over
`/api/dashboard`, `/api/bank/accounts`, `/api/investments`, `/api/transactions`,
`/api/analytics`, `/api/loans`, `/api/assets` and friends (`CACHED_PREFIXES` in
`backend/src/index.ts`). Any write by that user clears their entries.

`/api/v1/*` is **not** cached. So for up to a minute after a change, `/api/v1/summary`
and `/api/dashboard` can disagree. When testing by hand, bust it:

```bash
curl "$URL/api/dashboard?cb=$(date +%s)"
```
