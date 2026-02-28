import { useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Subscription {
  merchant: string;
  amount: number;
  frequency: 'monthly' | 'yearly';
  category: string;
  icon: string;
  color: string;
  lastDate: string;
  firstDate: string;
  totalYearly: number;
}

interface SubscriptionsData {
  subscriptions: Subscription[];
  totalMonthly: number;
  totalYearly: number;
  count: number;
}

const MOCK_DATA: SubscriptionsData = {
  count: 12,
  totalMonthly: -287,
  totalYearly: -3444,
  subscriptions: [
    { merchant: 'AUTOMOBILE', amount: -90.37, frequency: 'monthly', category: 'auto', icon: '🚗', color: '#f59e0b', lastDate: '2026-02-04', firstDate: '2025-01-04', totalYearly: -1084 },
    { merchant: 'AXA', amount: -18.78, frequency: 'monthly', category: 'assurance', icon: '🛡️', color: '#3b82f6', lastDate: '2026-02-05', firstDate: '2025-01-05', totalYearly: -225 },
    { merchant: 'BOUYGUES TELECOM', amount: -16.50, frequency: 'monthly', category: 'telecom', icon: '📱', color: '#a855f7', lastDate: '2026-02-05', firstDate: '2025-10-05', totalYearly: -198 },
    { merchant: 'NETFLIX', amount: -13.99, frequency: 'monthly', category: 'loisirs', icon: '🎬', color: '#ef4444', lastDate: '2026-02-10', firstDate: '2024-03-10', totalYearly: -168 },
    { merchant: 'SPOTIFY', amount: -10.99, frequency: 'monthly', category: 'loisirs', icon: '🎵', color: '#22c55e', lastDate: '2026-02-15', firstDate: '2023-06-15', totalYearly: -132 },
    { merchant: 'EDF', amount: -68.00, frequency: 'monthly', category: 'energie', icon: '⚡', color: '#eab308', lastDate: '2026-02-01', firstDate: '2024-01-01', totalYearly: -816 },
    { merchant: 'AMAZON PRIME', amount: -6.99, frequency: 'monthly', category: 'loisirs', icon: '📦', color: '#f97316', lastDate: '2026-02-20', firstDate: '2023-01-20', totalYearly: -84 },
    { merchant: 'APPLE ICLOUD', amount: -2.99, frequency: 'monthly', category: 'tech', icon: '☁️', color: '#6b7280', lastDate: '2026-02-12', firstDate: '2022-12-12', totalYearly: -36 },
    { merchant: 'ORANGE MOBILE', amount: -25.99, frequency: 'monthly', category: 'telecom', icon: '📱', color: '#a855f7', lastDate: '2026-02-08', firstDate: '2024-08-08', totalYearly: -312 },
    { merchant: 'ASSURANCE HABITATION', amount: -22.50, frequency: 'monthly', category: 'assurance', icon: '🏠', color: '#3b82f6', lastDate: '2026-02-03', firstDate: '2025-03-03', totalYearly: -270 },
    { merchant: 'DISNEY+', amount: -8.99, frequency: 'monthly', category: 'loisirs', icon: '🎬', color: '#1d4ed8', lastDate: '2026-02-18', firstDate: '2024-11-18', totalYearly: -108 },
    { merchant: 'MICROSOFT 365', amount: -9.99, frequency: 'monthly', category: 'tech', icon: '💻', color: '#0ea5e9', lastDate: '2026-02-22', firstDate: '2023-09-22', totalYearly: -120 },
  ]
};

type SortKey = 'amount' | 'category' | 'date';

function formatAmount(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr);
  const months = ['jan.', 'fev.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'aout', 'sep.', 'oct.', 'nov.', 'dec.'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function formatSince(dateStr: string): string {
  const d = new Date(dateStr);
  const months = ['jan.', 'fev.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'aout', 'sep.', 'oct.', 'nov.', 'dec.'];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

function addOneMonth(dateStr: string): string {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + 1);
  return formatDateShort(d.toISOString().split('T')[0]);
}

function getCategoryBreakdown(subs: Subscription[]) {
  const map: Record<string, number> = {};
  for (const s of subs) {
    map[s.category] = (map[s.category] || 0) + Math.abs(s.amount);
  }
  const total = Object.values(map).reduce((a, b) => a + b, 0);
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amt]) => ({ cat, amt, pct: (amt / total) * 100 }));
}

const CATEGORY_COLORS: Record<string, string> = {
  auto: '#f59e0b',
  assurance: '#3b82f6',
  telecom: '#a855f7',
  loisirs: '#ef4444',
  energie: '#eab308',
  tech: '#0ea5e9',
};

function getCatColor(cat: string) {
  return CATEGORY_COLORS[cat] || '#6b7280';
}

