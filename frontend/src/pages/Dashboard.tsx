import { API } from '../config';
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Home, Car, Watch, Package, ArrowRight, ChevronDown, Volume2, VolumeX, Eye, EyeOff, Download } from 'lucide-react';
import { useApi } from '../useApi';
import { useFilter } from '../FilterContext';
import ScopeSelect from '../components/ScopeSelect';
import { Link } from 'react-router-dom';
import PatrimoineChart from '../components/PatrimoineChart';
import DistributionDonut from '../components/DistributionDonut';


interface DashboardAccount {
  id: number;
  name: string;
  balance: number;
  type: string;
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

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value);
}

function typeBadgeColor(type: string): string {
  if (type === 'savings') return 'bg-blue-500/20 text-blue-400';
  if (type === 'loan') return 'bg-orange-500/20 text-orange-400';
  if (type === 'investment') return 'bg-purple-500/20 text-purple-400';
  return 'bg-white/5 text-muted';
}

const assetIcons: Record<string, typeof Home> = {
  real_estate: Home,
  vehicle: Car,
  valuable: Watch,
  other: Package,
};

const accountTypeOrder = ['checking', 'savings', 'investment', 'loan'] as const;

const QUOTE_COUNT = 20;
const sizeClasses: Record<string, string> = { sm: 'text-sm', base: 'text-base', lg: 'text-lg' };

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const { appendScope } = useFilter();
  const { data, loading } = useApi<DashboardData>(appendScope(`${API}/dashboard`));
  const [viewMode, setViewMode] = useState<'brut' | 'net'>('brut');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [speaking, setSpeaking] = useState(false);
  const [hideAmounts, setHideAmounts] = useState(() => localStorage.getItem('kompta_hide_amounts') !== 'false');
  const fc = (n: number) => hideAmounts ? '••••' : formatCurrency(n);

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

  const toggle = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  const totalValue = data ? (viewMode === 'brut' ? data.totals.brut : data.totals.net) : 0;
  const financialValue = data ? (viewMode === 'brut' ? data.financial.brutBalance : data.financial.netBalance) : 0;
  const patrimoineValue = data ? (viewMode === 'brut' ? data.patrimoine.brutValue : data.patrimoine.netValue) : 0;
  const loanTotal = data ? (data.financial.accountsByType.loan || []).reduce((s: number, a: DashboardAccount) => s + a.balance, 0) : 0;

  return (
    <div>
      {/* Title row with total + controls */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{t('dashboard')}</h1>
          <button
            onClick={() => setHideAmounts(h => !h)}
            className="text-muted hover:text-white transition-colors p-1"
            title={hideAmounts ? t('show_all_balances') : t('hide_all_balances')}
          >
            {hideAmounts ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
          {data && (
            <span className="text-sm font-semibold text-accent-400">{fc(totalValue)}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setViewMode('brut')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === 'brut'
                  ? 'bg-accent-500/20 text-accent-400 border-r border-accent-500/30'
                  : 'bg-surface text-muted border-r border-border'
              }`}
            >
              {t('balance_brut')}
            </button>
            <button
              onClick={() => setViewMode('net')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === 'net'
                  ? 'bg-accent-500/20 text-accent-400'
                  : 'bg-surface text-muted'
              }`}
            >
              {t('balance_net')}
            </button>
          </div>
          <ScopeSelect />
          <button
            onClick={() => {
              window.open(API + '/report/patrimoine?categories=all', '_blank');
            }}
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
          {/* Distribution bar — by asset category */}
          {(() => {
            const segments: { key: string; label: string; value: number; color: string }[] = [];
            const checking = (data.financial.accountsByType.checking || []).reduce((s: number, a: DashboardAccount) => s + a.balance, 0);
            const savings = (data.financial.accountsByType.savings || []).reduce((s: number, a: DashboardAccount) => s + a.balance, 0);
            const investment = (data.financial.accountsByType.investment || []).reduce((s: number, a: DashboardAccount) => s + a.balance, 0);
            const immo = patrimoineValue;

            if (checking > 0) segments.push({ key: 'checking', label: t('account_type_checking'), value: checking, color: 'bg-white/30' });
            if (savings > 0) segments.push({ key: 'savings', label: t('account_type_savings'), value: savings, color: 'bg-blue-500/70' });
            if (investment > 0) segments.push({ key: 'investment', label: t('account_type_investment'), value: investment, color: 'bg-purple-500/70' });
            if (immo > 0) segments.push({ key: 'immo', label: t('physical_assets'), value: immo, color: 'bg-green-500/70' });

            const total = segments.reduce((s, seg) => s + seg.value, 0);
            if (total <= 0) return null;

            return (
              <div className="mb-4">
                <div className="flex h-3 rounded-full overflow-hidden bg-surface border border-border">
                  {segments.map(seg => (
                    <div
                      key={seg.key}
                      className={`${seg.color} transition-all duration-300`}
                      style={{ width: `${(seg.value / total) * 100}%` }}
                      title={`${seg.label}: ${fc(seg.value)}`}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-muted">
                  {segments.map(seg => (
                    <div key={seg.key} className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${seg.color}`} />
                      <span>{seg.label} {fc(seg.value)}</span>
                    </div>
                  ))}
                  {loanTotal < 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-orange-500/70" />
                      <span>{t('total_loans')} {fc(loanTotal)}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Patrimoine evolution chart */}
          <PatrimoineChart />

          {/* Distribution donut */}
          {(() => {
            const distData: { key: string; value: number }[] = [];
            const checking = (data.financial.accountsByType.checking || []).reduce((s: number, a: DashboardAccount) => s + a.balance, 0);
            const savings = (data.financial.accountsByType.savings || []).reduce((s: number, a: DashboardAccount) => s + a.balance, 0);
            const investment = (data.financial.accountsByType.investment || []).reduce((s: number, a: DashboardAccount) => s + a.balance, 0);
            if (checking > 0) distData.push({ key: 'checking', value: checking });
            if (savings > 0) distData.push({ key: 'savings', value: savings });
            if (investment > 0) distData.push({ key: 'investment', value: investment });
            for (const asset of data.patrimoine.assets) {
              distData.push({ key: asset.type || 'other', value: asset.currentValue });
            }
            // Merge same keys
            const merged: Record<string, number> = {};
            for (const d of distData) merged[d.key] = (merged[d.key] || 0) + d.value;
            const final = Object.entries(merged).map(([key, value]) => ({ key, value }));
            const posTotal = final.filter(d => d.value > 0).reduce((s, d) => s + d.value, 0);
            return <DistributionDonut data={final} total={posTotal} hideAmounts={hideAmounts} />;
          })()}

          {/* Financial section — collapsible */}
          <div className="mb-6">
            <button
              onClick={() => toggle('financial')}
              className="w-full flex items-center justify-between mb-3 group"
            >
              <h2 className="text-sm font-medium text-muted uppercase tracking-wide">
                {t('financial_assets')}
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-accent-400">
                  {fc(financialValue)}
                </span>
                <ChevronDown
                  size={14}
                  className={`text-muted transition-transform ${collapsed.financial ? '-rotate-90' : ''}`}
                />
              </div>
            </button>

            {!collapsed.financial && (
              <>
                {accountTypeOrder.map((type) => {
                  const accounts = data.financial.accountsByType[type] || [];
                  if (accounts.length === 0) return null;
                  if (viewMode === 'brut' && type === 'loan') return null;

                  const groupTotal = accounts.reduce((s: number, a: DashboardAccount) => s + a.balance, 0);

                  return (
                    <div key={type} className="mb-3">
                      <button
                        onClick={() => toggle(type)}
                        className="w-full flex items-center justify-between px-1 mb-1 group"
                      >
                        <span className={`text-xs px-2 py-0.5 rounded-full ${typeBadgeColor(type)}`}>
                          {t(`account_type_${type}`)}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted">{fc(groupTotal)}</span>
                          <ChevronDown
                            size={12}
                            className={`text-muted transition-transform ${collapsed[type] ? '-rotate-90' : ''}`}
                          />
                        </div>
                      </button>
                      {!collapsed[type] && (
                        <div className="bg-surface rounded-xl border border-border divide-y divide-border">
                          {accounts.map((acc: DashboardAccount) => (
                            <div key={acc.id} className="flex items-center justify-between px-4 py-3">
                              <p className="text-sm font-medium">{acc.name}</p>
                              <p className={`text-sm font-semibold ${acc.balance < 0 ? 'text-red-400' : 'text-accent-400'}`}>
                                {fc(acc.balance)}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {data.accountCount === 0 && (
                  <div className="bg-surface rounded-xl border border-border p-6 text-center text-muted text-sm">
                    {t('no_accounts')}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Patrimoine section — collapsible */}
          {data.patrimoine.count > 0 && (
            <div>
              <button
                onClick={() => toggle('patrimoine')}
                className="w-full flex items-center justify-between mb-3 group"
              >
                <h2 className="text-sm font-medium text-muted uppercase tracking-wide">
                  {t('physical_assets')}
                </h2>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-accent-400">
                    {fc(patrimoineValue)}
                  </span>
                  <ChevronDown
                    size={14}
                    className={`text-muted transition-transform ${collapsed.patrimoine ? '-rotate-90' : ''}`}
                  />
                </div>
              </button>

              {!collapsed.patrimoine && (
                <>
                  <div className="bg-surface rounded-xl border border-border divide-y divide-border mb-3">
                    {data.patrimoine.assets.map((asset) => {
                      const Icon = assetIcons[asset.type] || Package;
                      const displayValue = viewMode === 'net' && asset.loanBalance
                        ? asset.currentValue + asset.loanBalance
                        : asset.currentValue;
                      return (
                        <div key={asset.id} className="flex items-center justify-between px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Icon size={16} className="text-muted" />
                            <p className="text-sm font-medium">{asset.name}</p>
                          </div>
                          <div className="text-right">
                            <p className={`text-sm font-semibold ${displayValue < 0 ? 'text-red-400' : 'text-accent-400'}`}>
                              {fc(displayValue)}
                            </p>
                            {viewMode === 'net' && asset.loanBalance < 0 && (
                              <p className="text-xs text-muted">
                                {fc(asset.currentValue)} + {fc(asset.loanBalance)}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <Link
                    to="/kompta/assets"
                    className="flex items-center gap-1 text-xs text-accent-400 hover:text-accent-300 transition-colors"
                  >
                    {t('view_all_assets')} <ArrowRight size={12} />
                  </Link>
                </>
              )}
            </div>
          )}

          {/* Daily quote */}
          <div className="mt-6 text-center">
            <p className={`italic text-muted ${sizeClasses[quoteSize] || 'text-base'}`}>
              {quoteText}
            </p>
            <button
              onClick={toggleSpeak}
              className="mt-2 p-1.5 rounded-lg text-muted hover:text-accent-400 hover:bg-surface-hover transition-colors"
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
