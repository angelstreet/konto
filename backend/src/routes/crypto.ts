// Lazy-load Bitcoin modules (contain WASM that breaks Vercel serverless)
let bip32: any = null;
let bitcoin: any = null;
async function loadBitcoinModules() {
  if (bip32) return;
  const ecc = await import('tiny-secp256k1');
  const { BIP32Factory } = await import('bip32');
  bitcoin = await import('bitcoinjs-lib');
  bip32 = BIP32Factory(ecc);
}

import { Hono } from 'hono';
import db from '../db.js';
import { encrypt, decrypt } from '../crypto.js';
import { getUserId, decryptBankConn, decryptCoinbaseConn, decryptBinanceConn, decryptDriveConn,
         POWENS_CLIENT_ID, POWENS_CLIENT_SECRET, POWENS_DOMAIN, POWENS_API, REDIRECT_URI,
         classifyAccountType, classifyAccountSubtype, classifyAccountUsage, extractPowensBankMeta,
         refreshPowensToken, getDriveAccessToken, sha256, generateApiKey, getClientIP,
         calcInvestmentDiff, calcInvDiff, formatCurrencyFR, escapeHtml } from '../shared.js';


const router = new Hono();


// ========== BLOCKCHAIN WALLETS ==========

export async function fetchBlockchainBalance(network: string, address: string): Promise<{ balance: number; currency: string }> {
  if (network === 'xrp' || network === 'ripple') {
    const res = await fetch(`https://api.xrpscan.com/api/v1/account/${address}`);
    const data = await res.json() as any;
    return { balance: (data.xrpBalance || 0), currency: 'XRP' };
  }
  if (network === 'solana') {
    const res = await fetch('https://api.mainnet-beta.solana.com', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] }),
    });
    const data = await res.json() as any;
    return { balance: (data.result?.value || 0) / 1e9, currency: 'SOL' };
  }
  if (network === 'bitcoin') {
    await loadBitcoinModules();
    // xpub → derive native segwit (bc1) addresses and scan via Blockstream
    if (/^[xyz]pub/.test(address)) {
      const node = bip32.fromBase58(address);
      let totalBalance = 0;
      // Scan receiving (m/0/i) and change (m/1/i) addresses
      for (const chain of [0, 1]) {
        let emptyCount = 0;
        for (let i = 0; emptyCount < 5 && i < 50; i++) {
          const child = node.derive(chain).derive(i);
          const { address: addr } = bitcoin.payments.p2wpkh({ pubkey: child.publicKey, network: bitcoin.networks.bitcoin });
          if (!addr) continue;
          try {
            const res = await fetch(`https://blockstream.info/api/address/${addr}`);
            const data = await res.json() as any;
            const funded = data.chain_stats?.funded_txo_sum || 0;
            const spent = data.chain_stats?.spent_txo_sum || 0;
            const bal = funded - spent;
            const txCount = data.chain_stats?.tx_count || 0;
            if (txCount === 0) { emptyCount++; } else { emptyCount = 0; }
            totalBalance += bal;
          } catch { emptyCount++; }
        }
      }
      return { balance: totalBalance / 1e8, currency: 'BTC' };
    }
    // Single address → use Blockstream
    const res = await fetch(`https://blockstream.info/api/address/${address}`);
    const data = await res.json() as any;
    const funded = data.chain_stats?.funded_txo_sum || 0;
    const spent = data.chain_stats?.spent_txo_sum || 0;
    return { balance: (funded - spent) / 1e8, currency: 'BTC' };
  }
  // EVM chains — all use the same eth_getBalance RPC, different endpoints
  const evmChains: Record<string, { rpc: string; currency: string; decimals: number }> = {
    ethereum:  { rpc: 'https://eth.llamarpc.com', currency: 'ETH', decimals: 18 },
    base:      { rpc: 'https://mainnet.base.org', currency: 'ETH', decimals: 18 },
    polygon:   { rpc: 'https://polygon-rpc.com', currency: 'POL', decimals: 18 },
    bnb:       { rpc: 'https://bsc-dataseed.binance.org', currency: 'BNB', decimals: 18 },
    avalanche: { rpc: 'https://api.avax.network/ext/bc/C/rpc', currency: 'AVAX', decimals: 18 },
    arbitrum:  { rpc: 'https://arb1.arbitrum.io/rpc', currency: 'ETH', decimals: 18 },
    optimism:  { rpc: 'https://mainnet.optimism.io', currency: 'ETH', decimals: 18 },
  };

  const chain = evmChains[network];
  if (chain) {
    const res = await fetch(chain.rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [address, 'latest'], id: 1 }),
    });
    const data = await res.json() as any;
    const balance = data.result ? parseInt(data.result, 16) / Math.pow(10, chain.decimals) : 0;
    return { balance, currency: chain.currency };
  }
  throw new Error(`Unsupported network: ${network}`);
}

