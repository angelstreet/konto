# Konto — External Integrations Guide

## Currently Working

### 1. Powens (French/EU Banks)
**Status:** ✅ Live
- Covers: BNP, Crédit Mutuel/CIC, Société Générale, LCL, Caisse d'Épargne, La Banque Postale, etc.
- NOT covered: Revolut, Yuh, eToro, Coinbase, crypto wallets
- Sandbox: `konto-sandbox.biapi.pro` (client_id: 91825215)
- Env: `POWENS_CLIENT_ID`, `POWENS_CLIENT_SECRET`, `POWENS_DOMAIN`,
  `POWENS_REDIRECT_URI` (else `${APP_URL}/api/bank-callback`),
  `POWENS_CONNECTOR_CAPABILITIES` (empty = no filter).

#### Connecting, and the consent clock

| Endpoint | What it does |
|---|---|
| `GET /api/bank/connect-url` | Builds the `webview.powens.com/<lang>/connect` URL and stores a one-time `state` (10-min expiry) |
| `GET /api/bank/webview?url=` | 302 to the webview — Powens sends `X-Frame-Options: DENY`, so it cannot be iframed |
| `GET /api/bank/reconnect-url/:accountId` | Finds the connection owning that account, mints a short-lived Powens code and returns the `/reconnect` webview URL as JSON |
| `GET /api/bank/reconnect/:accountId` | Same, but **302s** to the webview. The minted URL dies in ~10 min, so a link pasted into a notification goes stale; this one mints a fresh URL per request, so a stable link can be sent to the phone |
| `GET /api/bank-callback` | Exchanges the code, stores tokens encrypted, registers accounts |
| `POST /api/bank/sync`, `/api/bank/sync-all`, `/api/bank/accounts/:id/sync` | Pull balances and transactions |

- PSD2 requires the account holder to authenticate with their own bank to create
  **and to renew** consent (every ~90–180 days). No token, API or agent can do it
  for them. Everything between renewals is server-side and needs no user action.
- Opening the webview **on the phone** lets a PSD2 redirect connector hand off
  app-to-app, so the approval happens in the bank's own app rather than by typing
  bank credentials into the webview.
- When consent lapses, Powens reports `SCARequired`. The app marks
  `bank_accounts.sca_required = 1` and keeps serving cached data; the UI shows a
  re-auth badge, and `/api/bank/accounts` returns `connection_expired` when the
  user has no active connection left.
- **Ahead of that**, a connection carries `expire` — the highest expiry among
  its sources, i.e. the PSD2 consent clock. Every sync stores it as
  `bank_connections.consent_expires_at`, with the connection's `state` as
  `provider_state`, so the app can warn before a bank stops syncing rather than
  only noticing afterwards. `GET /api/bank/connections` returns both, plus the
  owning connection's `bank_name`, `account_count`, `last_sync` and a
  `reconnect_account_id` to hang a reconnect link on.
- Each account records its owning connection as `provider_connection_id`, from
  the account's own `id_connection`. This matters for notifications: several
  connections can sit behind one institution name (CIC, say), so one link per
  *bank* would silently skip most of them — it has to be one link per
  *connection*.
- Access tokens last about an hour; `refreshPowensToken()` renews them from the
  stored refresh token, and the `refresh-stale-connections` cron (see
  `backend/src/jobs/`) re-syncs anything older than 7 days.
- There is **no Powens webhook endpoint** in the backend. Adding one would make
  SCA detection immediate rather than waiting for a cron.
#### Which connection a callback belongs to

A Powens access token is scoped to the Powens *user*, so
`GET /users/me/connections` returns **every** connection, not the one just
added. `/api/bank-callback` used to take `connections[0]` and overwrite the
`connection_id` the callback itself had supplied, which attached the new token
to an arbitrary connection and left `provider_name` null. The callback's
`connection_id` is authoritative; the list is only a fallback, and then the
newest connection wins.

Several `active` rows in `bank_connections` are normal — one per bank. Accounts
are deduplicated by `(company_id, provider, provider_account_id)` or IBAN, so
they do not multiply.

#### Bank names

The institution is **not on the account object**. A Powens account carries only
`id_connection`; the institution lives on the connection, as
`connection.connector.name` (fetch with `?expand=connector`).
`extractPowensBankMeta()` used to probe `acc.bank` / `acc.institution` /
`acc.connector`, none of which exist, so it always returned null and the UI fell
back to a raw BIC like `CMCIFRPPXXX`. `fetchPowensConnectorMap(token)` builds
`id_connection → { bankId, bankName }` and is passed to the extractor in every
sync path; `connector.uuid` is stable across API domains and `connector.id` is
not, so uuid is stored as `provider_bank_id`.

