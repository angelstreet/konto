import { useLocation } from 'react-router-dom';
import AnalysisCard from '../components/AnalysisCard';

// Mock data — wire up to GET /api/analysis/summary?usage=personal|professional when backend is ready
const mockData = {
  personal: {
    budget: { metric: '2 340 €/mois', subtitle: 'Dépenses ce mois' },
    subscriptions: { metric: '12 abos · 187 €/mois', subtitle: 'Top: Spotify, Netflix, SFR' },
    cashflow: { metric: '+620 €', subtitle: 'Net du mois en cours' },
    bilan: { metric: '148 200 €', subtitle: 'Patrimoine net' },
    trends: { metric: '+4,2 %', subtitle: 'vs mois précédent' },
    ranking: { metric: '#847 · Tier B', subtitle: 'Top 23% des utilisateurs' },
    income: { metric: '340 €/mois', subtitle: 'Revenus passifs estimés' },
    simulators: { metric: '+89 400 €', subtitle: 'Projection à 10 ans' },
  },
  professional: {
    budget: { metric: '8 120 €/mois', subtitle: 'Charges professionnelles' },
    subscriptions: { metric: '6 abos · 540 €/mois', subtitle: 'Top: AWS, Notion, Figma' },
    cashflow: { metric: '+3 200 €', subtitle: 'Trésorerie nette du mois' },
    bilan: { metric: '62 500 €', subtitle: 'Capitaux propres' },
    trends: { metric: '+11,8 %', subtitle: 'CA vs mois précédent' },
    ranking: { metric: '#124 · Tier A', subtitle: 'Top 8% des entreprises' },
    income: { metric: '1 200 €/mois', subtitle: 'Revenus récurrents' },
    simulators: { metric: '+215 000 €', subtitle: 'Projection à 10 ans' },
  },
};

// Mini chart components (placeholder visual)
function CategoryBars() {
  const bars = [
    { label: 'Logement', pct: 80 },
    { label: 'Alimentation', pct: 45 },
    { label: 'Transport', pct: 30 },
  ];
  return (
    <div className="space-y-1.5">
      {bars.map(b => (
        <div key={b.label} className="flex items-center gap-2">
          <span className="text-[10px] text-muted w-20 truncate">{b.label}</span>
          <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
            <div className="h-full bg-accent-500/70 rounded-full" style={{ width: `${b.pct}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function TopList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1">
      {items.map((item, idx) => (
        <li key={idx} className="text-[11px] text-muted flex items-center gap-1.5">
          <span className="text-accent-400">{idx + 1}.</span> {item}
        </li>
      ))}
    </ul>
  );
}

function CalendarHeatmap() {
  const cells = Array.from({ length: 21 }, (_) => ({
    opacity: Math.random() * 0.8 + 0.1,
  }));
  return (
    <div className="grid grid-cols-7 gap-0.5">
      {cells.map((c, i) => (
        <div
          key={i}
          className="h-3 w-full rounded-sm bg-accent-500"
          style={{ opacity: c.opacity }}
        />
      ))}
    </div>
  );
}

function Donut() {
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 36 36" className="w-12 h-12 -rotate-90">
        <circle cx="18" cy="18" r="14" fill="none" stroke="#333" strokeWidth="4" />
        <circle cx="18" cy="18" r="14" fill="none" stroke="#d4a812" strokeWidth="4" strokeDasharray="40 100" />
        <circle cx="18" cy="18" r="14" fill="none" stroke="#4a9eff" strokeWidth="4" strokeDasharray="35 100" strokeDashoffset="-40" />
        <circle cx="18" cy="18" r="14" fill="none" stroke="#5bca7e" strokeWidth="4" strokeDasharray="25 100" strokeDashoffset="-75" />
      </svg>
      <div className="space-y-1 text-[10px] text-muted">
        <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-accent-500 inline-block" />Cash</div>
        <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />Invest.</div>
        <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" />Immo</div>
      </div>
    </div>
  );
}

function Sparkline() {
  const pts = [10, 14, 12, 18, 16, 22, 20, 26, 24, 30].map((y, x) => `${x * 11},${30 - y}`).join(' ');
  return (
    <svg viewBox="0 0 99 32" className="w-full h-8">
      <polyline points={pts} fill="none" stroke="#d4a812" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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

function IncomeBars() {
  const sources = [
    { label: 'Dividendes', pct: 60 },
    { label: 'Immo', pct: 30 },
    { label: 'P2P', pct: 10 },
  ];
  return (
    <div className="space-y-1.5">
      {sources.map(s => (
        <div key={s.label} className="flex items-center gap-2">
          <span className="text-[10px] text-muted w-16 truncate">{s.label}</span>
          <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
            <div className="h-full bg-green-500/70 rounded-full" style={{ width: `${s.pct}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function GrowthCurve() {
  const pts = [5, 7, 10, 13, 18, 24, 30].map((y, x) => `${x * 16},${32 - y}`).join(' ');
  return (
    <svg viewBox="0 0 96 34" className="w-full h-8">
      <polyline points={pts} fill="none" stroke="#5bca7e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function AnalysisSynthesis() {
  const location = useLocation();
  const isProScope = location.pathname.includes('/pro');
  const scope = isProScope ? 'professional' : 'personal';
  const data = mockData[scope];
  const scopeLabel = isProScope ? 'Pro' : 'Perso';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2 h-10">
        <div className="flex items-center gap-1 min-w-0">
          <h1 className="text-xl font-semibold whitespace-nowrap">Synthèse {scopeLabel}</h1>
        </div>
      </div>

      {/* Grid 3-col desktop, 2-col tablet, 1-col mobile */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Row 1 */}
        <AnalysisCard icon="💰" title="Budget" metric={data.budget.metric} subtitle={data.budget.subtitle} to="/budget">
          <CategoryBars />
        </AnalysisCard>

        <AnalysisCard icon="🔄" title="Abonnements" metric={data.subscriptions.metric} subtitle={data.subscriptions.subtitle} to="/subscriptions">
          <TopList items={['Spotify · 9,99 €', 'Netflix · 17,99 €', 'SFR · 34,99 €']} />
        </AnalysisCard>

        <AnalysisCard icon="📅" title="Cashflow" metric={data.cashflow.metric} subtitle={data.cashflow.subtitle} to="/cashflow">
          <CalendarHeatmap />
        </AnalysisCard>

        {/* Row 2 */}
        <AnalysisCard icon="📊" title="Bilan" metric={data.bilan.metric} subtitle={data.bilan.subtitle} to="/bilan">
          <Donut />
        </AnalysisCard>

        <AnalysisCard icon="📈" title="Tendances" metric={data.trends.metric} subtitle={data.trends.subtitle} to="/trends">
          <Sparkline />
        </AnalysisCard>

        <AnalysisCard icon="🏆" title="Classement" metric={data.ranking.metric} subtitle={data.ranking.subtitle} to="/ranking">
          <PercentileBar value={77} />
        </AnalysisCard>

        {/* Row 3 */}
        <AnalysisCard icon="💶" title="Revenus passifs" metric={data.income.metric} subtitle={data.income.subtitle} to="/income">
          <IncomeBars />
        </AnalysisCard>

        <AnalysisCard icon="📈" title="Simulateur" metric={data.simulators.metric} subtitle={data.simulators.subtitle} to="/simulators">
          <GrowthCurve />
        </AnalysisCard>
      </div>
    </div>
  );
}