interface BlockchainTx {
  tx_hash: string;
  date: string;
  amount: number;
  label: string;
}

export async function fetchBlockchainTransactions(network: string, address: string): Promise<BlockchainTx[]> {
  const txs: BlockchainTx[] = [];

  if (network === 'bitcoin') {
    await loadBitcoinModules();
    // For xpub: derive addresses and aggregate txs, dedup by txid
    const addresses: string[] = [];
    const addressSet = new Set<string>();
    if (/^[xyz]pub/.test(address)) {
      const node = bip32.fromBase58(address);
      for (const chain of [0, 1]) {
        let emptyCount = 0;
        for (let i = 0; emptyCount < 5 && i < 50; i++) {
          const child = node.derive(chain).derive(i);
          const { address: addr } = bitcoin.payments.p2wpkh({ pubkey: child.publicKey, network: bitcoin.networks.bitcoin });
          if (!addr) continue;
          try {
            const res = await fetch(`https://blockstream.info/api/address/${addr}`);
            const data = await res.json() as any;
            if ((data.chain_stats?.tx_count || 0) === 0) { emptyCount++; } else { emptyCount = 0; addresses.push(addr); addressSet.add(addr); }
          } catch { emptyCount++; }
        }
      }
    } else {
      addresses.push(address);
      addressSet.add(address);
    }

    const seenTxids = new Set<string>();
    for (const addr of addresses) {
      try {
        const res = await fetch(`https://blockstream.info/api/address/${addr}/txs`);
        const rawTxs = await res.json() as any[];
        for (const tx of rawTxs) {
          if (seenTxids.has(tx.txid)) continue;
          seenTxids.add(tx.txid);
          // Sum inputs from our addresses (sent) and outputs to our addresses (received)
          let sent = 0, received = 0;
          let fromAddr = '', toAddr = '';
          for (const vin of (tx.vin || [])) {
            if (vin.prevout && addressSet.has(vin.prevout.scriptpubkey_address)) {
              sent += vin.prevout.value;
            } else if (vin.prevout) {
              fromAddr = vin.prevout.scriptpubkey_address || '';
            }
          }
          for (const vout of (tx.vout || [])) {
            if (addressSet.has(vout.scriptpubkey_address)) {
              received += vout.value;
            } else {
              toAddr = vout.scriptpubkey_address || '';
            }
          }
          const net = (received - sent) / 1e8;
          const short = (s: string) => s ? `${s.slice(0, 6)}...${s.slice(-4)}` : '?';
          const label = net >= 0
            ? `Received ${Math.abs(net).toFixed(8)} BTC from ${short(fromAddr)}`
            : `Sent ${Math.abs(net).toFixed(8)} BTC to ${short(toAddr)}`;
          const timestamp = tx.status?.block_time ? new Date(tx.status.block_time * 1000).toISOString() : new Date().toISOString();
          txs.push({ tx_hash: tx.txid, date: timestamp, amount: net, label });
        }
      } catch (e) { console.error(`BTC tx fetch failed for ${addr}:`, e); }
    }
    return txs;
  }

  if (network === 'xrp' || network === 'ripple') {
    try {
      const res = await fetch('https://s1.ripple.com:51234/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'account_tx', params: [{ account: address, limit: 50 }] }),
      });
      const data = await res.json() as any;
      const transactions = data.result?.transactions || [];
      for (const entry of transactions) {
        const tx = entry.tx_json || entry.tx || {};
        if (tx.TransactionType !== 'Payment') continue;
        const amount = typeof tx.Amount === 'string' ? parseInt(tx.Amount) / 1e6 : 0;
        if (amount === 0) continue;
        const isSent = tx.Account === address;
        const net = isSent ? -amount : amount;
        const peer = isSent ? tx.Destination : tx.Account;
        const short = (s: string) => s ? `${s.slice(0, 6)}...${s.slice(-4)}` : '?';
        const label = isSent
          ? `Sent ${amount.toFixed(6)} XRP to ${short(peer)}`
          : `Received ${amount.toFixed(6)} XRP from ${short(peer)}`;
        // XRP epoch starts 2000-01-01, offset = 946684800
        const timestamp = tx.date ? new Date((tx.date + 946684800) * 1000).toISOString() : new Date().toISOString();
        txs.push({ tx_hash: tx.hash, date: timestamp, amount: net, label });
      }
    } catch (e) { console.error('XRP tx fetch failed:', e); }
    return txs;
  }

  if (network === 'solana') {
    try {
      // Get recent signatures
      const sigRes = await fetch('https://api.mainnet-beta.solana.com', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress', params: [address, { limit: 30 }] }),
      });
      const sigData = await sigRes.json() as any;
      const signatures = sigData.result || [];
      for (const sig of signatures) {
        try {
          const txRes = await fetch('https://api.mainnet-beta.solana.com', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [sig.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }] }),
          });
          const txData = await txRes.json() as any;
          const meta = txData.result?.meta;
          const msg = txData.result?.transaction?.message;
          if (!meta || !msg) continue;
          // Find our account index to compute SOL balance diff
          const accounts = msg.accountKeys?.map((k: any) => typeof k === 'string' ? k : k.pubkey) || [];
          const idx = accounts.indexOf(address);
          if (idx === -1) continue;
          const pre = (meta.preBalances?.[idx] || 0);
          const post = (meta.postBalances?.[idx] || 0);
          const diff = (post - pre) / 1e9;
          if (Math.abs(diff) < 0.000001) continue; // skip dust / fee-only
          const short = (s: string) => s ? `${s.slice(0, 6)}...${s.slice(-4)}` : '?';
          const otherAddr = accounts.find((a: string) => a !== address) || '?';
          const label = diff >= 0
            ? `Received ${Math.abs(diff).toFixed(6)} SOL from ${short(otherAddr)}`
            : `Sent ${Math.abs(diff).toFixed(6)} SOL to ${short(otherAddr)}`;
          const timestamp = sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : new Date().toISOString();
          txs.push({ tx_hash: sig.signature, date: timestamp, amount: diff, label });
        } catch { /* skip individual tx errors */ }
      }
    } catch (e) { console.error('Solana tx fetch failed:', e); }
    return txs;
  }

  // EVM chains — use Blockscout API (free, no API key)
  const evmBlockscout: Record<string, { url: string; currency: string; decimals: number }> = {
    ethereum:  { url: 'https://eth.blockscout.com/api', currency: 'ETH', decimals: 18 },
    base:      { url: 'https://base.blockscout.com/api', currency: 'ETH', decimals: 18 },
    polygon:   { url: 'https://polygon.blockscout.com/api', currency: 'POL', decimals: 18 },
    bnb:       { url: 'https://bsc.blockscout.com/api', currency: 'BNB', decimals: 18 },
    avalanche: { url: 'https://avalanche.blockscout.com/api', currency: 'AVAX', decimals: 18 },
    arbitrum:  { url: 'https://arbitrum.blockscout.com/api', currency: 'ETH', decimals: 18 },
    optimism:  { url: 'https://optimism.blockscout.com/api', currency: 'ETH', decimals: 18 },
  };

  const chain = evmBlockscout[network];
  if (chain) {
    try {
      const res = await fetch(`${chain.url}?module=account&action=txlist&address=${address}&sort=desc&page=1&offset=50`);
      const data = await res.json() as any;
      for (const tx of (data.result || [])) {
        const value = parseFloat(tx.value || '0') / Math.pow(10, chain.decimals);
        if (value === 0) continue; // skip contract interactions with 0 value
        const isSent = tx.from?.toLowerCase() === address.toLowerCase();
        const net = isSent ? -value : value;
        const peer = isSent ? tx.to : tx.from;
        const short = (s: string) => s ? `${s.slice(0, 6)}...${s.slice(-4)}` : '?';
        const label = isSent
          ? `Sent ${value.toFixed(6)} ${chain.currency} to ${short(peer)}`
          : `Received ${value.toFixed(6)} ${chain.currency} from ${short(peer)}`;
        const timestamp = tx.timeStamp ? new Date(parseInt(tx.timeStamp) * 1000).toISOString() : new Date().toISOString();
        txs.push({ tx_hash: tx.hash, date: timestamp, amount: net, label });
      }
    } catch (e) { console.error(`EVM tx fetch failed for ${network}:`, e); }
    return txs;
  }

  return txs;
}

