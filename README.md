# Konto 🦎

> Personal accounting & patrimoine tracker for micro-entreprises and freelancers in France.

Konto aggregates all your financial accounts (banks, crypto, manual), tracks your patrimoine (real estate, vehicles, valuables), and provides budgeting, tax estimation, and credit simulation tools — all in one place.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Tailwind CSS + Recharts |
| Backend | Hono (Node.js) + TypeScript |
| Database | Turso (libSQL) — SQLite-compatible, local or cloud |
| Dev Server | Vite 5 (frontend) + tsx watch (backend) |
| Process Manager | PM2 |
| i18n | i18next (FR/EN) |
| Deployment | Vercel (configured for serverless deployment) |

## Quick Start

```bash
# Install dependencies (monorepo workspaces)
npm install

# Run both frontend + backend
npm run dev

# Or separately
npm run dev:frontend   # → http://localhost:5173/konto/
npm run dev:backend    # → http://localhost:5004/api/
```

## Environment Variables

### Backend (`backend/.env`)

| Variable | Description | Required |
|----------|-------------|----------|
| `TURSO_DATABASE_URL` | Turso DB URL (default: `file:./db/konto.db`) | No |
| `TURSO_AUTH_TOKEN` | Turso auth token | Only for cloud DB |
| `POWENS_CLIENT_ID` | Powens API client ID | For bank sync |
| `POWENS_CLIENT_SECRET` | Powens API client secret | For bank sync |
| `POWENS_DOMAIN` | Powens domain (default: sandbox) | No |
| `POWENS_REDIRECT_URI` | OAuth callback URL | For bank sync |
| `COINBASE_CLIENT_ID` | Coinbase OAuth2 client ID | For Coinbase sync |
| `COINBASE_CLIENT_SECRET` | Coinbase OAuth2 client secret | For Coinbase sync |
| `COINBASE_REDIRECT_URI` | Coinbase callback URL | For Coinbase sync |
| `PAPPERS_API_TOKEN` | Pappers API token (company enrichment) | Optional |
| `CLERK_SECRET_KEY` | Clerk auth secret key | Yes |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | For Drive invoice scan |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | For Drive invoice scan |
| `GOOGLE_REDIRECT_URI` | Google OAuth callback URL | For Drive invoice scan |
| `KOZY_API_URL` | Kozy API base URL | For property sync |

### Frontend (`frontend/.env`)

| Variable | Description | Required |
|----------|-------------|----------|
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key | Yes |

## Features Highlights

### Crypto Integrations
- **One-click MetaMask**: Connect your MetaMask wallet instantly — same address works across all EVM chains
- **Multi-chain support**: Ethereum, Base, Polygon, BNB Chain, Avalanche, Arbitrum, Optimism, XRP
- **Bitcoin wallets**: Single addresses (bc1q...) or HD wallets (xpub... with automatic address derivation)
- **Solana support**: Native SOL balance tracking
- **Automatic sync**: Real-time balance refresh from public RPCs (no API keys needed)

### Net/Brut Toggle
- Dashboard shows both gross (brut) and net patrimoine
- Toggle affects donut chart, evolution chart, and legend
- Helps visualize patrimoine with/without loan liabilities

### Outils Hub
- Centralized tools page (2×2 grid) for quick access to simulators and utilities
- Credit simulator, budget analyzer, and more

## Project Structure

```
konto/
├── frontend/          # React SPA
│   └── src/
│       ├── App.tsx           # Router + auth gate
│       ├── main.tsx          # Entry point (BrowserRouter /konto)
│       ├── pages/            # Route components
│       ├── components/       # Shared UI
│       ├── i18n/             # Translations
│       ├── FilterContext.tsx  # Global scope filter
│       └── useApi.ts         # API client hook
├── backend/           # Hono API server
│   └── src/
│       ├── index.ts   # All routes (single file)
│       └── db.ts      # Turso client + schema
├── docs/              # Documentation
├── tests/             # Vitest tests
└── backups/           # Daily DB backups
```

## Cron Jobs

| Schedule | Script | Purpose |
|----------|--------|---------|
| `0 3 * * *` | `backup.sh` | Daily database backup |

## Development

- Frontend: `http://localhost:5173/konto/`
- Backend API: `http://localhost:5004/api/`
- PM2 processes: `konto-frontend`, `konto-backend`
- **Never run `npm run build`** — all dev servers served through nginx

## License

Private — all rights reserved.
