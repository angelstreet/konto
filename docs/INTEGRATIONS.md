# Konto — External Integrations Guide

## Currently Working

### 1. Powens (French/EU Banks)
**Status:** ✅ Live
- Covers: BNP, Crédit Mutuel/CIC, Société Générale, LCL, Caisse d'Épargne, La Banque Postale, etc.
- NOT covered: Revolut, Yuh, eToro, Coinbase, crypto wallets
- Sandbox: `konto-sandbox.biapi.pro` (client_id: 91825215)

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

## Ready to Activate (needs credentials)

### 5. Coinbase OAuth2
**Status:** 🔧 Backend ready, needs app registration

**Steps for Jo:**
1. Go to https://www.coinbase.com/settings/api
2. Click "New OAuth2 Application"
3. Fill in:
   - App name: `Konto`
   - Redirect URI: `https://65.108.14.251:8080/konto/api/coinbase-callback`
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