router.post('/api/accounts/blockchain', async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json() as any;
  if (!body.address || !body.network) return c.json({ error: 'Address and network required' }, 400);

  const network = body.network.toLowerCase();
  let balance = 0;
  const currencyMap: Record<string, string> = { bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', xrp: 'XRP', ripple: 'XRP', base: 'ETH', polygon: 'POL', bnb: 'BNB', avalanche: 'AVAX', arbitrum: 'ETH', optimism: 'ETH' };
  let currency = currencyMap[network] || network.toUpperCase();

  try {
    const result = await fetchBlockchainBalance(network, body.address);
    balance = result.balance; currency = result.currency;
  } catch (err: any) {
    console.error(`Blockchain balance fetch failed for ${network}:${body.address}:`, err.message);
  }

  const result = await db.execute({
    sql: `INSERT INTO bank_accounts (user_id, company_id, provider, name, custom_name, balance, type, usage, subtype, blockchain_address, blockchain_network, currency, last_sync) VALUES (?, ?, 'blockchain', ?, ?, ?, 'investment', 'personal', 'crypto', ?, ?, ?, ?)`,
    args: [userId, body.company_id || null, body.name || `${currency} Wallet`, body.custom_name || null, balance, body.address, network, currency, new Date().toISOString()]
  });
  const account = await db.execute({ sql: 'SELECT * FROM bank_accounts WHERE id = ?', args: [Number(result.lastInsertRowid)] });
  return c.json(account.rows[0]);
});

