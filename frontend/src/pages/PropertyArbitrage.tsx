import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Home, TrendingDown, TrendingUp, AlertTriangle } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { API } from '../config';
import { useAuthFetch } from '../useApi';
import { useAmountVisibility } from '../AmountVisibilityContext';
import EyeToggle from '../components/EyeToggle';
import { usePreferences } from '../PreferencesContext';
import {
  simulate, yearsHeld, payoffMonths,
  type ArbitrageProperty, type ArbitrageInputs,
} from '../lib/propertyArbitrage';

interface AssetRow { id: number; name: string; type: string; current_value: number | null; estimated_value: number | null }

interface ArbitrageData {
  property: {
    id: number; name: string; usage: string; property_type: string | null; surface: number | null;
    value: number; value_source: string; estimated_value: number | null;
    purchase_price: number; notary_fees: number; works: number;
    purchase_date: string | null; is_primary_residence: boolean;
  };
  loan: { account_id: number; name: string; balance: number; rate: number; payment: number; insurance: number; incomplete: boolean } | null;
  defaults: { annual_rent: number; annual_cost: number; selling_costs: number };
  recorded: { annual_charges: number; annual_revenues: number };
  warnings: string[];
}

const WARNING_TEXT: Record<string, string> = {
  no_loan_linked: "Aucun prêt n'est rattaché à ce bien : il est traité comme détenu sans dette. Rattachez-le depuis la fiche de l'actif.",
  loan_details_missing: "Le prêt rattaché n'a ni capital restant ni mensualité exploitables — complétez-le dans Prêts pour que la projection soit juste.",
  no_rent_recorded: "Aucun loyer n'est enregistré pour ce bien : garder ne rapporte mécaniquement rien et vendre gagnerait toujours.",
  no_charges_recorded: "Aucune charge enregistrée : le coût annuel est à saisir à la main ci-dessous.",
  value_far_from_estimate: "Votre valeur saisie et l'estimation DVF diffèrent de plus de 20 %, et le verdict en dépend directement.",
};

const pctLabel = (v: number) => `${v.toFixed(1).replace('.', ',')} %`;

function monthLabel(months: number) {
  if (months === 0) return 'maintenant';
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
}

