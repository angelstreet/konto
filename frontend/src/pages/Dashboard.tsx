import { API } from '../config';
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Volume2, VolumeX, Landmark, TrendingUp, Home, CreditCard, PlusCircle } from 'lucide-react';
import EyeToggle from '../components/EyeToggle';
import { useApi } from '../useApi';
import { useFilter } from '../FilterContext';
import { usePreferences } from '../PreferencesContext';
import { useAmountVisibility } from '../AmountVisibilityContext';
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
  const { hideAmounts, toggleHideAmounts } = useAmountVisibility();
  const [showNet, setShowNet] = useState(() => localStorage.getItem('konto_show_net') !== 'false');
  const [speaking, setSpeaking] = useState(false);
  const fc = (n: number) => hideAmounts ? <span className="amount-masked">{formatCurrency(n)}</span> : formatCurrency(n);

  const quoteIndex = (Math.floor(Date.now() / 86400000) % QUOTE_COUNT) + 1;
  const quoteText = t(`quote_${quoteIndex}`);
  const quoteSize = localStorage.getItem('konto_quote_size') || 'base';

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
  
  const immoAssets = data ? data.patrimoine.assets.filter(a => a.type === 'real_estate') : [];
  const immoValue = immoAssets.reduce((s, a) => s + a.currentValue, 0);
  const immoNetValue = immoAssets.reduce((s, a) => s + a.currentValue + a.loanBalance, 0);
  // Crypto = blockchain/coinbase accounts (type investment with crypto currencies)
  // For now include all investments as "Stocks" and patrimoine real_estate as "Real Estate"
  const cashTotal = checking + savings;

  const brutTotal = cashTotal + investments + immoValue + (data ? data.patrimoine.assets.filter(a => a.type !== 'real_estate').reduce((s, a) => s + a.currentValue, 0) : 0);
  const netTotal = brutTotal + loans;

  // Summary blocks
  const summaryBlocks = data ? [
    { icon: Landmark, label: t('summary_cash'), value: cashTotal, color: 'text-white' },
    { icon: TrendingUp, label: t('summary_stocks'), value: investments, color: 'text-purple-400' },
    { icon: Home, label: t('immobilier'), value: showNet ? immoNetValue : immoValue, color: 'text-green-400' },
    { icon: CreditCard, label: t('total_loans'), value: loans, color: 'text-orange-400' },
  ].filter(b => b.value !== 0) : [];

  // Donut data
  const donutData = data ? (() => {
    const distData: { key: string; value: number }[] = [];
    if (checking > 0) distData.push({ key: 'checking', value: checking });
    if (savings > 0) distData.push({ key: 'savings', value: savings });
    if (investments > 0) distData.push({ key: 'investment', value: investments });
    for (const asset of data.patrimoine.assets) {
      const val = showNet ? asset.currentValue + asset.loanBalance : asset.currentValue;
      distData.push({ key: asset.type || 'other', value: val });
    }
    const merged: Record<string, number> = {};
    for (const d of distData) merged[d.key] = (merged[d.key] || 0) + d.value;
    return Object.entries(merged).map(([key, value]) => ({ key, value }));
  })() : [];
  const posTotal = donutData.filter(d => d.value > 0).reduce((s, d) => s + d.value, 0);

  // Show loading state while data is being fetched
  if (loading && !data) {
    return (
      <div className="text-center py-20 px-4">
        <div className="text-muted text-sm">Chargement...</div>
      </div>
    );
  }

  // Only show welcome screen if not loading and no accounts exist
  // This prevents the flash when changing filters
  if (!loading && (!data || data.accountCount === 0)) {
    const connectBank = async () => {
      const res = await fetch(appendScope(`${API}/bank/connect`), { credentials: "include" });
      const responseData = await res.json();
      if (responseData.url) {
        window.location.href = responseData.url;
      }
    };

    return (
      <div className="text-center py-20 px-4">
        <div className="text-6xl mb-8 mx-auto">🦎</div>
        <h2 className="text-3xl font-bold mb-6 text-accent-400">{t("welcome_konto")}</h2>
        <p className="text-muted mb-12 text-lg max-w-md mx-auto">{t("no_accounts", "Aucun compte lié. Ajoutez-en un pour commencer.")}</p>
        <div className="max-w-md mx-auto space-y-4">
          <button
            onClick={connectBank}
            className="w-full flex items-center justify-center gap-3 px-8 py-5 bg-accent-500 hover:bg-accent-600 text-white rounded-2xl transition-all font-semibold shadow-xl h-14"
          >
            <Landmark size={24} />
            <span>{t("connect_bank")}</span>
          </button>
          <button
            onClick={() => window.location.href = "/accounts"}
            className="w-full flex items-center justify-center gap-3 px-8 py-5 border-2 border-accent-500/50 bg-surface hover:bg-surface-hover text-accent-400 rounded-2xl transition-all font-semibold shadow-lg h-14"
          >
            <PlusCircle size={24} />
            <span>{t("add_account", "Ajouter votre premier compte")}</span>
          </button>
          <button
            onClick={() => window.location.href = "/import"}
            className="w-full flex items-center justify-center gap-3 px-8 py-5 border border-border/50 hover:border-accent-400/50 bg-surface/50 hover:bg-surface text-muted hover:text-accent-400 rounded-2xl transition-all font-medium h-14"
          >
            <Download size={24} />
            <span>{t("nav_import", "Importer depuis fichier")}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Title row: Title LEFT, Eye+actions RIGHT */}
      <div className="flex items-center justify-between gap-2 mb-2 h-10">
        <div className="flex items-center gap-1 min-w-0">
          <h1 className="text-xl font-semibold whitespace-nowrap">{t('nav_dashboard')}</h1>
          <EyeToggle hidden={hideAmounts} onToggle={toggleHideAmounts} />
          <button
            onClick={() => setShowNet(v => { const n = !v; localStorage.setItem('konto_show_net', String(n)); return n; })}
            className="text-xs px-2 py-1 rounded-md font-medium transition-colors text-muted hover:text-white hover:bg-surface-hover flex-shrink-0"
          >
            {showNet ? 'Net' : 'Brut'}
          </button>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <ScopeSelect />
        </div>
      </div>

      {loading ? (
        <div className="text-center text-muted py-8">Loading...</div>
      ) : data ? (
        <>
          {/* Patrimoine hero */}
          <div className="bg-surface rounded-xl border border-border p-3 sm:p-4 mb-2 text-center">
            <p className="text-xs text-muted tracking-wider mb-1">{showNet ? t('net_worth') : t('balance_brut')}</p>
            <p className="text-2xl sm:text-3xl font-bold text-accent-400">{fc(showNet ? netTotal : brutTotal)}</p>
          </div>

          {/* Summary blocks */}
          <div className="flex gap-2 sm:gap-3 mb-2 overflow-x-auto">
            {summaryBlocks.map((block) => {
              const Icon = block.icon;
              return (
                <div key={block.label} className="bg-surface rounded-xl border border-border px-3 py-2.5 sm:px-4 sm:py-3 flex items-center gap-2.5 flex-shrink-0 min-w-0 flex-1">
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

          {/* Patrimoine charts — side by side 2x1 grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 items-stretch">
            {/* Evolution chart */}
            <PatrimoineChart showNet={showNet} hideAmounts={hideAmounts} />

            {/* Distribution donut */}
            {donutData.length > 0 && (
              <DistributionDonut data={donutData} total={showNet ? netTotal : posTotal} hideAmounts={hideAmounts} showNet={showNet} loans={loans} />
            )}
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