router.post('/api/accounts/:id/sync-blockchain', async (c) => {
  const id = c.req.param('id');
  const result = await db.execute({ sql: "SELECT * FROM bank_accounts WHERE id = ? AND provider = 'blockchain'", args: [id] });
  const account = result.rows[0] as any;
  if (!account) return c.json({ error: 'Not a blockchain account' }, 404);

  try {
    const { balance, currency } = await fetchBlockchainBalance(account.blockchain_network, account.blockchain_address);
    await db.execute({ sql: 'UPDATE bank_accounts SET balance = ?, currency = ?, last_sync = ? WHERE id = ?', args: [balance, currency, new Date().toISOString(), id] });

    // Fetch and insert on-chain transactions
    let txCount = 0;
    try {
      const txs = await fetchBlockchainTransactions(account.blockchain_network, account.blockchain_address);
      for (const tx of txs) {
        const res = await db.execute({
          sql: `INSERT OR IGNORE INTO transactions (bank_account_id, date, amount, label, category, is_pro, tx_hash) VALUES (?, ?, ?, ?, 'Crypto', 0, ?)`,
          args: [id, tx.date, tx.amount, tx.label, tx.tx_hash],
        });
        if (res.rowsAffected > 0) txCount++;
      }
    } catch (txErr: any) {
      console.error(`Blockchain tx fetch failed for account ${id}:`, txErr.message);
    }

    return c.json({ balance, currency, synced: txCount });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ========== CRYPTO PRICES ==========
router.get('/api/crypto/prices', async (c) => {
  const ids = c.req.query('ids') || 'bitcoin,ethereum,solana,ripple,matic-network,binancecoin,avalanche-2';
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=eur,usd&include_24hr_change=true`);
    const data = await res.json();
    return c.json(data);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});


// ========== COINBASE OAUTH2 ==========

const COINBASE_CLIENT_ID = process.env.COINBASE_CLIENT_ID || '';
const COINBASE_CLIENT_SECRET = process.env.COINBASE_CLIENT_SECRET || '';
const COINBASE_REDIRECT_URI = process.env.COINBASE_REDIRECT_URI || process.env.APP_URL ? `${process.env.APP_URL}/api/coinbase-callback` : 'http://localhost:3003/api/coinbase-callback';
const COINBASE_API = 'https://api.coinbase.com/v2';

router.get('/api/coinbase/connect-url', (c) => {
  if (!COINBASE_CLIENT_ID) return c.json({ error: 'Coinbase not configured' }, 400);
  const scopes = 'wallet:accounts:read,wallet:transactions:read,wallet:user:read';
  const url = `https://www.coinbase.com/oauth/authorize?response_type=code&client_id=${COINBASE_CLIENT_ID}&redirect_uri=${encodeURIComponent(COINBASE_REDIRECT_URI)}&scope=${scopes}&account=all`;
  return c.json({ url });
});

router.get('/api/coinbase-callback', async (c) => {
  const code = c.req.query('code');
  const error = c.req.query('error');

  if (error || !code) {
    return c.html(`<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">Coinbase connection failed</h1><p>${error || 'No authorization code received'}</p>
      <a href="/konto/accounts" style="color:#d4a812;">← Back to Konto</a></body></html>`);
  }

  try {
    const tokenRes = await fetch('https://api.coinbase.com/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code, client_id: COINBASE_CLIENT_ID, client_secret: COINBASE_CLIENT_SECRET, redirect_uri: COINBASE_REDIRECT_URI }),
    });
    const tokenData = await tokenRes.json() as any;
    if (!tokenRes.ok) throw new Error(tokenData.error_description || tokenData.error || 'Token exchange failed');

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const userId = await getUserId(c);

    await db.execute({
      sql: `INSERT INTO coinbase_connections (user_id, access_token, refresh_token, expires_at, status) VALUES (?, ?, ?, ?, 'active')`,
      args: [userId, encrypt(accessToken), encrypt(refreshToken), tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString() : null]
    });

    let accounts: any[] = [];
    try {
      const accRes = await fetch(`${COINBASE_API}/accounts?limit=100`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
      const accData = await accRes.json() as any;
      accounts = (accData.data || []).filter((a: any) => parseFloat(a.balance?.amount || '0') !== 0 || a.type === 'wallet');

      for (const acc of accounts) {
        const balance = parseFloat(acc.balance?.amount || '0');
        const currency = acc.balance?.currency || acc.currency?.code || 'USD';
        const existing = await db.execute({ sql: "SELECT id FROM bank_accounts WHERE provider = 'coinbase' AND provider_account_id = ?", args: [acc.id] });
        if (existing.rows.length === 0) {
          await db.execute({
            sql: `INSERT INTO bank_accounts (user_id, company_id, provider, provider_account_id, name, bank_name, balance, type, usage, subtype, currency, last_sync) VALUES (?, ?, 'coinbase', ?, ?, 'Coinbase', ?, 'investment', 'personal', 'crypto', ?, ?)`,
            args: [userId, null, acc.id, acc.name || `${currency} Wallet`, balance, currency, new Date().toISOString()]
          });
        }
      }
    } catch (e) {
      console.error('Failed to fetch Coinbase accounts:', e);
    }

    return c.html(`<html><head><meta http-equiv="refresh" content="10;url=/konto/accounts"></head><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#d4a812;">✅ Coinbase connected!</h1><p>${accounts.length} wallet(s) synced.</p>
      <p style="color:#888;font-size:14px;">Redirecting in <span id="t">10</span>s...</p>
      <a href="/konto/accounts" style="color:#d4a812;font-size:18px;">← Back to Konto</a>
      <script>let s=10;setInterval(()=>{s--;if(s>=0)document.getElementById('t').textContent=s;},1000);</script>
    </body></html>`);
  } catch (err: any) {
    return c.html(`<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">Error</h1><p>${err.message}</p>
      <a href="/konto/accounts" style="color:#d4a812;">← Back to Konto</a></body></html>`);
  }
});

router.post('/api/coinbase/sync', async (c) => {
  const userId = await getUserId(c);
  const connections = await db.execute({ sql: "SELECT * FROM coinbase_connections WHERE status = 'active' AND user_id = ?", args: [userId] });
  let totalSynced = 0;

  for (const rawConn of connections.rows as any[]) {
    const conn = decryptCoinbaseConn(rawConn);
    let token = conn.access_token;

    if (conn.expires_at && new Date(conn.expires_at) < new Date()) {
      try {
        const refreshRes = await fetch('https://api.coinbase.com/oauth/token', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: conn.refresh_token, client_id: COINBASE_CLIENT_ID, client_secret: COINBASE_CLIENT_SECRET }),
        });
        const refreshData = await refreshRes.json() as any;
        if (refreshRes.ok) {
          token = refreshData.access_token;
          await db.execute({
            sql: 'UPDATE coinbase_connections SET access_token = ?, refresh_token = ?, expires_at = ? WHERE id = ?',
            args: [encrypt(refreshData.access_token), encrypt(refreshData.refresh_token || conn.refresh_token), refreshData.expires_in ? new Date(Date.now() + refreshData.expires_in * 1000).toISOString() : null, conn.id]
          });
        }
      } catch (e) {
        console.error('Coinbase token refresh failed:', e);
        continue;
      }
    }

    try {
      const accRes = await fetch(`${COINBASE_API}/accounts?limit=100`, { headers: { 'Authorization': `Bearer ${token}` } });
      const accData = await accRes.json() as any;

      for (const acc of (accData.data || [])) {
        const balance = parseFloat(acc.balance?.amount || '0');
        const currency = acc.balance?.currency || acc.currency?.code || 'USD';
        const existing = await db.execute({ sql: "SELECT id FROM bank_accounts WHERE provider = 'coinbase' AND provider_account_id = ?", args: [acc.id] });
        if (existing.rows.length > 0) {
          await db.execute({ sql: 'UPDATE bank_accounts SET balance = ?, currency = ?, last_sync = ? WHERE id = ?', args: [balance, currency, new Date().toISOString(), existing.rows[0].id as number] });
        } else if (balance !== 0) {
          await db.execute({
            sql: `INSERT INTO bank_accounts (user_id, company_id, provider, provider_account_id, name, bank_name, balance, type, usage, subtype, currency, last_sync) VALUES (?, ?, 'coinbase', ?, ?, 'Coinbase', ?, 'investment', 'personal', 'crypto', ?, ?)`,
            args: [userId, null, acc.id, acc.name || `${currency} Wallet`, balance, currency, new Date().toISOString()]
          });
        }
        totalSynced++;
      }
    } catch (e: any) {
      console.error('Coinbase sync failed:', e.message);
    }
  }

  return c.json({ synced: totalSynced });
});

