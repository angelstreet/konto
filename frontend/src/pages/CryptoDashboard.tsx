import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bitcoin, Plus } from 'lucide-react';

import EyeToggle from '../components/EyeToggle';
import ScopeSelect from '../components/ScopeSelect';
import { useAmountVisibility } from '../AmountVisibilityContext';
import { useFilter } from '../FilterContext';
import { useApi } from '../useApi';
import { API } from '../config';

// Map ticker → CoinGecko ID
const CRYPTO_IDS: Record<string, string> = {
  BTC:   'bitcoin',
  ETH:   'ethereum',
  SOL:   'solana',
  XRP:   'ripple',
  MATIC: 'matic-network',
  BNB:   'binancecoin',
  AVAX:  'avalanche-2',
  USDT:  'tether',
  USDC:  'usd-coin',
  DOGE:  'dogecoin',
  ADA:   'cardano',
  DOT:   'polkadot',
};

const PRICE_IDS = Object.values(CRYPTO_IDS).join(',');
const CRYPTO_PROVIDERS = ['blockchain', 'coinbase', 'binance'];
type DisplayCurrency = 'EUR' | 'USD';
type CoinGeckoPrices = Record<string, { eur: number; usd: number; eur_24h_change?: number }>;

interface BankAccount {
  id: number;
  name: string;
  custom_name: string | null;
  bank_name: string | null;
  type: string;
  subtype: string | null;
  provider: string | null;
  balance: number;
  currency: string;
}

function fmtFiat(n: number, currency: DisplayCurrency): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(n);
}
function fmtCompactFiat(n: number, currency: DisplayCurrency): string {
  const sym = currency === 'EUR' ? '€' : '$';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')}M${sym}`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}k${sym}`;
  return `${Math.round(n)}${sym}`;
}
function fmtNative(n: number, currency: string): string {
  const cur = currency.toUpperCase();
  const decimals = cur === 'BTC' ? 8 : cur === 'ETH' ? 6 : ['USD', 'USDT', 'USDC'].includes(cur) ? 2 : 4;
  const trimmed = n.toFixed(decimals).replace(/(\.\d*[1-9])0+$/, '$1').replace(/\.0+$/, '');
  return `${trimmed} ${cur}`;
}

function WalletAvatar({ name }: { name: string }) {
  const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="w-8 h-8 rounded-full bg-accent-500/20 flex items-center justify-center flex-shrink-0">
      <span className="text-xs font-bold text-accent-400">{initials}</span>
    </div>
  );
}

