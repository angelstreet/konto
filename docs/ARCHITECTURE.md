# Kompta — Architecture

## Overview

Kompta is a monorepo with two workspaces: `frontend` (React SPA) and `backend` (Hono API). The frontend communicates with the backend via REST API. Data is stored in Turso (libSQL/SQLite).

## Frontend

### Pages & Routes

All routes are under the `/kompta` base path.

| Route | Component | Description |
|-------|-----------|-------------|
| `/` | `Dashboard` | Net worth overview, account breakdown, patrimoine chart |
| `/accounts` | `Accounts` | Bank accounts list, add manual/blockchain/Powens accounts |
| `/transactions` | `Transactions` | Transaction list with search/filter |
| `/companies` | `Company` | Manage companies (SIREN lookup, link accounts) |
| `/assets` | `Assets` | Real estate, vehicles, valuables — with costs/revenues |
| `/budget` | `Budget` | Cashflow analysis by category/month |
| `/income` | `Income` | Income history by year/employer |
| `/reports` | `Report` | Patrimoine report generator |
| `/simulators` | `CreditSimulator` | Credit simulation + borrowing capacity |
| `/settings` | `Settings` | App settings |
| `/analytics` | `Analytics` | Revenue & expense analytics with cached metrics |
| `/bilan` | `Bilan` | Annual balance sheet (bilan annuel) |
| `/invoices` | `Invoices` | Invoice management with Google Drive scanning & transaction matching |
| `/onboarding` | `Onboarding` | New user onboarding wizard |
| `/analysis` | ComingSoon | Placeholder |
| `/cashflow` | ComingSoon | Placeholder |
| `/ledger` | ComingSoon | Placeholder |
| `/vat` | ComingSoon | Placeholder |
| `/fec-export` | ComingSoon | Placeholder |
| `/import` | ComingSoon | Placeholder |
| `/reconciliation` | ComingSoon | Placeholder |

### Key Components

- **Layout** — Sidebar navigation + bottom nav (mobile) + logout
- **FilterContext** — Global scope filter (all / personal / professional / per company)
- **ScopeSelect** — Dropdown to switch scope
- **PatrimoineChart** — Recharts line chart for patrimoine history
- **DistributionDonut** — Personal vs professional split donut

### Auth (Current)

Simple localStorage flag (`kompta_auth`). Login page with hardcoded access. Will be replaced by Clerk.

## Backend

### API Endpoints

All endpoints are prefixed with `/api/`.

#### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |

#### Users
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users` | List all users |

#### Companies
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/companies` | List user's companies |
| POST | `/api/companies` | Create company |
| PATCH | `/api/companies/:id` | Update company |
| DELETE | `/api/companies/:id` | Delete company (unlinks accounts) |
| POST | `/api/companies/:id/unlink-all` | Unlink all accounts from company |
| GET | `/api/companies/search?q=` | Search companies via API Gouv |
| GET | `/api/companies/info/:siren` | Detailed company info (Gouv + Pappers + societe.com) |

#### Bank Accounts
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/bank/accounts` | List accounts (filter: `usage`, `company_id`) |
| PATCH | `/api/bank/accounts/:id` | Update account (name, type, usage, company) |
| DELETE | `/api/bank/accounts/:id` | Delete account + transactions |
| POST | `/api/accounts/manual` | Create manual account |
| POST | `/api/accounts/:id/update-balance` | Update manual account balance |
| POST | `/api/accounts/blockchain` | Add blockchain wallet (BTC/ETH/SOL) |
| POST | `/api/accounts/:id/sync-blockchain` | Refresh blockchain balance |

#### Bank Connections (Powens)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/bank/connect-url` | Get Powens webview URL |
| GET | `/api/bank-callback` | Powens OAuth callback |
| GET | `/api/bank/connections` | List active connections |
| POST | `/api/bank/sync` | Sync all connected accounts |
| POST | `/api/bank/accounts/:id/sync` | Sync transactions for one account |

#### Coinbase
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/coinbase/connect-url` | Get Coinbase OAuth URL |
| GET | `/api/coinbase-callback` | Coinbase OAuth callback |
| POST | `/api/coinbase/sync` | Sync all Coinbase wallets |

#### Transactions
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/transactions` | List transactions (filter: `account_id`, `search`, `usage`, `company_id`, `limit`, `offset`) |

