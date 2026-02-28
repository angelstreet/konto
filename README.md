# Konto

Konto is a finance app to help you see your real money situation in one place.

It combines your personal and business finances so you can answer simple questions fast:
- How much money do I actually have right now?
- Where is my money going every month?
- Is my net worth going up or down?
- What is the performance of my crypto and investments?

Built for freelancers and small business owners in France, but adaptable to other contexts.

## What This App Is For

Use Konto if you want to:
- connect your bank accounts and wallets
- follow budget, cash flow, and net worth over time
- track investments (stocks, funds, crypto, real estate)
- view personal and professional finances separately or together
- export clear reports for your own follow-up

In short: Konto is a practical money cockpit, not just a technical dashboard.

![MIT License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Bank sync** via Powens (EU open banking)
- **Crypto portfolio** — MetaMask, Coinbase, Binance, manual wallets (BTC, ETH, SOL, XRP, multi-chain EVM)
- **Investment tracking** — stocks, funds, life insurance, PEA, PER with P&L
- **Budget** — personal & professional, monthly breakdown, category analysis
- **Patrimoine** — net worth dashboard, asset allocation, evolution charts
- **Tax estimation** — French income tax simulator
- **Credit simulator** — borrowing capacity calculator
- **Property ROI** — rental yield analysis
- **Banking score** — financial health rating
- **PDF reports** — exportable patrimoine reports
- **Multi-language** — French & English (i18next)
- **Dark mode** — multiple themes (gold, blue, green, purple)
- **Sandbox mode** — demo data, no bank connection required

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS + Recharts |
| Backend | Hono + TypeScript + Node.js |
| Database | SQLite (local) or Turso (cloud) |
| Auth | Clerk (optional — local dev works without it) |

## Quick Start

### Prerequisites

- Node.js 18+
- npm 9+

### Install & Run

```bash
# Clone
git clone https://github.com/angelstreet/konto.git
cd konto

# Install all dependencies (monorepo workspaces)
npm install

# Copy env template
cp .env.example backend/.env

# Generate encryption key
openssl rand -hex 32
# Paste into backend/.env as DB_ENCRYPTION_KEY=<value>

# Start development servers
npm run dev
```

Frontend: `http://localhost:3004/konto/`
Backend API: `http://localhost:5004/api/`

### Default Login (local dev)

Username: `user`
Password: `user`

No Clerk setup needed for local development.

### Sandbox Mode

Konto ships with demo data (bank accounts, investments, transactions, crypto) for the default user. Just log in and explore.

## Configuration

All configuration is via environment variables. See [`.env.example`](.env.example) for the full list.

### Minimal (works out of the box)

```env
DB_ENCRYPTION_KEY=<generate with openssl rand -hex 32>
```

### Optional integrations

| Integration | Env vars needed | Purpose |
|-------------|----------------|---------|
| Powens | `POWENS_CLIENT_ID`, `POWENS_CLIENT_SECRET`, `POWENS_DOMAIN` | Bank account sync |
| Clerk | `CLERK_SECRET_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` | Production auth |
| Coinbase | `COINBASE_CLIENT_ID`, `COINBASE_CLIENT_SECRET` | Coinbase portfolio |
| Google Drive | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Invoice import |
| Smoobu | `SMOOBU_API_KEY` | Property management sync |
| Pappers | `PAPPERS_API_TOKEN` | French company lookup |

## Project Structure

```
konto/
├── frontend/           # React SPA (Vite)
│   └── src/
│       ├── pages/      # Route components
│       ├── components/ # Shared UI
│       └── i18n/       # FR/EN translations
├── backend/            # Hono API server
│   └── src/
│       ├── index.ts    # Routes & business logic
│       ├── db.ts       # Database schema & migrations
│       └── jobs/       # Background jobs (sync, rotation)
├── docs/               # API & architecture docs
├── tests/              # E2E tests (Vitest + Puppeteer)
└── .env.example        # Environment template
```

## Deployment

### Vercel (recommended)

```bash
# Frontend
cd frontend && vercel

# Backend (serverless)
cd backend && vercel
```

### Self-hosted

```bash
npm run build
# Frontend: serve frontend/dist/ with any static server
# Backend: node backend/dist/index.js
```

## Security & Privacy

Konto takes your financial data seriously. Here's how it works:

### Your bank credentials are safe

Konto **never sees or stores your bank passwords**. Bank connections go through [Powens](https://www.powens.com/) (formerly Budget Insight), a regulated financial data aggregator:

- **ACPR-licensed** (French banking authority) and **PSD2-compliant** (EU regulation)
- Your credentials are entered directly on Powens' secure page — they never pass through Konto
- Konto only receives **read-only** OAuth tokens — it is technically impossible to make transactions, transfers, or modify your accounts
- Tokens are encrypted (AES-256-GCM) before storage

### What Konto can and cannot do

| | |
|---|---|
| ✅ **Can** | Read your account balances and transaction history |
| ✅ **Can** | Read your investment positions and valuations |
| ❌ **Cannot** | Make transfers, payments, or any transactions |
| ❌ **Cannot** | Access your bank login credentials |
| ❌ **Cannot** | Modify anything in your bank accounts |

### Data protection

- **Encryption at rest** — all sensitive data (tokens, connection info) encrypted with AES-256-GCM
- **Encryption in transit** — all connections use TLS/HTTPS
- **Open source** — the full codebase is public, anyone can audit it
- **Self-hostable** — you can run your own instance and keep data on your own machine
- **No tracking** — no analytics, no ads, no data selling

### Try without connecting your bank

Not ready to connect? Use **Sandbox mode** to explore Konto with realistic demo data — no bank account required.

For the full security policy and vulnerability reporting, see [SECURITY.md](SECURITY.md).

## Contributing

PRs welcome. Please:
1. No hardcoded secrets or personal data
2. Test locally before submitting
3. Follow existing code patterns

## License

[MIT](LICENSE) — Joschim N'DOYE
