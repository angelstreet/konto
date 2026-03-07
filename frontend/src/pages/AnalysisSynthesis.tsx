import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import AnalysisCard from '../components/AnalysisCard';
import EyeToggle from '../components/EyeToggle';
import { useAuthFetch } from '../useApi';
import { useAmountVisibility } from '../AmountVisibilityContext';
import { API } from '../config';

function getTier(pct: number): string {
  if (pct >= 90) return 'Tier S';
  if (pct >= 75) return 'Tier A';
  if (pct >= 50) return 'Tier B';
  if (pct >= 25) return 'Tier C';
  return 'Tier D';
}

const mockData = {
  personal: {
    budget: { metric: '2,340 €/mois', subtitle: 'Dépenses ce mois' },
    subscriptions: { metric: '12 abos · 187 €/mois', subtitle: 'Top: Spotify, Netflix, SFR' },
    cashflow: { metric: '+620 €', subtitle: 'Net du mois en cours' },
    bilan: { metric: '148,200 €', subtitle: 'Patrimoine net' },
    trends: { metric: '+4.2%', subtitle: 'vs mois précédent' },
    income: { metric: '340 €/mois', subtitle: 'Revenus passifs estimés' },
    simulators: { metric: '+89,400 €', subtitle: 'Projection à 10 ans' },
  },
  professional: {
    budget: { metric: '8,120 €/mois', subtitle: 'Charges professionnelles' },
    subscriptions: { metric: '6 abos · 540 €/mois', subtitle: 'Top: AWS, Notion, Figma' },
    cashflow: { metric: '+3,200 €', subtitle: 'Trésorerie nette du mois' },
    bilan: { metric: '62,500 €', subtitle: 'Capitaux propres' },
    trends: { metric: '+11.8%', subtitle: 'CA vs mois précédent' },
    income: { metric: '1,200 €/mois', subtitle: 'Revenus récurrents' },
    simulators: { metric: '+215,000 €', subtitle: 'Projection à 10 ans' },
  },
};

function PercentileBar({ value = 77 }: { value?: number }) {
  return (
    <div className="space-y-1">
      <div className="h-2 bg-border rounded-full overflow-hidden">
        <div className="h-full bg-accent-500 rounded-full" style={{ width: `${value}%` }} />
      </div>
      <p className="text-[10px] text-muted">Top {100 - value}%</p>
    </div>
  );
}

export default function AnalysisSynthesis() {
  const location = useLocation();
  const authFetch = useAuthFetch();
  const isProScope = location.pathname.includes('/pro');
  const scope = isProScope ? 'professional' : 'personal';
  const data = mockData[scope];
  const scopeLabel = isProScope ? 'Pro' : 'Perso';

  const { hideAmounts, toggleHideAmounts } = useAmountVisibility();

  const [rankingMetric, setRankingMetric] = useState<string>('—');
  const [rankingSubtitle, setRankingSubtitle] = useState<string>('Classement mondial');
  const [rankingPct, setRankingPct] = useState<number>(50);

  useEffect(() => {
    authFetch(`${API}/ranking?scope=world`)
      .then(r => r.json())
      .then((d: any) => {
        if (!d.available) return;
        const { net_worth = 0, income = 0, savings_rate = 0 } = d.percentiles;
        const avg = Math.round((net_worth + income + savings_rate) / 3);
        const top = 100 - avg;
        setRankingPct(avg);
        setRankingMetric(`${getTier(avg)} · Top ${top}%`);
        setRankingSubtitle(`Patrimoine · Revenus · Épargne`);
      })
      .catch(() => {});
  }, [authFetch]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2 h-10">
        <div className="flex items-center gap-1 min-w-0">
          <h1 className="text-xl font-semibold whitespace-nowrap">Synthèse {scopeLabel}</h1>
        </div>
        <EyeToggle hidden={hideAmounts} onToggle={toggleHideAmounts} />
      </div>

      {/* Grid 3-col desktop, 2-col tablet, 1-col mobile */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Row 1 */}
        <AnalysisCard icon="💰" title="Budget" metric={data.budget.metric} subtitle={data.budget.subtitle} to="/budget" hideAmount={hideAmounts} />
        <AnalysisCard icon="🔄" title="Abonnements" metric={data.subscriptions.metric} subtitle={data.subscriptions.subtitle} to="/subscriptions" hideAmount={hideAmounts} />
        <AnalysisCard icon="📅" title="Cashflow" metric={data.cashflow.metric} subtitle={data.cashflow.subtitle} to="/cashflow" hideAmount={hideAmounts} />

        {/* Row 2 */}
        <AnalysisCard icon="📊" title="Bilan" metric={data.bilan.metric} subtitle={data.bilan.subtitle} to="/bilan" hideAmount={hideAmounts} />
        <AnalysisCard icon="📈" title="Tendances" metric={data.trends.metric} subtitle={data.trends.subtitle} to="/trends" hideAmount={hideAmounts} />
        <AnalysisCard icon="🏆" title="Classement" metric={rankingMetric} subtitle={rankingSubtitle} to="/ranking" hideAmount={hideAmounts}>
          <PercentileBar value={rankingPct} />
        </AnalysisCard>

        {/* Row 3 */}
        <AnalysisCard icon="💶" title="Revenus passifs" metric={data.income.metric} subtitle={data.income.subtitle} to="/income" hideAmount={hideAmounts} />
        <AnalysisCard icon="📈" title="Simulateur" metric={data.simulators.metric} subtitle={data.simulators.subtitle} to="/simulators" hideAmount={hideAmounts} />
      </div>
    </div>
  );
}