// ========== BINANCE EXCHANGE INTEGRATION (Read-Only) ==========

const BINANCE_API = 'https://api.binance.com';

// Helper to create Binance signature
function createBinanceSignature(queryString: string, apiSecret: string): string {
  const crypto = require('crypto');
  return crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
}

// Get Binance account info using read-only API
async function fetchBinanceAccount(apiKey: string, apiSecret: string) {
  const timestamp = Date.now();
  const queryString = `timestamp=${timestamp}`;
  const signature = createBinanceSignature(queryString, apiSecret);
  
  const res = await fetch(`${BINANCE_API}/api/v3/account?${queryString}&signature=${signature}`, {
    headers: { 'X-MBX-APIKEY': apiKey }
  });
  
  if (!res.ok) {
    const error = await res.json().catch(() => ({ msg: 'Unknown error' }));
    throw new Error(error.msg || `Binance API error: ${res.status}`);
  }
  
  return res.json();
}

// Get current prices for all symbols
async function fetchBinancePrices(): Promise<Record<string, number>> {
  const res = await fetch(`${BINANCE_API}/api/v3/ticker/price`);
  if (!res.ok) throw new Error('Failed to fetch Binance prices');
  const data = await res.json() as Array<{ symbol: string; price: string }>;
  const prices: Record<string, number> = {};
  for (const item of data) {
    prices[item.symbol] = parseFloat(item.price);
  }
  return prices;
}

