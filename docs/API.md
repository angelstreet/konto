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
```json
{
  "patrimoine_net": 1526045.52,
  "accounts": { "count": 28, "total_balance": 276424.38 },
  "investments": { "count": 76, "total_value": 193072.90 },
  "assets": { "count": 4, "total_value": 1600000 },
  "loans": { "count": 2, "total_remaining": -543451.76 },
  "monthly": { "income": 18766, "expenses": -14763, "savings": 4002 },
  "subscriptions": { "count": 32, "monthly": -15581 },
  "top_expense_categories": [{ "name": "logement", "icon": "🏠", "pct": 32 }],
  "crypto_holdings": [{ "code": "BTC", "value": 14250 }]
}
```

### GET /api/v1/accounts
List bank accounts. Fields: id, name, bank_name, balance, type (checking|savings|investment|loan), usage (personal|professional).

### GET /api/v1/transactions?months=6&category=logement
Transactions with auto-categorization. Params: months (default 6), category, min_amount, max_amount.
Categories: logement, assurance, telecom, auto, impôts, énergie, alimentation, shopping, transport, loisirs, virement, investissement, immobilier, juridique, services, frais bancaires, prélèvement, retrait, autre.

### GET /api/v1/investments
Portfolio positions. Fields: label, code, quantity, unit_value, current_value, type (ISIN|crypto|manual). Includes total_value.

### GET /api/v1/assets
Real estate + other assets. Fields: name, type (real_estate|vehicle|other), current_value, purchase_value, monthly_rent.

### GET /api/v1/loans
Active loans. Fields: name, remaining_amount, monthly_payment, rate, start_date, end_date.

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
| Settings | /api/settings/api-keys (GET/POST/DELETE, POST /:id/renew) |
| Bank | /api/bank/{connect-url,sync,accounts,connections} |
| Dashboard | /api/dashboard, /api/dashboard/history |
| Assets | /api/assets (CRUD) |
| Companies | /api/companies (CRUD) |
| Invoices | /api/invoices/* |
| Reports | /api/report/patrimoine |
| Crypto | /api/crypto/prices, /api/binance/* |

## Errors
401 Unauthorized, 403 Access denied / Analytics scope required, 404 Not found, 429 Rate limited (100 req/min)

## Notes
- All amounts in EUR. Crypto in native units with EUR valuation.
- Dates: ISO 8601 (YYYY-MM-DD)