export default function CryptoDashboard() {
  const navigate = useNavigate();
  const { hideAmounts, toggleHideAmounts } = useAmountVisibility();
  const { appendScope } = useFilter();
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>('EUR');

  const { data: allAccounts } = useApi<BankAccount[]>(appendScope(`${API}/bank/accounts`));
  const { data: priceData } = useApi<CoinGeckoPrices>(`${API}/crypto/prices?ids=${PRICE_IDS}`);

  const wallets = useMemo(
    () =>
      (allAccounts || []).filter(
        (a) =>
          (a.type === 'investment' && a.subtype === 'crypto') ||
          CRYPTO_PROVIDERS.includes(a.provider || '')
      ),
    [allAccounts]
  );

  // Build rates for both EUR and USD from CoinGecko response
  const rates = useMemo(() => {
    const eur: Record<string, number> = { EUR: 1 };
    const usd: Record<string, number> = { USD: 1 };
    if (!priceData) return { eur, usd };

    for (const [ticker, geckoId] of Object.entries(CRYPTO_IDS)) {
      if (priceData[geckoId]?.eur) eur[ticker] = priceData[geckoId].eur;
      if (priceData[geckoId]?.usd) usd[ticker] = priceData[geckoId].usd;
    }
    // Cross fiat rates via BTC bridge
    if (priceData.bitcoin?.eur && priceData.bitcoin?.usd) {
      eur['USD'] = priceData.bitcoin.eur / priceData.bitcoin.usd;
      usd['EUR'] = priceData.bitcoin.usd / priceData.bitcoin.eur;
    }
    return { eur, usd };
  }, [priceData]);

  function toDisplay(balance: number, currency: string): number | null {
    const cur = (currency || 'EUR').toUpperCase();
    const rateMap = displayCurrency === 'EUR' ? rates.eur : rates.usd;
    const rate = rateMap[cur];
    return rate !== undefined ? balance * rate : null;
  }

  const total = wallets.reduce((sum, w) => {
    const v = toDisplay(Math.abs(w.balance || 0), w.currency);
    return v !== null ? sum + v : sum;
  }, 0);

  const pricesLoaded = priceData !== null;

  const CurrencyToggle = (
    <div className="flex items-center bg-black/30 border border-border rounded-lg p-0.5">
      {(['EUR', 'USD'] as DisplayCurrency[]).map((cur) => (
        <button
          key={cur}
          onClick={() => setDisplayCurrency(cur)}
          className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
            displayCurrency === cur
              ? 'bg-accent-500/20 text-accent-400 border border-accent-500/30'
              : 'text-muted hover:text-white'
          }`}
        >
          {cur === 'EUR' ? '€ EUR' : '$ USD'}
        </button>
      ))}
    </div>
  );

  if (wallets.length === 0 && allAccounts !== null) {
    return (
      <div>
        <div className="flex items-center justify-between gap-2 mb-4 h-10">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => navigate('/more')}
              className="md:hidden text-muted hover:text-white transition-colors p-1 -ml-1 flex-shrink-0"
            >
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-xl font-semibold whitespace-nowrap">Crypto</h1>
          </div>
          <div className="flex items-center gap-1">
            <span className="hidden md:block"><ScopeSelect /></span>
            <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-accent-500 text-black flex-shrink-0">
              <Plus size={16} />
              <span className="hidden sm:inline">Ajouter un wallet</span>
            </button>
          </div>
        </div>
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <Bitcoin className="mx-auto text-muted mb-3" size={32} />
          <p className="text-muted text-sm mb-2">Aucun wallet crypto trouvé.</p>
          <p className="text-muted text-xs mb-6">
            Connectez vos wallets Ledger, Coinbase ou autres via vos comptes bancaires.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-4 h-10">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => navigate('/more')}
            className="md:hidden text-muted hover:text-white transition-colors p-1 -ml-1 flex-shrink-0"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-semibold whitespace-nowrap">Crypto</h1>
          <EyeToggle hidden={hideAmounts} onToggle={toggleHideAmounts} />
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {CurrencyToggle}
          <span className="hidden md:block"><ScopeSelect /></span>
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-accent-500 text-black">
            <Plus size={16} />
            <span className="hidden sm:inline">Ajouter un wallet</span>
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 p-4 bg-gradient-to-r from-gray-900/50 to-gray-800/50 rounded-xl border border-gray-700">
        <div>
          <p className="text-sm text-muted uppercase tracking-wide mb-1">
            Valeur totale
            {!pricesLoaded && <span className="text-xs text-muted/60 ml-1 normal-case">chargement…</span>}
          </p>
          <p className="text-2xl font-bold text-white">
            {hideAmounts
              ? <span className="amount-masked">{fmtCompactFiat(total, displayCurrency)}</span>
              : fmtCompactFiat(total, displayCurrency)}
          </p>
          {pricesLoaded && (
            <p className="text-xs text-muted mt-0.5">Conversion live via CoinGecko</p>
          )}
        </div>
        <div>
          <p className="text-sm text-muted uppercase tracking-wide mb-1">Wallets</p>
          <p className="text-2xl font-bold text-accent-400">{wallets.length}</p>
        </div>
      </div>

      {/* Wallets table */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-white">Wallets &amp; Comptes</h2>
        </div>
        <div className="hidden md:grid grid-cols-[1fr_160px_160px] gap-4 px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wider border-b border-border/60">
          <span>Nom</span>
          <span className="text-right">Fournisseur</span>
          <span className="text-right">Valeur ({displayCurrency})</span>
        </div>

        {wallets.map((wallet) => {
          const displayName = wallet.custom_name || wallet.name;
          const nativeBalance = Math.abs(wallet.balance || 0);
          const cur = (wallet.currency || 'EUR').toUpperCase();
          const converted = toDisplay(nativeBalance, cur);
          const isNative = cur !== displayCurrency;

          return (
            <div
              key={wallet.id}
              className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_160px_160px] gap-4 px-4 py-3.5 items-center border-b border-border/50 last:border-0 hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <WalletAvatar name={displayName} />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{displayName}</p>
                  <p className="text-xs text-muted truncate">
                    {wallet.bank_name && `${wallet.bank_name} · `}
                    {isNative
                      ? <span className="tabular-nums">{fmtNative(nativeBalance, cur)}</span>
                      : cur}
                  </p>
                </div>
              </div>
              <span className="hidden md:block text-sm text-right text-muted tabular-nums">
                {wallet.provider || '—'}
              </span>
              <div className="text-right">
                <p className="text-sm font-semibold tabular-nums">
                  {converted !== null
                    ? hideAmounts
                      ? <span className="amount-masked">{fmtFiat(converted, displayCurrency)}</span>
                      : fmtFiat(converted, displayCurrency)
                    : hideAmounts
                      ? <span className="amount-masked">{fmtNative(nativeBalance, cur)}</span>
                      : fmtNative(nativeBalance, cur)}
                </p>
              </div>
            </div>
          );
        })}

        {/* Total row */}
        {wallets.length > 1 && (
          <div className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_160px_160px] gap-4 px-4 py-3 items-center bg-white/5 border-t border-border/50">
            <span className="text-sm font-semibold">Total</span>
            <span className="hidden md:block" />
            <span className="text-sm font-bold text-right tabular-nums">
              {hideAmounts
                ? <span className="amount-masked">{fmtFiat(total, displayCurrency)}</span>
                : fmtFiat(total, displayCurrency)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