#### Assets
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/assets` | List assets (filter: `type`) with costs/revenues |
| GET | `/api/assets/:id` | Get single asset |
| POST | `/api/assets` | Create asset (with costs/revenues) |
| PATCH | `/api/assets/:id` | Update asset |
| DELETE | `/api/assets/:id` | Delete asset + costs + revenues |

#### Dashboard & History
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dashboard` | Aggregated dashboard (balances, patrimoine, distribution) |
| POST | `/api/dashboard/snapshot` | Save daily patrimoine snapshot |
| GET | `/api/dashboard/history` | Patrimoine history (filter: `range`, `category`) |

#### Budget & Cashflow
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/budget/cashflow` | Cashflow breakdown by category/month |

#### Reports
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/report/patrimoine` | Patrimoine report data (sections: bank, immobilier, crypto, stocks) |

#### Credit & Rates
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/rates/current` | Current mortgage rates by duration |
| POST | `/api/borrowing-capacity` | Calculate max borrowing capacity |

#### Income & Tax
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/income` | List income entries |
| POST | `/api/income` | Add income entry |
| PUT | `/api/income/:id` | Update income entry |
| DELETE | `/api/income/:id` | Delete income entry |
| POST | `/api/tax/estimate` | Estimate income tax (FR progressive / CH cantonal) |

#### Analytics
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/analytics` | Get cached analytics (query: `period`) |
| POST | `/api/analytics/recompute` | Force recompute analytics |

#### Bilan
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/bilan/:year` | Annual balance sheet (actif/passif) |

#### Invoices
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/invoices` | List invoices |
| POST | `/api/invoices/scan` | Scan invoices from Google Drive |
| DELETE | `/api/invoices/:id` | Delete invoice |
| POST | `/api/invoices/:id/match` | Match invoice to transaction |
| POST | `/api/invoices/:id/unmatch` | Unmatch invoice from transaction |
| GET | `/api/invoices/stats` | Invoice matching statistics |

#### Google Drive
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/drive/status` | Check Drive connection status |
| POST | `/api/drive/connect` | Connect Google Drive (OAuth) |
| DELETE | `/api/drive/disconnect` | Disconnect Google Drive |

#### Kozy Integration
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/kozy/properties` | Fetch properties from Kozy |

#### Crypto Prices
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/crypto/prices?ids=` | Crypto prices from CoinGecko (EUR/USD + 24h change) |

#### Property Estimation
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/estimation/geocode?q=` | Geocode address (api-adresse.data.gouv.fr) |
| GET | `/api/estimation/price` | Estimate property price from DVF sales data |

#### Export / Import
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/export` | Export all data as JSON |
| POST | `/api/import` | Import data from JSON export |

## Database Schema

### `users`
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| email | TEXT UNIQUE | User email |
| name | TEXT | Display name |
| role | TEXT | `user` or `admin` |
| created_at | TEXT | ISO datetime |

### `companies`
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| user_id | INTEGER FK→users | Owner |
| siren | TEXT | French SIREN number |
| name | TEXT | Company name |
| address | TEXT | Address |
| naf_code | TEXT | NAF/APE activity code |
| capital | REAL | Share capital |
| legal_form | TEXT | Legal form (SARL, SAS, etc.) |

### `bank_accounts`
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| company_id | INTEGER FK→companies | Linked company (nullable) |
| provider | TEXT | `powens`, `manual`, `blockchain`, `coinbase` |
| provider_account_id | TEXT | External ID |
| name | TEXT | Account name |
| custom_name | TEXT | User override name |
| bank_name | TEXT | Bank/provider name |
| account_number | TEXT | Account number |
| iban | TEXT | IBAN |
| balance | REAL | Current balance |
| hidden | INTEGER | Hidden from dashboard |
| last_sync | TEXT | Last sync timestamp |
| type | TEXT | `checking`, `savings`, `investment`, `loan` |
| usage | TEXT | `personal` or `professional` |
| blockchain_address | TEXT | Wallet address |
| blockchain_network | TEXT | `bitcoin`, `ethereum`, `solana` |
| currency | TEXT | Currency code (default: EUR) |

### `transactions`
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| bank_account_id | INTEGER FK→bank_accounts | Parent account |
| date | TEXT | Transaction date |
| amount | REAL | Amount (negative = expense) |
| label | TEXT | Description |
| category | TEXT | Category |
| is_pro | INTEGER | Professional flag |
| invoice_id | INTEGER FK→invoices | Matched invoice |

### `bank_connections`
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| user_id | INTEGER FK→users | Owner |
| powens_connection_id | TEXT | Powens connection ID |
| powens_token | TEXT | Powens access token |
| status | TEXT | `active`, `pending` |

### `coinbase_connections`
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| user_id | INTEGER FK→users | Owner |
| access_token | TEXT | OAuth access token |
| refresh_token | TEXT | OAuth refresh token |
| expires_at | TEXT | Token expiry |
| status | TEXT | `active` |

