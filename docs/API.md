# Kompta — API Reference

Base URL: `http://localhost:3004/api`

All responses are JSON. No authentication required (currently).

---

## Health

### `GET /api/health`

```json
{ "status": "ok", "timestamp": "2026-02-08T17:00:00.000Z" }
```

---

## Companies

### `GET /api/companies`

Returns all companies for the default user.

```json
[
  {
    "id": 1, "user_id": 1, "siren": "123456789",
    "name": "My Company", "legal_form": "SAS",
    "address": "1 rue de Paris", "naf_code": "6201Z", "capital": 1000
  }
]
```

### `POST /api/companies`

```json
// Request
{ "name": "My Company", "siren": "123456789", "legal_form": "SAS" }
// Response
{ "id": 1, "name": "My Company", "siren": "123456789", "legal_form": "SAS" }
```

### `PATCH /api/companies/:id`

Update fields: `name`, `siren`, `legal_form`, `address`, `naf_code`, `capital`.

### `DELETE /api/companies/:id`

Unlinks all bank accounts from company, then deletes it.

### `GET /api/companies/search?q=startup`

Search French companies via API Gouv. Returns top 5 matches with SIREN, address, dirigeants, finances.

### `GET /api/companies/info/:siren`

Enriched company info from API Gouv + Pappers + societe.com scraping. Returns SIRET, TVA number, capital, RCS, NAF label, etc.

---

## Bank Accounts

### `GET /api/bank/accounts`

Query params: `usage` (`personal`|`professional`), `company_id`.

```json
[
  {
    "id": 1, "company_id": null, "provider": "powens",
    "name": "Compte Courant", "balance": 1234.56,
    "type": "checking", "usage": "personal", "currency": "EUR"
  }
]
```

### `PATCH /api/bank/accounts/:id`

Update: `custom_name`, `hidden`, `type`, `usage`, `company_id`.

Setting `company_id` automatically sets `usage` to `professional`.

### `DELETE /api/bank/accounts/:id`

Deletes account and all its transactions.

### `POST /api/accounts/manual`

```json
// Request
{ "name": "Revolut", "balance": 500, "type": "checking", "usage": "personal" }
```

### `POST /api/accounts/:id/update-balance`

```json
{ "balance": 1500.00 }
```

### `POST /api/accounts/blockchain`

```json
// Request
{ "address": "bc1q...", "network": "bitcoin", "name": "My BTC Wallet" }
// Response: bank_account object with fetched balance
```

### `POST /api/accounts/:id/sync-blockchain`

Refreshes balance from chain. Returns `{ balance, currency }`.

---

## Powens (Bank Sync)

### `GET /api/bank/connect-url`

Returns `{ url }` — redirect user to this URL to connect their bank.

### `GET /api/bank-callback`

OAuth callback from Powens. Stores connection, syncs accounts, redirects to `/kompta/accounts`.

### `GET /api/bank/connections`

List active bank connections.

### `POST /api/bank/sync`

Sync all active connections — updates balances and adds new accounts.

### `POST /api/bank/accounts/:id/sync`

Sync transactions for a specific account.

---

## Coinbase

### `GET /api/coinbase/connect-url`

Returns `{ url }` for Coinbase OAuth2 flow. Requires `COINBASE_CLIENT_ID` env var.

### `GET /api/coinbase-callback`

OAuth callback. Stores tokens, syncs wallets.

### `POST /api/coinbase/sync`

Sync all Coinbase wallets. Auto-refreshes expired tokens.

---

## Transactions

### `GET /api/transactions`

Query params: `account_id`, `search`, `usage`, `company_id`, `limit` (default 100), `offset` (default 0).

```json
{
  "transactions": [
    { "id": 1, "bank_account_id": 1, "date": "2026-02-01",
      "amount": -42.50, "label": "Supermarché", "category": "Alimentation",
      "account_name": "Compte Courant" }
  ],
  "total": 150, "limit": 100, "offset": 0
}
```

---

## Assets

### `GET /api/assets`

Query params: `type` (`real_estate`, `vehicle`, `valuable`, `other`).

Returns assets with computed fields: `monthly_costs`, `monthly_revenues`, `pnl`, `pnl_percent`, `loan_balance`.

### `GET /api/assets/:id`

Single asset with `costs` and `revenues` arrays.

### `POST /api/assets`

