import { API } from '../config';
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Download, Volume2, VolumeX, ChevronDown, Landmark, TrendingUp, Home, CreditCard } from 'lucide-react';
import { useApi } from '../useApi';
import { useFilter } from '../FilterContext';
import { usePreferences } from '../PreferencesContext';
import ScopeSelect from '../components/ScopeSelect';
import PatrimoineChart from '../components/PatrimoineChart';
import DistributionDonut from '../components/DistributionDonut';


interface DashboardAccount {
  id: number;
  name: string;
  balance: number;
  type: string;
  currency: string;
}

interface DashboardAsset {
  id: number;
  type: string;
  name: string;
  currentValue: number;
  loanBalance: number;
}

interface DashboardData {
  financial: {
    brutBalance: number;
    netBalance: number;
    accountsByType: Record<string, DashboardAccount[]>;
  };
  patrimoine: {
    brutValue: number;
    netValue: number;
    count: number;
    assets: DashboardAsset[];
  };
  totals: {
    brut: number;
    net: number;
  };
  accountCount: number;
  companyCount: number;
  distribution: { personal: number; pro: number };
}

const QUOTE_COUNT = 20;
const sizeClasses: Record<string, string> = { sm: 'text-sm', base: 'text-base', lg: 'text-lg' };

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const { appendScope } = useFilter();
  const { formatCurrency, convertToDisplay } = usePreferences();
  const { data, loading } = useApi<DashboardData>(appendScope(`${API}/dashboard`));
  const [hideAmounts, setHideAmounts] = useState(() => localStorage.getItem('kompta_hide_amounts') !== 'false');
  const [chartOpen, setChartOpen] = useState(false);
  const [donutOpen, setDonutOpen] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const fc = (n: number) => hideAmounts ? <span className="amount-masked">{formatCurrency(n)}</span> : formatCurrency(n);

  const quoteIndex = (Math.floor(Date.now() / 86400000) % QUOTE_COUNT) + 1;
  const quoteText = t(`quote_${quoteIndex}`);
  const quoteSize = localStorage.getItem('kompta_quote_size') || 'base';

  const toggleSpeak = useCallback(() => {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(quoteText);
    utterance.lang = i18n.language === 'fr' ? 'fr-FR' : 'en-US';
    utterance.onend = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, [quoteText, i18n.language]);

  // Compute summary values
  const convertAcc = (a: DashboardAccount) => convertToDisplay(a.balance, a.currency || 'EUR');
  
  const checking = data ? (data.financial.accountsByType.checking || []).reduce((s: number, a: DashboardAccount) => s + convertAcc(a), 0) : 0;
  const savings = data ? (data.financial.accountsByType.savings || []).reduce((s: number, a: DashboardAccount) => s + convertAcc(a), 0) : 0;
  const investments = data ? (data.financial.accountsByType.investment || []).reduce((s: number, a: DashboardAccount) => s + convertAcc(a), 0) : 0;
  const loans = data ? (data.financial.accountsByType.loan || []).reduce((s: number, a: DashboardAccount) => s + convertAcc(a), 0) : 0;
  
  const immoValue = data ? data.patrimoine.assets.filter(a => a.type === 'real_estate').reduce((s, a) => s + a.currentValue, 0) : 0;
  // Crypto = blockchain/coinbase accounts (type investment with crypto currencies)
  // For now include all investments as "Stocks" and patrimoine real_estate as "Real Estate"
  const cashTotal = checking + savings;
  
  const brutTotal = cashTotal + investments + immoValue + (data ? data.patrimoine.assets.filter(a => a.type !== 'real_estate').reduce((s, a) => s + a.currentValue, 0) : 0);
  const netTotal = brutTotal + loans;

  // Summary blocks
  const summaryBlocks = data ? [
    { icon: Landmark, label: t('summary_cash') || 'Liquidités', value: cashTotal, color: 'text-white' },
    { icon: TrendingUp, label: t('summary_stocks') || 'Investissements', value: investments, color: 'text-purple-400' },
    { icon: Home, label: t('immobilier') || 'Immobilier', value: immoValue, color: 'text-green-400' },
    { icon: CreditCard, label: t('total_loans') || 'Emprunts', value: loans, color: 'text-orange-400' },
  ].filter(b => b.value !== 0) : [];

  // Donut data
  const donutData = data ? (() => {
    const distData: { key: string; value: number }[] = [];
    if (checking > 0) distData.push({ key: 'checking', value: checking });
    if (savings > 0) distData.push({ key: 'savings', value: savings });
    if (investments > 0) distData.push({ key: 'investment', value: investments });
    for (const asset of data.patrimoine.assets) {
      distData.push({ key: asset.type || 'other', value: asset.currentValue });
    }
    const merged: Record<string, number> = {};
    for (const d of distData) merged[d.key] = (merged[d.key] || 0) + d.value;
    return Object.entries(merged).map(([key, value]) => ({ key, value }));
  })() : [];
  const posTotal = donutData.filter(d => d.value > 0).reduce((s, d) => s + d.value, 0);

  return (
    <div>
      {/* Title row */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-xl font-semibold whitespace-nowrap">{t('dashboard')}</h1>
          <button
            onClick={() => setHideAmounts(h => { const v = !h; localStorage.setItem('kompta_hide_amounts', String(!v)); return v; })}
            className="text-muted hover:text-white transition-colors p-2"
            title={hideAmounts ? t('show_all_balances') : t('hide_all_balances')}
          >
            {hideAmounts ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <ScopeSelect />
          <button
            onClick={() => window.open(API + '/report/patrimoine?categories=all', '_blank')}
            className="p-2 rounded-lg text-muted hover:text-accent-400 hover:bg-surface-hover transition-colors"
            title="Télécharger rapport PDF"
          >
            <Download size={16} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-muted py-8">Loading...</div>
      ) : data ? (
        <>
          {/* Net Worth hero */}
          <div className="bg-surface rounded-xl border border-border p-4 sm:p-6 mb-4 text-center">
            <p className="text-xs text-muted uppercase tracking-wider mb-1">{t('net_worth') || 'Patrimoine net'}</p>
            <p className="text-2xl sm:text-3xl font-bold text-accent-400">{fc(netTotal)}</p>
            {brutTotal !== netTotal && (
              <p className="text-xs text-muted mt-1">{t('balance_brut') || 'Brut'}: {fc(brutTotal)}</p>
            )}
          </div>

          {/* Summary blocks */}
          <div className="grid grid-cols-2 gap-2 sm:gap-3 mb-4">
            {summaryBlocks.map((block) => {
              const Icon = block.icon;
              return (
                <div key={block.label} className="bg-surface rounded-xl border border-border px-3 py-2.5 sm:px-4 sm:py-3 flex items-center gap-2.5">
                  <Icon size={18} className={`${block.color} flex-shrink-0`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] sm:text-xs text-muted truncate">{block.label}</p>
                    <p className={`text-sm sm:text-base font-semibold ${block.value < 0 ? 'text-orange-400' : 'text-accent-400'}`}>
                      {fc(block.value)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Patrimoine evolution chart — collapsible */}
          <div className="mb-3">
            <button
              onClick={() => setChartOpen(o => !o)}
              className="w-full flex items-center justify-between py-2 group"
            >
              <h2 className="text-sm font-medium text-muted uppercase tracking-wide">
                {t('patrimoine_evolution') || 'Évolution du patrimoine'}
              </h2>
              <ChevronDown
                size={14}
                className={`text-muted transition-transform ${chartOpen ? '' : '-rotate-90'}`}
              />
            </button>
            {chartOpen && <PatrimoineChart />}
          </div>

          {/* Distribution donut — collapsible */}
          <div className="mb-3">
            <button
              onClick={() => setDonutOpen(o => !o)}
              className="w-full flex items-center justify-between py-2 group"
            >
              <h2 className="text-sm font-medium text-muted uppercase tracking-wide">
                {t('patrimoine_distribution') || 'Répartition du patrimoine'}
              </h2>
              <ChevronDown
                size={14}
                className={`text-muted transition-transform ${donutOpen ? '' : '-rotate-90'}`}
              />
            </button>
            {donutOpen && <DistributionDonut data={donutData} total={posTotal} hideAmounts={hideAmounts} />}
          </div>

          {/* Daily quote */}
          <div className="mt-6 text-center">
            <p className={`italic text-muted ${sizeClasses[quoteSize] || 'text-base'}`}>
              {quoteText}
            </p>
            <button
              onClick={toggleSpeak}
              className="mt-2 p-3 rounded-lg text-muted hover:text-accent-400 hover:bg-surface-hover transition-colors min-w-[44px] min-h-[44px]"
              title={speaking ? 'Stop' : 'Listen'}
            >
              {speaking ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