### `invoices`
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| company_id | INTEGER FK→companies | Company |
| number | TEXT | Invoice number |
| date | TEXT | Invoice date |
| amount | REAL | Amount |
| vendor | TEXT | Vendor name |
| file_path | TEXT | File location |
| matched_transaction_id | INTEGER | Matched transaction |

### `assets`
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| user_id | INTEGER | Owner |
| type | TEXT | `real_estate`, `vehicle`, `valuable`, `other` |
| name | TEXT | Asset name |
| purchase_price | REAL | Purchase price |
| purchase_date | TEXT | Purchase date |
| current_value | REAL | Current value |
| linked_loan_account_id | INTEGER FK→bank_accounts | Linked loan |
| address, citycode, latitude, longitude | TEXT/REAL | Location (real estate) |
| surface | REAL | Surface m² |
| property_type | TEXT | `Appartement`, `Maison` |
| estimated_value | REAL | DVF estimation |
| estimated_price_m2 | REAL | Price per m² |
| property_usage | TEXT | `principal`, `rental`, `secondary` |
| monthly_rent | REAL | Rental income |
| kozy_property_id | TEXT | Linked Kozy property |

### `asset_costs` / `asset_revenues`
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| asset_id | INTEGER FK→assets | Parent asset |
| label | TEXT | Description |
| amount | REAL | Amount |
| frequency | TEXT | `monthly`, `yearly`, `one_time` |
| category | TEXT | Category (costs only) |

### `patrimoine_snapshots`
| Column | Type | Description |
|--------|------|-------------|
| date | TEXT | Snapshot date |
| user_id | INTEGER | Owner |
| category | TEXT | Category or `total` |
| total_value | REAL | Value |
| UNIQUE | (date, user_id, category) | One per day per category |

### `income_entries`
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| user_id | INTEGER FK→users | Owner |
| year | INTEGER | Year |
| employer | TEXT | Employer name |
| job_title | TEXT | Job title |
| country | TEXT | Country code (FR, CH) |
| gross_annual | REAL | Gross annual salary |

### `analytics_cache`
| Column | Type | Description |
|--------|------|-------------|
| user_id | INTEGER | Owner |
| metric_key | TEXT | Metric identifier (e.g. `full`) |
| period | TEXT | Period (e.g. `2026`) |
| value | TEXT | JSON-serialized analytics data |
| computed_at | TEXT | ISO datetime of last computation |

### `market_rates`
| Column | Type | Description |
|--------|------|-------------|
| duration | INTEGER UNIQUE | Loan duration in years |
| best_rate | REAL | Best market rate |
| avg_rate | REAL | Average market rate |

## Auth Flow (Clerk)

1. Frontend uses `@clerk/clerk-react` — wraps app in `ClerkProvider`
2. Unauthenticated users see Clerk sign-in page
3. Backend uses `@hono/clerk-auth` middleware — validates Clerk JWT on every request
4. User isolation: all queries filter by Clerk `userId` (no more hardcoded user)
5. Agent access via API token is preserved alongside Clerk auth

## External Integrations

| Service | Purpose | API |
|---------|---------|-----|
| **Powens** | French bank aggregation (PSD2) | OAuth2 + REST |
| **CoinGecko** | Crypto prices (EUR/USD) | Free REST API |
| **Blockstream** | Bitcoin balance | Free REST API |
| **Etherscan** | Ethereum balance | Free REST API |
| **Solana RPC** | Solana balance | Free JSON-RPC |
| **Coinbase** | Crypto exchange accounts | OAuth2 + REST |
| **API Gouv** | Company search (recherche-entreprises) | Free REST API |
| **Pappers** | Company enrichment (capital, TVA) | API key REST |
| **societe.com** | Company data scraping | HTML scraping |
| **DVF (data.gouv.fr)** | Property sales data for estimation | CSV download |
| **api-adresse.data.gouv.fr** | Address geocoding | Free REST API |
| **Google Drive** | Invoice PDF scanning & matching | OAuth2 + REST |
| **Kozy** | Property management sync | REST API |

See `docs/INTEGRATIONS.md` for detailed integration status.

## Cron Jobs

| Schedule | Job | Description |
|----------|-----|-------------|
| Daily 3 AM | `backup.sh` | Backup database to `backups/` |
| Planned | `POST /api/dashboard/snapshot` | Daily patrimoine snapshot for history charts |
| Planned | Rate scraping | Scrape mortgage rates from Empruntis/MeilleurTaux |