### 2. Manual Accounts
**Status:** ✅ Live
- For: Revolut, Yuh, eToro, any unsupported provider
- User creates account with name + balance
- Click balance to update manually anytime

### 3. Blockchain Wallets
**Status:** ✅ Live

Supports 10 networks. **One-click MetaMask connect** — same address (e.g. MetaMask 0x...) works across all EVM chains.

| Network | Currency | API | Key needed |
|---------|----------|-----|------------|
| Bitcoin | BTC | Blockstream.info | No |
| Bitcoin (xpub) | BTC | blockchain.info + bitcoinjs-lib derivation | No |
| Ethereum | ETH | llamarpc.com (public RPC) | No |
| Base | ETH | mainnet.base.org | No |
| Polygon | POL | polygon-rpc.com | No |
| BNB Chain | BNB | bsc-dataseed.binance.org | No |
| Avalanche | AVAX | api.avax.network | No |
| Arbitrum | ETH | arb1.arbitrum.io | No |
| Optimism | ETH | mainnet.optimism.io | No |
| XRP | XRP | xrpl.org public API | No |
| Solana | SOL | api.mainnet-beta.solana.com | No |

**Input formats:**
- BTC: `bc1q...` (single address) or `xpub...` (HD wallet — derives all addresses, scans for balance)
- EVM chains: `0x...` (same address across all EVM chains, select network in dropdown)
- SOL: Solana public key

**How it works:**
- EVM chains all use the same `eth_getBalance` JSON-RPC call, just different endpoints
- Bitcoin xpub: derives native segwit (bc1) addresses using BIP84 path, queries each via Blockstream
- Balance fetched automatically on add, sync button refreshes

### 4. Crypto Prices
**Status:** ✅ Live
- CoinGecko free API (EUR + USD + 24h change)
- No API key required
- `CG_MAP` in `backend/src/shared.ts` maps currency code → CoinGecko id, and only
  those tokens get a live price; the rest fall back to `balance_native`.
- POL must be `polygon-ecosystem-token`. `matic-network` is the pre-migration
  MATIC and trades well above POL. Check the id when adding a token —
  `/api/v3/coins/list` shows several entries per symbol.
- Cached 5 min in memory and in `kv_cache`, so Vercel cold starts have a value.

## Ready to Activate (needs credentials)

### 5. Coinbase OAuth2
**Status:** 🔧 Backend ready, needs app registration

**Steps for Jo:**
1. Go to https://www.coinbase.com/settings/api
2. Click "New OAuth2 Application"
3. Fill in:
   - App name: `Konto`
   - Redirect URI: `https://your-domain.com/api/coinbase-callback`
   - Scopes: `wallet:accounts:read`, `wallet:transactions:read`, `wallet:user:read`
4. Copy Client ID and Client Secret
5. Add to `~/.openclaw/.env`:
   ```
   COINBASE_CLIENT_ID=your_client_id
   COINBASE_CLIENT_SECRET=your_client_secret
   ```
6. Restart: `pm2 restart konto-backend`

**What it does:**
- OAuth2 flow (same UX as Powens — redirects to Coinbase, comes back)
- Syncs all wallets with non-zero balances
- Auto-refresh tokens
- Currency per wallet (BTC, ETH, etc.)

**Balances:** `POST /api/coinbase/sync` writes the token quantity to `balance`
and Coinbase's own EUR valuation to `balance_native`. It is the authoritative
repair path if crypto balances are ever corrupted — it overwrites both columns
for every wallet. See [MONEY.md](MONEY.md) for how those columns are read, and
for the `fiatByAsset` symbol-keying caveat when the same asset appears in two
wallets (e.g. "POL" and "Staked POL").

## Research Results

### 6. Revolut
**Status:** ❌ No practical API for personal accounts

- **Open Banking (PSD2)**: Requires TPP (Third Party Provider) registration with FCA. That means: company registration, compliance audit, regulatory approval. Not realistic for a personal tool.
- **Revolut Business API**: Only for Revolut Business accounts, not personal.
- **No personal API**: Revolut doesn't expose any API for personal users to read their own balance.
- **Workaround**: Manual account. User enters balance, updates when desired.

### 7. eToro
**Status:** ❌ No API at all

- No public API, no partner API, no personal API.
- Portfolio data is locked behind their web/mobile app.
- No Open Banking (eToro is not a bank in the traditional sense).
- **Workaround**: Manual account. User enters total portfolio value.

