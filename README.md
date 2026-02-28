# Konto

Personal & professional finance dashboard. Track bank accounts, investments, crypto, real estate, and budget — all in one place.

Built for freelancers and micro-entrepreneurs in France, but adaptable to any context.

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

## Security

See [SECURITY.md](SECURITY.md) for:
- Vulnerability reporting
- Encryption architecture
- API security (CSRF, rate limiting, auth)

## Contributing

PRs welcome. Please:
1. No hardcoded secrets or personal data
2. Test locally before submitting
3. Follow existing code patterns

## License

[MIT](LICENSE) — Jean-Noël Doye