export default function Subscriptions() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const scope = params.get('scope') || 'perso';

  const [sortKey, setSortKey] = useState<SortKey>('amount');
  const data = MOCK_DATA;

  const backPath = scope === 'pro' ? '/analyse/pro' : '/analysis';

  const sorted = useMemo(() => {
    const arr = [...data.subscriptions];
    if (sortKey === 'amount') return arr.sort((a, b) => a.amount - b.amount);
    if (sortKey === 'category') return arr.sort((a, b) => a.category.localeCompare(b.category));
    if (sortKey === 'date') return arr.sort((a, b) => new Date(b.firstDate).getTime() - new Date(a.firstDate).getTime());
    return arr;
  }, [data.subscriptions, sortKey]);

  const breakdown = useMemo(() => getCategoryBreakdown(data.subscriptions), [data.subscriptions]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2 h-10">
        <div className="flex items-center gap-1 min-w-0">
          <button onClick={() => navigate(backPath)} className="md:hidden p-1">
            <ArrowLeft size={18} />
          </button>
          <h1 className="text-xl font-semibold whitespace-nowrap">{t('subscription_scanner', "Scanner d'abonnements")}</h1>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 text-sm bg-surface px-2 py-1 rounded-lg border border-border cursor-pointer">
          <span>{scope === 'pro' ? 'Pro' : 'Personnel'}</span>
          <ChevronDown size={14} className="text-muted" />
        </div>
      </div>

      <div className="space-y-4">
        {/* Summary Card */}
        <div className="bg-surface border border-border rounded-xl p-4">
          <p className="text-muted text-xs uppercase tracking-wide mb-1">Total abonnements</p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-foreground font-semibold text-lg">{data.count} {t('detected', 'detectes')}</span>
            <span className="text-muted">•</span>
            <span className="font-medium text-red-400">{formatAmount(Math.abs(data.totalMonthly))} €/{t('monthly_short', 'mois')}</span>
            <span className="text-muted">•</span>
            <span className="text-muted">{formatAmount(Math.abs(data.totalYearly))} €/{t('yearly_short', 'an')}</span>
          </div>
        </div>

        {/* Category Breakdown Bar */}
        <div className="bg-surface border border-border rounded-xl p-4">
          <p className="text-muted text-xs uppercase tracking-wide mb-3">Repartition par categorie</p>
          <div className="flex rounded-full overflow-hidden h-4 mb-3">
            {breakdown.map(({ cat, pct }) => (
              <div
                key={cat}
                style={{ width: `${pct}%`, backgroundColor: getCatColor(cat) }}
                title={`${cat}: ${pct.toFixed(0)}%`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {breakdown.map(({ cat, pct }) => (
              <div key={cat} className="flex items-center gap-1 text-xs">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getCatColor(cat) }} />
                <span className="text-muted capitalize">{cat}</span>
                <span className="text-foreground font-medium">{pct.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Sort + List */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="font-semibold text-sm">{t('detected_subscriptions', 'Abonnements detectes')}</p>
            <div className="flex items-center gap-1">
              {(['amount', 'category', 'date'] as SortKey[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setSortKey(k)}
                  className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                    sortKey === k
                      ? 'border-blue-500 text-blue-400 bg-blue-500/10'
                      : 'border-border text-muted hover:text-foreground'
                  }`}
                >
                  {k === 'amount' ? t('sort_amount', 'Montant') : k === 'category' ? t('sort_category', 'Categorie') : t('sort_date', 'Date')}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-surface border border-border rounded-xl overflow-hidden divide-y divide-border">
            {sorted.map((sub, idx) => (
              <div key={idx} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-lg flex-shrink-0">{sub.icon}</span>
                    <div className="w-2 h-2 rounded-full flex-shrink-0 mt-0.5" style={{ backgroundColor: getCatColor(sub.category) }} />
                    <span className="font-semibold text-sm truncate">{sub.merchant}</span>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="font-bold text-sm text-red-400">{formatAmount(sub.amount)} €</span>
                    <span className="text-muted text-xs">/{sub.frequency === 'monthly' ? t('monthly_short', 'mois') : t('yearly_short', 'an')}</span>
                  </div>
                </div>
                <div className="mt-1 ml-9 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                  <span className="capitalize">{sub.category}</span>
                  <span>•</span>
                  <span>{sub.frequency === 'monthly' ? t('monthly', 'mensuel') : t('yearly', 'annuel')}</span>
                  <span>•</span>
                  <span>{t('since', 'depuis')} {formatSince(sub.firstDate)}</span>
                </div>
                <div className="mt-1 ml-9 flex flex-wrap justify-between gap-x-4 text-xs text-muted">
                  <span>{t('next_expected', 'Prochain')}: ~{addOneMonth(sub.lastDate)}</span>
                  <span>{t('yearly_total', 'Total')}: {formatAmount(sub.totalYearly)} €/{t('yearly_short', 'an')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