### 8. Yuh
**Status:** ❌ No API (Swiss, outside PSD2)

- Yuh is a Swissquote subsidiary (Swiss banking, FINMA-regulated).
- Switzerland is NOT in the EU, so PSD2 Open Banking does not apply.
- No known API or developer program.
- **Workaround**: Manual account.

## Summary

| Provider | Method | Status | Auto-sync |
|----------|--------|--------|-----------|
| French banks | Powens | ✅ Live | Yes |
| Manual (Revolut, Yuh, eToro) | Manual entry | ✅ Live | No (manual) |
| BTC wallet | Blockstream / bitcoinjs-lib | ✅ Live | Yes |
| ETH/Base/Polygon/BNB/AVAX/Arb/OP | Public RPCs | ✅ Live | Yes |
| SOL wallet | Solana RPC | ✅ Live | Yes |
| Coinbase | OAuth2 | 🔧 Ready | Yes (after setup) |
| Revolut | - | ❌ No API | Manual only |
| eToro | - | ❌ No API | Manual only |
| Yuh | - | ❌ No API | Manual only |

---

## 9. Google Drive — Invoice Scan & Rapprochement

**Status:** ✅ Live

### Overview

Scans PDF invoices from Google Drive, extracts amounts/dates/vendors via OCR, and auto-matches them to bank transactions (rapprochement).

### Connection Model

- **One global Drive connection per user** (not per company)
- Per-company **folder selection** — each company picks which Drive folder to scan
- OAuth2 with `drive.readonly` scope, token auto-refresh

### Scan Pipeline (3-tier text extraction)

```
PDF file from Drive
  │
  ├─ 1. pdf-parse (text layer extraction)
  │    └─ Trust only if >200 chars AND both amount+date found
  │
  ├─ 2. Tesseract OCR (local, ~1-2s per page)
  │    └─ pdftoppm (300dpi PNG) → tesseract (eng+fra)
  │    └─ Use if pdf-parse insufficient
  │
  └─ 3. Google Drive OCR (network, last resort)
       └─ Upload as image, convert to Google Doc, read text
       └─ Use only if Tesseract also fails
```

**Why 3 tiers?**
- Many invoices (Cursor, Anthropic, etc.) are styled HTML-to-PDF where pdf-parse gets almost no text
- Tesseract handles these perfectly and is free/local (~1-2s per page)
- Drive OCR is the final fallback but uses network and API quota

### Text Parsing (`parseInvoiceText`)

Extracts from OCR'd text using regex patterns:

| Field | Patterns (priority order) |
|-------|--------------------------|
| Amount | "Montant dû" / "Amount due" → "Total" → Currency-prefixed ($30.00, €21.60) → Generic number patterns |
| Date | French ("21 novembre 2025") → English ("November 21, 2025") → ISO (2025-11-21) → DD/MM/YYYY, MM/DD/YYYY |
| Vendor | "Invoice from X" → "Bill to" context → Filename-based fallback |

### Matching Logic (scoring system)

Candidates: checking account transactions within ±14 days of invoice date.

| Signal | Max Points | Scoring |
|--------|-----------|---------|
| Amount | 50 | Exact=50, <1%=40, <5%=25, <10%=15, <20%=8 (best of EUR vs USD match) |
| Date | 35 | Same day=35, ±1d=25, ±3d=20, ±7d=15, ±14d=8 |
| Vendor | 30 | Full name match=30, partial word=20 |

**Threshold: >60** (requires at least 2 strong signals out of 3)

### Filters

- **Account type:** Only `checking` accounts (excludes investment, savings, loan)
- **Label blocklist:** Transactions starting with blocked prefixes (e.g. "COUPONS") are excluded

### System Dependencies

```bash
apt install tesseract-ocr tesseract-ocr-fra poppler-utils
# tesseract: OCR engine
# tesseract-ocr-fra: French language data
# poppler-utils: pdftoppm for PDF→PNG conversion
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/drive/status` | GET | Check Drive connection status |
| `/api/drive/connect` | GET | Initiate OAuth2 flow |
| `/api/invoices/scan` | POST | Scan Drive folder, extract text, match transactions |
| `/api/invoices/list` | GET | List cached invoices with match status |
| `/api/invoices/debug` | GET | Debug view: extraction data + nearest transactions |
| `/api/reconciliation/stats` | GET | Match/total counts for a company+year |
| `/api/reconciliation/transactions` | GET | Transactions with match status |