// POST /api/binance/connect - Save API keys (read-only)
router.post('/api/binance/connect', async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json<any>();
  
  if (!body.apiKey || !body.apiSecret) {
    return c.json({ error: 'API key and secret are required' }, 400);
  }
  
  // Validate keys by making a test request
  try {
    await fetchBinanceAccount(body.apiKey, body.apiSecret);
  } catch (e: any) {
    return c.json({ error: `Invalid API keys: ${e.message}` }, 400);
  }
  
  // Deactivate any existing connection
  await db.execute({
    sql: "UPDATE binance_connections SET status = 'inactive' WHERE user_id = ? AND status = 'active'",
    args: [userId]
  });
  
  // Save new connection
  await db.execute({
    sql: `INSERT INTO binance_connections (user_id, api_key, api_secret, account_name, status) VALUES (?, ?, ?, ?, 'active')`,
    args: [userId, encrypt(body.apiKey), encrypt(body.apiSecret), body.accountName || 'Binance']
  });
  
  return c.json({ success: true, message: 'Binance connected successfully' });
});

// GET /api/binance/status - Check connection status
router.get('/api/binance/status', async (c) => {
  const userId = await getUserId(c);
  const connections = await db.execute({
    sql: "SELECT id, account_name, status, last_sync, created_at FROM binance_connections WHERE user_id = ? AND status = 'active'",
    args: [userId]
  });
  
  return c.json({ 
    connected: connections.rows.length > 0,
    connections: connections.rows
  });
});

