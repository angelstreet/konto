import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FileBarChart, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Receipt, Building2 } from 'lucide-react';

const API = '/kompta/api';

interface BilanData {
  year: number;
  compte_de_resultat: {
    chiffre_affaires: number;
    charges: { total: number; details: Array<{ category: string; total: number; count: number }> };
    resultat_net: number;
  };
  tva: { collectee: number; deductible: number; nette: number; from_invoices: any };
  bilan: {
    actif: { items: Array<{ name: string; type: string; balance: number }>; total: number };
    passif: { items: Array<{ name: string; type: string; balance: number }>; total: number };
    capitaux_propres: number;
  };
  monthly_breakdown: Array<{ month: number; income: number; expenses: number }>;
  justificatifs: { total: number; matched: number; match_rate: number | null };
}

const MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

export default function Bilan() {
  const { t: _t } = useTranslation();
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<BilanData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/bilan/${year}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [year]);

  const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);

  if (loading) return <div className="text-center text-muted py-12">Chargement...</div>;
  if (!data) return <div className="text-center text-muted py-12">Erreur de chargement</div>;

  const cr = data.compte_de_resultat;
  const isProfit = cr.resultat_net >= 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <FileBarChart size={22} /> Bilan Annuel
        </h1>
        <div className="flex items-center gap-3">
          <button onClick={() => setYear(y => y - 1)} className="p-1.5 rounded-lg hover:bg-surface-hover">
            <ChevronLeft size={18} />
          </button>
          <span className="text-lg font-bold tabular-nums">{year}</span>
          <button onClick={() => setYear(y => y + 1)} className="p-1.5 rounded-lg hover:bg-surface-hover">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Résultat net hero */}
      <div className={`rounded-xl p-6 text-center border ${isProfit ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
        <div className="text-sm text-muted mb-1">Résultat Net</div>
        <div className={`text-3xl font-bold ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
          {fmt(cr.resultat_net)}
        </div>
        <div className="flex justify-center gap-6 mt-3 text-sm">
          <span className="text-green-400 flex items-center gap-1"><TrendingUp size={14} /> CA: {fmt(cr.chiffre_affaires)}</span>
          <span className="text-red-400 flex items-center gap-1"><TrendingDown size={14} /> Charges: {fmt(cr.charges.total)}</span>
        </div>
      </div>

      {/* TVA */}
      <div className="bg-surface rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2"><Receipt size={16} /> TVA</h2>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-xs text-muted">Collectée</div>
            <div className="text-sm font-medium">{fmt(data.tva.collectee)}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Déductible</div>
            <div className="text-sm font-medium">{fmt(data.tva.deductible)}</div>
          </div>
          <div>
            <div className="text-xs text-muted">À payer</div>
            <div className={`text-sm font-bold ${data.tva.nette > 0 ? 'text-red-400' : 'text-green-400'}`}>
              {fmt(data.tva.nette)}
            </div>
          </div>
        </div>
        {data.tva.from_invoices && (
          <div className="mt-2 text-xs text-muted text-center">
            📄 TVA depuis factures: {fmt(data.tva.from_invoices.tva)} (sur {fmt(data.tva.from_invoices.ht)} HT)
          </div>
        )}
      </div>

      {/* Charges breakdown */}
      <div className="bg-surface rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold mb-3">Charges par catégorie</h2>
        {cr.charges.details.length === 0 ? (
          <p className="text-xs text-muted">Aucune charge enregistrée</p>
        ) : (
          <div className="space-y-2">
            {cr.charges.details.map((ch, i) => {
              const pct = cr.charges.total > 0 ? (ch.total / cr.charges.total) * 100 : 0;
              return (
                <div key={i}>
                  <div className="flex justify-between text-xs mb-0.5">
                    <span>{ch.category}</span>
                    <span className="text-muted">{fmt(ch.total)} ({ch.count})</span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-accent-500/60 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Monthly chart (simple bar representation) */}
      <div className="bg-surface rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold mb-3">Évolution mensuelle</h2>
        <div className="grid grid-cols-12 gap-1 items-end" style={{ height: 120 }}>
          {data.monthly_breakdown.map((m, i) => {
            const maxVal = Math.max(...data.monthly_breakdown.map(x => Math.max(x.income, x.expenses)), 1);
            const incH = (m.income / maxVal) * 100;
            const expH = (m.expenses / maxVal) * 100;
            return (
              <div key={i} className="flex flex-col items-center gap-0.5 h-full justify-end">
                <div className="flex gap-px items-end flex-1 w-full">
                  <div className="flex-1 bg-green-500/40 rounded-t" style={{ height: `${incH}%`, minHeight: m.income > 0 ? 2 : 0 }} />
                  <div className="flex-1 bg-red-500/40 rounded-t" style={{ height: `${expH}%`, minHeight: m.expenses > 0 ? 2 : 0 }} />
                </div>
                <span className="text-[9px] text-muted">{MONTHS[i]}</span>
              </div>
            );
          })}
        </div>
        <div className="flex justify-center gap-4 mt-2 text-[10px] text-muted">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-green-500/40" /> Revenus</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-red-500/40" /> Dépenses</span>
        </div>
      </div>

      {/* Bilan simplifié */}
      <div className="bg-surface rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2"><Building2 size={16} /> Bilan simplifié</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-muted mb-2 font-medium">ACTIF</div>
            {data.bilan.actif.items.length === 0 ? (
              <p className="text-xs text-muted">—</p>
            ) : (
              data.bilan.actif.items.map((a, i) => (
                <div key={i} className="flex justify-between text-xs py-0.5">
                  <span className="truncate">{a.name}</span>
                  <span className="ml-2 tabular-nums">{fmt(a.balance)}</span>
                </div>
              ))
            )}
            <div className="border-t border-border mt-2 pt-1 flex justify-between text-xs font-bold">
              <span>Total</span><span>{fmt(data.bilan.actif.total)}</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted mb-2 font-medium">PASSIF</div>
            {data.bilan.passif.items.length === 0 ? (
              <p className="text-xs text-muted">—</p>
            ) : (
              data.bilan.passif.items.map((p, i) => (
                <div key={i} className="flex justify-between text-xs py-0.5">
                  <span className="truncate">{p.name}</span>
                  <span className="ml-2 tabular-nums">{fmt(p.balance)}</span>
                </div>
              ))
            )}
            <div className="border-t border-border mt-2 pt-1 flex justify-between text-xs font-bold">
              <span>Total</span><span>{fmt(data.bilan.passif.total)}</span>
            </div>
          </div>
        </div>
        <div className="mt-3 text-center text-sm font-semibold">
          Capitaux propres: <span className={data.bilan.capitaux_propres >= 0 ? 'text-green-400' : 'text-red-400'}>
            {fmt(data.bilan.capitaux_propres)}
          </span>
        </div>
      </div>

      {/* Justificatifs status */}
      {data.justificatifs.total > 0 && (
        <div className="bg-surface rounded-xl border border-border p-4">
          <h2 className="text-sm font-semibold mb-2">📎 Justificatifs</h2>
          <div className="text-xs text-muted">
            {data.justificatifs.matched}/{data.justificatifs.total} rapprochés
            {data.justificatifs.match_rate != null && ` (${data.justificatifs.match_rate}%)`}
          </div>
          <div className="h-2 bg-white/5 rounded-full mt-2 overflow-hidden">
            <div
              className="h-full bg-green-500/60 rounded-full"
              style={{ width: `${data.justificatifs.match_rate || 0}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