```json
{
  "type": "real_estate", "name": "Apartment Paris 11",
  "purchase_price": 350000, "current_value": 380000,
  "address": "10 rue Oberkampf", "surface": 55,
  "property_type": "Appartement", "property_usage": "rental",
  "monthly_rent": 1200,
  "costs": [
    { "label": "Charges copro", "amount": 150, "frequency": "monthly" },
    { "label": "Taxe foncière", "amount": 1200, "frequency": "yearly" }
  ],
  "revenues": [
    { "label": "Loyer", "amount": 1200, "frequency": "monthly" }
  ]
}
```

### `PATCH /api/assets/:id`

Same fields. If `costs` or `revenues` provided, replaces all existing entries.

### `DELETE /api/assets/:id`

Deletes asset + all costs + revenues.

---

## Dashboard

### `GET /api/dashboard`

Query params: `usage`, `company_id`.

```json
{
  "financial": {
    "brutBalance": 50000, "netBalance": 30000,
    "accountsByType": { "checking": [...], "savings": [...], "investment": [...], "loan": [...] }
  },
  "patrimoine": {
    "brutValue": 400000, "netValue": 250000, "count": 2,
    "assets": [{ "id": 1, "type": "real_estate", "name": "...", "currentValue": 380000, "loanBalance": -150000 }]
  },
  "totals": { "brut": 450000, "net": 280000 },
  "accountCount": 5, "companyCount": 1,
  "distribution": { "personal": 30000, "pro": 20000 }
}
```

### `POST /api/dashboard/snapshot`

Saves today's patrimoine snapshot for history tracking. Call daily via cron.

### `GET /api/dashboard/history`

Query params: `range` (`1m`, `3m`, `6m`, `1y`, `max`), `category` (`all`, `checking`, `savings`, etc.).

```json
{ "history": [{ "date": "2026-02-01", "value": 50000 }], "range": "6m", "category": "all" }
```

---

## Budget & Cashflow

### `GET /api/budget/cashflow`

Query params: `from`, `to` (dates).

```json
{
  "totalIncome": 5000, "totalExpense": 3000, "net": 2000,
  "byCategory": { "Alimentation": { "income": 0, "expense": 500, "count": 15 } },
  "byMonth": [{ "month": "2026-01", "income": 5000, "expense": 3000 }]
}
```

---

## Reports

### `GET /api/report/patrimoine`

Query params: `categories` (`all` or comma-separated: `bank,immobilier,crypto,stocks`).

```json
{
  "sections": [
    { "title": "Comptes bancaires", "items": [{ "name": "Compte Courant", "value": 5000 }], "total": 5000 }
  ],
  "grandTotal": 50000
}
```

---

## Credit & Rates

### `GET /api/rates/current`

```json
{
  "rates": [
    { "duration": 20, "best_rate": 3.05, "avg_rate": 3.35, "updated_at": "..." }
  ]
}
```

### `POST /api/borrowing-capacity`

```json
// Request
{ "net_monthly": 4000, "existing_payments": 500, "rate": 3.35, "duration_years": 20 }
// Response
{ "max_payment": 1320, "available_payment": 820, "max_loan": 138000, "rate": 3.35, "duration_years": 20 }
```

---

## Income & Tax

### `GET /api/income`

```json
{ "entries": [{ "id": 1, "year": 2025, "employer": "Acme Corp", "gross_annual": 60000, "country": "FR" }] }
```

### `POST /api/income`

```json
{ "year": 2025, "employer": "Acme Corp", "job_title": "Developer", "country": "FR", "gross_annual": 60000 }
```

### `PUT /api/income/:id` / `DELETE /api/income/:id`

### `POST /api/tax/estimate`

```json
// Request
{ "gross_annual": 60000, "country": "FR", "situation": "single", "children": 0 }
// Response
{
  "gross_annual": 60000, "tax": 7461, "netIncome": 52539,
  "effectiveRate": 12.44, "parts": 1,
  "brackets": [{ "rate": 0, "amount": 0 }, { "rate": 11, "amount": 1925 }, { "rate": 30, "amount": 5536 }]
}
```

For Switzerland, add `"canton": "ZH"`.

---

## Crypto Prices

### `GET /api/crypto/prices?ids=bitcoin,ethereum,solana`

Proxies CoinGecko. Returns EUR/USD prices + 24h change.

---

## Property Estimation

### `GET /api/estimation/geocode?q=10 rue oberkampf paris`

Returns address candidates with lat/lon/citycode.

### `GET /api/estimation/price?citycode=75111&lat=48.86&lon=2.38&surface=55&type=Appartement`

Estimates price from DVF (real sales data). Returns median price/m², estimated value, range, and comparable sales.

---

## Export / Import

### `GET /api/export`

Full JSON dump of all data (companies, accounts, transactions, assets with costs/revenues).

### `POST /api/import`

Import from a previous export. Body = the export JSON.