// POST /api/binance/sync - Sync balances
router.post('/api/binance/sync', async (c) => {
  const userId = await getUserId(c);
  
  const connections = await db.execute({
    sql: "SELECT * FROM binance_connections WHERE status = 'active' AND user_id = ?",
    args: [userId]
  });
  
  let totalSynced = 0;
  const prices = await fetchBinancePrices();
  
  for (const rawConn of connections.rows as any[]) {
    const conn = decryptBinanceConn(rawConn);
    try {
      const account = await fetchBinanceAccount(conn.api_key, conn.api_secret);
      const balances = (account.balances || []).filter((b: any) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
      
      for (const balance of balances) {
        const asset = balance.asset;
        const amount = parseFloat(balance.free) + parseFloat(balance.locked);
        
        // Calculate value in USD
        let usdValue = 0;
        if (asset === 'USDT' || asset === 'BUSD' || asset === 'USDC') {
          usdValue = amount;
        } else {
          const priceSymbol = `${asset}USDT`;
          const price = prices[priceSymbol] || prices[`${asset}BUSD`] || prices[`${asset}BTC`] * prices['BTCUSDT'] || 0;
          usdValue = amount * price;
        }
        
        // Check if account already exists
        const accountId = `binance-${conn.id}-${asset}`;
        const existing = await db.execute({
          sql: "SELECT id FROM bank_accounts WHERE provider = 'binance' AND provider_account_id = ? AND user_id = ?",
          args: [accountId, userId]
        });
        
        if (existing.rows.length > 0) {
          await db.execute({
            sql: `UPDATE bank_accounts SET balance = ?, last_sync = ? WHERE id = ?`,
            args: [usdValue, new Date().toISOString(), existing.rows[0].id]
          });
        } else {
          await db.execute({
            sql: `INSERT INTO bank_accounts (user_id, company_id, provider, provider_account_id, name, bank_name, balance, type, usage, subtype, currency, last_sync) VALUES (?, ?, 'binance', ?, ?, ?, ?, 'investment', 'personal', 'crypto', 'USD', ?)`,
            args: [userId, null, accountId, `${asset} Wallet`, conn.account_name || 'Binance', usdValue, new Date().toISOString()]
          });
        }
        totalSynced++;
      }
      
      // Update last_sync time
      await db.execute({
        sql: 'UPDATE binance_connections SET last_sync = ? WHERE id = ?',
        args: [new Date().toISOString(), conn.id]
      });
      
    } catch (e: any) {
      console.error('Binance sync failed:', e.message);
      // Mark connection as potentially invalid
      await db.execute({
        sql: "UPDATE binance_connections SET status = 'error' WHERE id = ?",
        args: [conn.id]
      });
    }
  }
  
  return c.json({ synced: totalSynced });
});

// DELETE /api/binance/disconnect - Remove connection
router.delete('/api/binance/disconnect', async (c) => {
  const userId = await getUserId(c);
  
  // Deactivate connection
  await db.execute({
    sql: "UPDATE binance_connections SET status = 'inactive' WHERE user_id = ? AND status = 'active'",
    args: [userId]
  });
  
  // Optionally delete associated accounts
  await db.execute({
    sql: "DELETE FROM bank_accounts WHERE provider = 'binance' AND user_id = ?",
    args: [userId]
  });
  
  return c.json({ success: true });
});



export default router;