export default function PropertyArbitrage() {
  const navigate = useNavigate();
  const authFetch = useAuthFetch();
  const [params, setParams] = useSearchParams();
  const { formatCurrencyRounded: fmt } = usePreferences();
  const { hideAmounts, toggleHideAmounts } = useAmountVisibility();

  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [data, setData] = useState<ArbitrageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedId = params.get('asset');

  // Knobs
  const [sellMonths, setSellMonths] = useState(0);
  const [rate, setRate] = useState(8);
  const [growth, setGrowth] = useState(1.5);
  const [horizonYears, setHorizonYears] = useState(15);
  const [annualCost, setAnnualCost] = useState(0);
  const [annualRent, setAnnualRent] = useState(0);
  const [sellingCosts, setSellingCosts] = useState(0);
  const [taxPlacement, setTaxPlacement] = useState(true);

  useEffect(() => {
    authFetch(`${API}/assets?type=real_estate`)
      .then(r => r.json())
      .then((rows: AssetRow[]) => {
        const list = Array.isArray(rows) ? rows : [];
        setAssets(list);
        if (!selectedId && list.length > 0) setParams({ asset: String(list[0].id) }, { replace: true });
        if (list.length === 0) setLoading(false);
      })
      .catch(() => { setError('Impossible de charger vos biens.'); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    authFetch(`${API}/properties/${selectedId}/arbitrage`)
      .then(async r => { const d = await r.json(); if (!r.ok || d.error) throw new Error(d.error || `API ${r.status}`); return d as ArbitrageData; })
      .then(d => {
        setData(d);
        setAnnualCost(d.defaults.annual_cost);
        setAnnualRent(d.defaults.annual_rent);
        setSellingCosts(d.defaults.selling_costs);
        setSellMonths(0);
        setError(null);
        setLoading(false);
      })
      .catch(e => { setData(null); setError(e.message); setLoading(false); });
  }, [selectedId]);

  const property: ArbitrageProperty | null = useMemo(() => data && ({
    value: data.property.value,
    purchasePrice: data.property.purchase_price,
    notaryFees: data.property.notary_fees,
    works: data.property.works,
    purchaseDate: data.property.purchase_date || new Date().toISOString(),
    isPrimaryResidence: data.property.is_primary_residence,
    loan: data.loan && !data.loan.incomplete
      ? { balance: data.loan.balance, rate: data.loan.rate, payment: data.loan.payment, insurance: data.loan.insurance }
      : null,
  }), [data]);

  const inputs: ArbitrageInputs = {
    sellMonths, rate, growth, horizonYears, annualCost, annualRent, sellingCosts, taxPlacement,
  };
  const result = useMemo(() => (property ? simulate(property, inputs) : null),
    [property, sellMonths, rate, growth, horizonYears, annualCost, annualRent, sellingCosts, taxPlacement]);

  const h = hideAmounts;
  const f = (v: number) => (h ? '•••' : fmt(v));
  const signed = (v: number) => (h ? '•••' : `${v >= 0 ? '+' : '−'}${fmt(Math.abs(v))}`);

  // Without rent or a running cost, "keep" earns nothing by construction and
  // selling always wins — say so instead of printing a verdict.
  const unusable = !!data && ((!data.property.is_primary_residence && annualRent === 0) || annualCost === 0);
  const sellWins = !!result && result.gap > 0;

  const chartData = useMemo(() => {
    if (!result) return [];
    return result.series.sell.map((v, i) => ({
      year: i === 0 ? 'auj.' : `+${i}a`,
      vendre: Math.round(v),
      garder: Math.round(result.series.keep[i]),
    }));
  }, [result]);

  const sellDatePresets: { label: string; months: number }[] = useMemo(() => {
    const held = data?.property.purchase_date ? yearsHeld(data.property.purchase_date) : 0;
    const exemptIn = Math.max(0, Math.round((22 - held) * 12));
    return [
      { label: 'Maintenant', months: 0 },
      { label: 'Dans 2 ans', months: 24 },
      { label: 'Dans 5 ans', months: 60 },
      { label: 'Dans 10 ans', months: 120 },
      ...(exemptIn > 0 && exemptIn <= horizonYears * 12 ? [{ label: 'Exonération PV', months: exemptIn }] : []),
    ];
  }, [data, horizonYears]);

  const payoff = useMemo(() => {
    if (!property?.loan) return null;
    const m = payoffMonths(property.loan);
    if (!Number.isFinite(m)) return null;
    const d = new Date();
    d.setMonth(d.getMonth() + m);
    return d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
  }, [property]);

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2 h-10">
        <div className="flex items-center gap-1 min-w-0">
          <button onClick={() => navigate('/more')} className="md:hidden text-muted hover:text-white transition-colors p-1 -ml-1 flex-shrink-0">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-semibold whitespace-nowrap">Vendre ou garder</h1>
        </div>
        <EyeToggle hidden={hideAmounts} onToggle={toggleHideAmounts} />
      </div>

      {/* Property picker */}
      {assets.length > 0 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
          {assets.map(a => (
            <button
              key={a.id}
              onClick={() => setParams({ asset: String(a.id) })}
              className={`flex-shrink-0 text-left rounded-xl border px-3 py-2 transition-colors ${
                String(a.id) === selectedId
                  ? 'border-accent-500 bg-accent-500/10'
                  : 'border-border bg-surface hover:bg-surface-hover'
              }`}
            >
              <span className="block text-sm font-semibold">{a.name}</span>
              <span className="block text-xs text-muted">{f(a.current_value || a.estimated_value || 0)}</span>
            </button>
          ))}
        </div>
      )}

      {loading && <div className="text-center text-muted py-12">Chargement…</div>}
      {!loading && error && <div className="text-center text-muted py-12">{error}</div>}
      {!loading && !error && assets.length === 0 && (
        <div className="bg-surface border border-border rounded-xl p-6 text-center">
          <Home className="w-6 h-6 text-muted mx-auto mb-2" />
          <p className="text-sm text-muted">Aucun bien immobilier dans votre patrimoine.</p>
          <button onClick={() => navigate('/assets')} className="mt-3 text-sm text-accent-400 hover:text-accent-300">
            Ajouter un bien
          </button>
        </div>
      )}

      {!loading && data && result && property && (
        <>
          {/* Réglages */}
          <div className="bg-surface border border-border rounded-xl p-4">
            <h2 className="text-xs font-medium text-muted uppercase tracking-wide mb-3">Réglages</h2>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div>
                <label className="block text-[10px] text-muted uppercase tracking-wide mb-1">Je vends</label>
                <div className="text-base font-semibold mb-1">{monthLabel(sellMonths)}</div>
                <input type="range" min={0} max={horizonYears * 12} step={1} value={Math.min(sellMonths, horizonYears * 12)}
                  onChange={e => setSellMonths(Number(e.target.value))} className="w-full h-1 cursor-pointer accent-[#d4a812]" />
                <p className="text-[10px] text-muted mt-1">
                  {sellMonths === 0 ? "aujourd'hui" : `dans ${(sellMonths / 12).toFixed(1).replace('.', ',')} ans`}
                </p>
              </div>

              <div>
                <label className="block text-[10px] text-muted uppercase tracking-wide mb-1">Placement</label>
                <div className="text-base font-semibold mb-1">{pctLabel(rate)}</div>
                <input type="range" min={0} max={12} step={0.25} value={rate}
                  onChange={e => setRate(Number(e.target.value))} className="w-full h-1 cursor-pointer accent-[#d4a812]" />
                <p className="text-[10px] text-muted mt-1">rendement annuel visé</p>
              </div>

              <div>
                <label className="block text-[10px] text-muted uppercase tracking-wide mb-1">Revalorisation</label>
                <div className="text-base font-semibold mb-1">{pctLabel(growth)}</div>
                <input type="range" min={-2} max={6} step={0.25} value={growth}
                  onChange={e => setGrowth(Number(e.target.value))} className="w-full h-1 cursor-pointer accent-[#d4a812]" />
                <p className="text-[10px] text-muted mt-1">du bien, par an</p>
              </div>

              <div>
                <label className="block text-[10px] text-muted uppercase tracking-wide mb-1">Horizon</label>
                <div className="text-base font-semibold mb-1">{horizonYears} ans</div>
                <input type="range" min={1} max={30} step={1} value={horizonYears}
                  onChange={e => setHorizonYears(Number(e.target.value))} className="w-full h-1 cursor-pointer accent-[#d4a812]" />
                <p className="text-[10px] text-muted mt-1">date de comparaison</p>
              </div>

              <div>
                <label className="block text-[10px] text-muted uppercase tracking-wide mb-1">Coût du bien / an</label>
                <input type="number" step={100} value={annualCost}
                  onChange={e => setAnnualCost(Number(e.target.value) || 0)}
                  className="w-full bg-background border border-border focus:border-accent-500 outline-none rounded-md px-2 py-1.5 text-base font-semibold" />
                <p className="text-[10px] text-muted mt-1 leading-snug">
                  tout compris : taxe foncière, copro, assurance, entretien, impôt sur les loyers.
                  {' '}Konto a trouvé <span className="text-accent-400">{f(data.recorded.annual_charges)}</span> de charges saisies.
                </p>
              </div>

              <div>
                <label className="block text-[10px] text-muted uppercase tracking-wide mb-1">Frais de vente</label>
                <input type="number" step={500} value={sellingCosts}
                  onChange={e => setSellingCosts(Number(e.target.value) || 0)}
                  className="w-full bg-background border border-border focus:border-accent-500 outline-none rounded-md px-2 py-1.5 text-base font-semibold" />
                <p className="text-[10px] text-muted mt-1 leading-snug">
                  agence, diagnostics, notaire.{' '}
                  <span className="text-accent-400">
                    {data.property.value > 0 ? pctLabel((sellingCosts / data.property.value) * 100) : '—'}
                  </span>{' '}du prix.
                </p>
              </div>
            </div>

            {/* Sell-date presets */}
            <div className="flex border border-border rounded-lg overflow-hidden mt-4">
              {sellDatePresets.map(p => (
                <button key={p.label} onClick={() => setSellMonths(p.months)}
                  className={`flex-1 px-2 py-1.5 text-xs transition-colors ${
                    sellMonths === p.months ? 'bg-accent-500/20 text-accent-300 font-semibold' : 'bg-background text-muted hover:text-white'
                  }`}>
                  {p.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-4 mt-3">
              <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
                <input type="checkbox" checked={taxPlacement} onChange={e => setTaxPlacement(e.target.checked)}
                  className="w-4 h-4 accent-[#d4a812]" />
                Fiscaliser le placement (PFU 30 %)
              </label>
              <label className="flex items-center gap-2 text-xs text-muted">
                Loyers / an
                <input type="number" step={100} value={annualRent} onChange={e => setAnnualRent(Number(e.target.value) || 0)}
                  className="w-28 bg-background border border-border focus:border-accent-500 outline-none rounded-md px-2 py-1 text-xs text-white" />
              </label>
            </div>
          </div>

          {/* Verdict */}
          {unusable ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-relaxed">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <p>
                  Données incomplètes sur <b>{data.property.name}</b> — sans loyers ni coût annuel, garder ne rapporte
                  mécaniquement rien et vendre gagnerait toujours. Renseignez les deux cases ci-dessus.
                </p>
              </div>
            </div>
          ) : (
            <div className={`rounded-xl border p-4 text-[15px] leading-relaxed ${
              sellWins ? 'border-green-500/30 bg-green-500/10' : 'border-blue-500/30 bg-blue-500/10'
            }`}>
              À {horizonYears} ans, avec un placement à {pctLabel(rate)} :{' '}
              <b className={sellWins ? 'text-green-400' : 'text-blue-400'}>
                {sellWins ? 'vendre' : 'garder'} rapporte {f(Math.abs(result.gap))} de plus
              </b>.
            </div>
          )}

          {/* Side by side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Vendre */}
            <div className="rounded-xl border border-green-500/30 bg-surface overflow-hidden">
              <div className="p-4 border-b border-border bg-gradient-to-br from-green-500/10 to-transparent">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-green-400 flex items-center gap-1.5">
                    <TrendingDown className="w-3.5 h-3.5" /> Vendre
                  </span>
                  {sellWins && !unusable && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">gagnant</span>
                  )}
                </div>
                <div className={`text-3xl font-bold mt-1.5 ${h ? 'amount-masked' : ''} ${sellWins ? 'text-green-400' : ''}`}>
                  {f(result.sell.total)}
                </div>
                <p className="text-[11px] text-muted mt-0.5">
                  vente {monthLabel(sellMonths)}, placé à {pctLabel(rate)} jusqu'à +{horizonYears} ans
                </p>
              </div>
              <div className="p-3 pt-2">
                {sellMonths > 0 && (
                  <>
                    <Group>D'ici la vente ({(sellMonths / 12).toFixed(1).replace('.', ',')} ans)</Group>
                    <Row label="Cash-flow du bien, replacé" sub="loyers − coût − mensualités" value={result.sell.cashBeforeSale} f={signed} h={h} />
                  </>
                )}
                <Group>Au moment de la vente</Group>
                <Row label="Prix de vente" sub={growth !== 0 ? `revalorisé ${pctLabel(growth)}/an` : undefined} value={result.sell.price} f={f} h={h} neutral />
                <Row label="Frais de vente" value={-result.sell.sellingCosts} f={signed} h={h} />
                <Row label="Remboursement du prêt" sub={data.loan?.name || 'aucun prêt lié'} value={-result.sell.loanRepaid} f={signed} h={h} />
                {result.sell.earlyRepaymentPenalty > 0 && (
                  <Row label="Pénalité de remboursement" sub="plafond légal 3 % / 3 mois" value={-result.sell.earlyRepaymentPenalty} f={signed} h={h} />
                )}
                <Row
                  label="Impôt sur la plus-value"
                  sub={result.sell.capitalGains.exemptReason
                    ? ({ primary_residence: 'résidence principale', no_gain: 'aucune plus-value', fully_abated: 'entièrement abattue' })[result.sell.capitalGains.exemptReason]
                    : `brute ${h ? '•••' : fmt(result.sell.capitalGains.gross)} · abattement ${(result.sell.capitalGains.abatementIR * 100).toFixed(0)} %`}
                  value={-result.sell.capitalGains.tax} f={signed} h={h}
                />
                <Row label="Produit net encaissé" value={result.sell.netProceeds} f={f} h={h} subtotal />
                <Group>Puis placé</Group>
                <Row label={`Gain à ${pctLabel(rate)}`} sub={taxPlacement ? 'net de PFU 30 %' : "brut d'impôt"} value={result.sell.placementGain} f={signed} h={h} />
                <Row label="Total" value={result.sell.total} f={f} h={h} total />
              </div>
            </div>

            {/* Garder */}
            <div className="rounded-xl border border-blue-500/30 bg-surface overflow-hidden">
              <div className="p-4 border-b border-border bg-gradient-to-br from-blue-500/10 to-transparent">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-blue-400 flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5" /> Garder
                  </span>
                  {!sellWins && !unusable && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">gagnant</span>
                  )}
                </div>
                <div className={`text-3xl font-bold mt-1.5 ${h ? 'amount-masked' : ''} ${!sellWins ? 'text-blue-400' : ''}`}>
                  {f(result.keep.total)}
                </div>
                <p className="text-[11px] text-muted mt-0.5">
                  conservé {horizonYears} ans, cash-flow replacé à {pctLabel(rate)}
                </p>
              </div>
              <div className="p-3 pt-2">
                <Group>Le bien à l'horizon</Group>
                <Row label="Valeur du bien" sub={growth !== 0 ? `revalorisé ${pctLabel(growth)}/an` : undefined} value={result.keep.value} f={f} h={h} neutral />
                <Row label="Capital restant dû" sub={result.keep.loanOutstanding <= 0 ? 'prêt soldé' : undefined} value={-result.keep.loanOutstanding} f={signed} h={h} />
                <Row label="Valeur nette" value={result.keep.equity} f={f} h={h} subtotal />
                <Group>Cash-flow sur {horizonYears} ans</Group>
                <Row label="Loyers" sub={`${h ? '•••' : fmt(annualRent)} / an`} value={result.keep.rent} f={signed} h={h} />
                <Row label="Coût du bien" sub={`${h ? '•••' : fmt(annualCost)} / an, tout compris`} value={-result.keep.cost} f={signed} h={h} />
                <Row label="Mensualités de prêt" sub={property.loan ? `dont ${h ? '•••' : fmt(result.keep.loanInterest)} d'intérêts` : 'aucun prêt'} value={-result.keep.loanPaid} f={signed} h={h} />
                <Row label={`Net, replacé à ${pctLabel(rate)}`} sub={taxPlacement ? 'net de PFU 30 %' : undefined} value={result.keep.cashFlow} f={signed} h={h} subtotal />
                <Row label="Total" value={result.keep.total} f={f} h={h} total />
              </div>
            </div>
          </div>

          {/* Repris de Konto */}
          <div className="bg-surface border border-border rounded-xl p-4">
            <h2 className="text-xs font-medium text-muted uppercase tracking-wide mb-3">Repris automatiquement de Konto</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-border border border-border rounded-lg overflow-hidden">
              <Fact k="Valeur du bien" v={f(data.property.value)} sub={data.property.estimated_value ? `estimation DVF ${f(data.property.estimated_value)}` : 'saisie'} />
              <Fact k="Capital restant dû" v={data.loan ? f(data.loan.balance) : '—'} sub={data.loan?.name || 'aucun prêt lié'} />
              <Fact k="Taux du prêt" v={data.loan ? pctLabel(data.loan.rate) : '—'} sub={data.loan ? `mensualité ${f(data.loan.payment)}` : ''} />
              <Fact k="Fin de prêt" v={payoff || '—'} sub={payoff ? 'recalculée' : ''} />
              <Fact k="Loyers / an" v={f(data.recorded.annual_revenues)} sub={data.property.usage === 'rented_short' ? 'courte durée' : data.property.usage === 'rented_long' ? 'longue durée' : 'résidence'} />
              <Fact
                k="Acquis le"
                v={data.property.purchase_date ? new Date(data.property.purchase_date).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }) : '—'}
                sub={data.property.purchase_date ? `détenu ${yearsHeld(data.property.purchase_date).toFixed(1).replace('.', ',')} ans` : ''}
              />
            </div>
            {data.warnings.map(w => (
              <div key={w} className="mt-2 text-[11px] leading-relaxed rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 px-3 py-2">
                {WARNING_TEXT[w] || w}
              </div>
            ))}
          </div>

          {/* Courbe */}
          <div className="bg-surface border border-border rounded-xl p-4">
            <h2 className="text-xs font-medium text-muted uppercase tracking-wide mb-2">Patrimoine net issu de ce bien</h2>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="year" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis hide={h} tick={{ fontSize: 9 }} width={52}
                    tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(v: any, n: any) => [h ? '•••' : fmt(v), n === 'vendre' ? 'Vendre & placer' : 'Garder']}
                    contentStyle={{ fontSize: 11, backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 6, color: '#e5e5e5' }}
                  />
                  {sellMonths > 0 && sellMonths <= horizonYears * 12 && (
                    <ReferenceLine x={`+${Math.round(sellMonths / 12)}a`} stroke="rgb(var(--accent-400))" strokeDasharray="4 3" />
                  )}
                  <Line type="monotone" dataKey="garder" stroke="#3b82f6" strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="vendre" stroke="#22c55e" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="flex gap-4 text-[11px] text-muted mt-1">
              <span><i className="inline-block w-2.5 h-0.5 align-middle mr-1.5 bg-green-500" />Vendre &amp; placer</span>
              <span><i className="inline-block w-2.5 h-0.5 align-middle mr-1.5 bg-blue-500" />Garder</span>
            </div>
          </div>

          {/* Et si je vendais plus tard */}
          <div className="bg-surface border border-border rounded-xl p-4">
            <h2 className="text-xs font-medium text-muted uppercase tracking-wide mb-3">Et si je vendais plus tard ?</h2>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted text-[10px] uppercase tracking-wide">
                  <th className="text-left font-medium py-1.5">Date de vente</th>
                  <th className="text-right font-medium py-1.5">Prix</th>
                  <th className="text-right font-medium py-1.5">Impôt plus-value</th>
                  <th className="text-right font-medium py-1.5">Produit net</th>
                  <th className="text-right font-medium py-1.5">Écart à l'horizon</th>
                </tr>
              </thead>
              <tbody>
                {sellDatePresets.map(p => {
                  const sim = simulate(property, { ...inputs, sellMonths: p.months });
                  return (
                    <tr key={p.label} className="border-t border-white/5">
                      <td className="py-1.5">{p.label}</td>
                      <td className="text-right">{f(sim.sell.price)}</td>
                      <td className={`text-right ${sim.sell.capitalGains.tax > 0 ? 'text-red-400' : 'text-muted'}`}>
                        {sim.sell.capitalGains.tax > 0 ? `−${h ? '•••' : fmt(sim.sell.capitalGains.tax)}` : '—'}
                      </td>
                      <td className="text-right">{f(sim.sell.netProceeds)}</td>
                      <td className={`text-right font-medium ${sim.gap >= 0 ? 'text-green-400' : 'text-blue-400'}`}>
                        {signed(sim.gap)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Hypothèses */}
          <div className="bg-surface border border-border rounded-xl p-4">
            <h2 className="text-xs font-medium text-muted uppercase tracking-wide mb-2">Ce que le calcul suppose</h2>
            <ul className="text-[11px] text-muted leading-relaxed space-y-1 list-disc pl-4">
              <li>Le <b>coût du bien</b> est une seule case, tout compris : taxe foncière, copropriété, assurance, entretien <i>et</i> impôt sur les loyers. Pré-remplie avec les charges saisies dans Konto, à ajuster.</li>
              <li>Les <b>frais de vente</b> sont un montant unique (agence, diagnostics) qui suit le prix si vous vendez plus tard.</li>
              <li>Le prêt est reprojeté depuis <b>capital restant + taux + mensualité</b>, pas depuis le nombre d'échéances payées, incohérent dans les données Powens.</li>
              <li>La <b>plus-value</b> applique 19 % + 17,2 %, les abattements par durée (exonération d'IR à 22 ans, de prélèvements sociaux à 30 ans) et la surtaxe au-delà de 50 000 €.</li>
              <li>Les deux colonnes sont mesurées <b>au même horizon</b> ; la période d'ici la vente est commune et n'avantage personne.</li>
              <li>Un cash-flow négatif est actualisé au taux du placement : c'est son coût d'opportunité.</li>
              <li>Hors IFI, hors travaux futurs, hors revalorisation des loyers.</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] text-muted uppercase tracking-wide mt-3 first:mt-0 mb-0.5">{children}</div>;
}

function Fact({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="bg-surface px-3 py-2">
      <div className="text-[10px] text-muted flex items-center gap-1 mb-0.5">
        {k}
        <span className="text-[9px] text-accent-400 border border-accent-500/35 rounded px-1">AUTO</span>
      </div>
      <div className="text-[15px] font-semibold">{v}</div>
      {sub && <div className="text-[10px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function Row({ label, sub, value, f, h, subtotal, total, neutral }: {
  label: string; sub?: string; value: number; f: (v: number) => string; h: boolean;
  subtotal?: boolean; total?: boolean; neutral?: boolean;
}) {
  const color = neutral ? '' : value > 0 ? 'text-green-500' : value < 0 ? 'text-red-500' : 'text-muted';
  const frame = total
    ? 'border-t-2 border-border mt-2 pt-2.5 text-base font-bold'
    : subtotal
      ? 'border-t border-border mt-1.5 pt-2 font-semibold'
      : '';
  return (
    <div className={`flex justify-between gap-3 py-1 text-[13px] ${frame}`}>
      <div className="min-w-0">
        <span className="text-[#bbb]">{label}</span>
        {sub && <span className="block text-[10px] text-muted leading-tight">{sub}</span>}
      </div>
      <span className={`whitespace-nowrap tabular-nums font-medium ${color} ${h ? 'amount-masked' : ''}`}>{f(value)}</span>
    </div>
  );
}
