import { API } from '../config';
import { useState } from 'react';
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Building2, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../useApi';
import { useAmountVisibility } from '../AmountVisibilityContext';
import EyeToggle from '../components/EyeToggle';

interface CompanySummary {
  company_id: number;
  name: string;
  ca: number;
  charges: number;
  resultat: number;
}

interface ProBilanData {
  year: number;
  companies: CompanySummary[];
  total: { ca: number; charges: number; resultat: number };
}

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
}

const MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

export default function BilanPro() {
  const navigate = useNavigate();
  const { hideAmounts, toggleHideAmounts } = useAmountVisibility();
  const mask = (v: string) => hideAmounts ? <span className="amount-masked">{v}</span> : v;
  const [year, setYear] = useState(new Date().getFullYear());
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);

  const fmt = (n: number) =>
    new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);

  const { data: proData, loading: proLoading } = useApi<ProBilanData>(`${API}/bilan-pro/${year}`);
  const { data: detailData, loading: detailLoading } = useApi<BilanData>(
    selectedCompanyId !== null ? `${API}/bilan/${year}?company_id=${selectedCompanyId}` : ''
  );

  const companies = proData?.companies || [];
  const selectedCompany = companies.find(c => c.company_id === selectedCompanyId);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2 h-10">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => navigate('/more')}
            className="md:hidden text-muted hover:text-white transition-colors p-1 -ml-1 flex-shrink-0"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-semibold whitespace-nowrap">Bilan Pro</h1>
          <EyeToggle hidden={hideAmounts} onToggle={toggleHideAmounts} size={16} />
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => { setYear(y => y - 1); setSelectedCompanyId(null); }}
            className="p-2.5 rounded-lg hover:bg-surface-hover min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-lg font-bold tabular-nums">{year}</span>
          <button
            onClick={() => { setYear(y => y + 1); setSelectedCompanyId(null); }}
            className="p-2.5 rounded-lg hover:bg-surface-hover min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Consolidated summary table */}
      {proLoading ? (
        <div className="text-center text-muted py-8">Chargement...</div>
      ) : companies.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-6 text-center text-muted text-sm">
          Aucune société avec des comptes liés
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-border p-3">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Building2 size={16} /> Vue consolidée {year}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="text-left pb-2 font-medium">Société</th>
                  <th className="text-right pb-2 font-medium">CA</th>
                  <th className="text-right pb-2 font-medium">Charges</th>
                  <th className="text-right pb-2 font-medium">Résultat</th>
                </tr>
              </thead>
              <tbody>
                {companies.map(c => (
                  <tr
                    key={c.company_id}
                    onClick={() => setSelectedCompanyId(c.company_id === selectedCompanyId ? null : c.company_id)}
                    className={`cursor-pointer border-t border-border/40 hover:bg-white/5 transition-colors ${selectedCompanyId === c.company_id ? 'bg-accent-500/5' : ''}`}
                  >
                    <td className="py-2 pr-2 font-medium">
                      {c.name}
                      {selectedCompanyId === c.company_id && (
                        <span className="ml-1.5 text-xs text-accent-400">▼</span>
                      )}
                    </td>
                    <td className="py-2 text-right text-green-400 tabular-nums">{mask(fmt(c.ca))}</td>
                    <td className="py-2 text-right text-red-400 tabular-nums">{mask(fmt(c.charges))}</td>
                    <td className={`py-2 text-right font-semibold tabular-nums ${c.resultat >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {mask(fmt(c.resultat))}
                    </td>
                  </tr>
                ))}
                {proData && (
                  <tr className="border-t-2 border-border font-bold">
                    <td className="pt-2.5 text-sm">Total</td>
                    <td className="pt-2.5 text-right text-green-400 tabular-nums">{mask(fmt(proData.total.ca))}</td>
                    <td className="pt-2.5 text-right text-red-400 tabular-nums">{mask(fmt(proData.total.charges))}</td>
                    <td className={`pt-2.5 text-right tabular-nums ${proData.total.resultat >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {mask(fmt(proData.total.resultat))}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-muted mt-2">Cliquez sur une ligne pour voir le détail</p>
        </div>
      )}

      {/* Company detail drill-down */}
      {selectedCompanyId !== null && (
        <>
          <div className="flex items-center gap-1.5 px-1 pt-1">
            <span className="text-sm text-muted">Détail —</span>
            <span className="text-sm font-semibold">{selectedCompany?.name}</span>
          </div>

          {detailLoading ? (
            <div className="text-center text-muted py-4">Chargement...</div>
          ) : detailData ? (
            <>
              {/* Résultat net hero */}
              {(() => {
                const cr = detailData.compte_de_resultat;
                const isProfit = cr.resultat_net >= 0;
                return (
                  <div className={`rounded-xl p-4 text-center border ${isProfit ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                    <div className="text-sm text-muted mb-1">Résultat Net</div>
                    <div className={`text-3xl font-bold ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                      {mask(fmt(cr.resultat_net))}
                    </div>
                    <div className="flex justify-center gap-3 mt-3 text-sm">
                      <span className="text-green-400 flex items-center gap-1">
                        <TrendingUp size={14} /> CA: {mask(fmt(cr.chiffre_affaires))}
                      </span>
                      <span className="text-red-400 flex items-center gap-1">
                        <TrendingDown size={14} /> Charges: {mask(fmt(cr.charges.total))}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Charges by category */}
              {detailData.compte_de_resultat.charges.details.length > 0 && (
                <div className="bg-surface rounded-xl border border-border p-3">
                  <h2 className="text-sm font-semibold mb-3">Charges par catégorie</h2>
                  <div className="space-y-2">
                    {detailData.compte_de_resultat.charges.details.map((ch, i) => {
                      const pct = detailData.compte_de_resultat.charges.total > 0
                        ? (ch.total / detailData.compte_de_resultat.charges.total) * 100
                        : 0;
                      return (
                        <div key={i}>
                          <div className="flex justify-between text-xs mb-0.5">
                            <span>{ch.category}</span>
                            <span className="text-muted">{mask(fmt(ch.total))} ({ch.count})</span>
                          </div>
                          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full bg-accent-500/60 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Monthly chart */}
              <div className="bg-surface rounded-xl border border-border p-3">
                <h2 className="text-sm font-semibold mb-3">Évolution mensuelle</h2>
                <div className="grid grid-cols-12 gap-1 items-end" style={{ height: 120 }}>
                  {detailData.monthly_breakdown.map((m, i) => {
                    const maxVal = Math.max(...detailData.monthly_breakdown.map(x => Math.max(x.income, x.expenses)), 1);
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

              {/* TVA */}
              <div className="bg-surface rounded-xl border border-border p-3">
                <h2 className="text-sm font-semibold mb-3">TVA</h2>
                <div className="grid grid-cols-3 gap-2.5 text-center">
                  <div>
                    <div className="text-xs text-muted">Collectée</div>
                    <div className="text-sm font-medium">{mask(fmt(detailData.tva.collectee))}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Déductible</div>
                    <div className="text-sm font-medium">{mask(fmt(detailData.tva.deductible))}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">À payer</div>
                    <div className={`text-sm font-bold ${detailData.tva.nette > 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {mask(fmt(detailData.tva.nette))}
                    </div>
                  </div>
                </div>
                {detailData.tva.from_invoices && (
                  <div className="mt-2 text-xs text-muted text-center">
                    📄 TVA depuis factures: {mask(fmt(detailData.tva.from_invoices.tva))} (sur {mask(fmt(detailData.tva.from_invoices.ht))} HT)
                  </div>
                )}
              </div>

              {/* Bilan simplifié */}
              <div className="bg-surface rounded-xl border border-border p-3">
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Building2 size={16} /> Bilan simplifié
                </h2>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <div className="text-xs text-muted mb-2 font-medium">ACTIF</div>
                    {detailData.bilan.actif.items.length === 0 ? (
                      <p className="text-xs text-muted">—</p>
                    ) : detailData.bilan.actif.items.map((a, i) => (
                      <div key={i} className="flex justify-between text-xs py-0.5">
                        <span className="truncate">{a.name}</span>
                        <span className="ml-2 tabular-nums">{mask(fmt(a.balance))}</span>
                      </div>
                    ))}
                    <div className="border-t border-border mt-2 pt-1 flex justify-between text-xs font-bold">
                      <span>Total</span><span>{mask(fmt(detailData.bilan.actif.total))}</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted mb-2 font-medium">PASSIF</div>
                    {detailData.bilan.passif.items.length === 0 ? (
                      <p className="text-xs text-muted">—</p>
                    ) : detailData.bilan.passif.items.map((p, i) => (
                      <div key={i} className="flex justify-between text-xs py-0.5">
                        <span className="truncate">{p.name}</span>
                        <span className="ml-2 tabular-nums">{mask(fmt(p.balance))}</span>
                      </div>
                    ))}
                    <div className="border-t border-border mt-2 pt-1 flex justify-between text-xs font-bold">
                      <span>Total</span><span>{mask(fmt(detailData.bilan.passif.total))}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-3 text-center text-sm font-semibold">
                  Capitaux propres:{' '}
                  <span className={detailData.bilan.capitaux_propres >= 0 ? 'text-green-400' : 'text-red-400'}>
                    {mask(fmt(detailData.bilan.capitaux_propres))}
                  </span>
                </div>
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
