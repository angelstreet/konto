import { API } from '../config';
import { useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { ArrowLeft, GraduationCap, Upload, ChevronDown } from 'lucide-react';
import { useApi } from '../useApi';
import { usePreferences } from '../PreferencesContext';
import { useAmountVisibility } from '../AmountVisibilityContext';

type LoanDetailResponse = {
  loan: {
    loan_id: number;
    name: string;
    type_label: string;
    remaining: number;
    monthly_payment: number | null;
    interest_rate: number | null;
    repaid_pct: number | null;
    installments_paid: number | null;
    installments_left: number | null;
    start_date: string | null;
    end_date: string | null;
    duration_months: number | null;
  };
  monthly_breakdown: {
    capital: number | null;
    interest: number | null;
    insurance: number;
  };
  totals: {
    loan_cost: number;
    capital_total: number;
    interest_insurance_total: number;
    interest_total: number;
    insurance_total: number;
    fees_total: number;
    repaid_total: number;
    repaid_capital: number;
    repaid_interest: number;
    repaid_insurance: number;
    remaining_total: number;
    remaining_to_repay: number;
    remaining_pct: number;
  };
  timeline: { year: number; remaining: number }[];
  linked_assets: {
    asset_id: number;
    name: string;
    usage: string | null;
    allocation_pct: number;
    allocation_amount: number;
    purchase_price: number | null;
    current_value: number | null;
    notary_fees: number | null;
    travaux: number | null;
    estimated_value: number | null;
    estimated_price_m2: number | null;
    address: string | null;
    surface: number | null;
    property_type: string | null;
    purchase_date: string | null;
    monthly_rent: number | null;
    pnl: number | null;
    pnl_percent: number | null;
    costs: { id: number; label: string; amount: number; frequency: string }[];
    revenues: { id: number; label: string; amount: number; frequency: string }[];
    monthly_costs: number;
    monthly_revenues: number;
  }[];
};

const LEARN_ITEMS = [
  'Réévaluez votre assurance emprunteur tous les 12-18 mois.',
  'Un remboursement partiel anticipé réduit fortement le coût total en début de prêt.',
  'Suivez votre taux d’endettement après chaque nouveau crédit.',
];

export default function LoanDetail() {
  const { loanId } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { formatCurrency } = usePreferences();
  const { hideAmounts } = useAmountVisibility();
  const [tab, setTab] = useState<'summary' | 'monthly' | 'learn' | 'assets'>('summary');
  const [expandedAssetId, setExpandedAssetId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, loading, refetch } = useApi<LoanDetailResponse>(`${API}/loans/${loanId}`);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API}/loans/${loanId}/enrich`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: formData,
      });
      if (res.ok) {
        refetch();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  const fc = (amount: number | null | undefined) => {
    const value = amount || 0;
    return hideAmounts ? <span className="amount-masked">{formatCurrency(value)}</span> : formatCurrency(value);
  };


  if (loading && !data) return <div className="text-center text-muted py-10">Loading...</div>;
  if (!data) return <div className="text-center text-muted py-10">{t('loan_not_found') || 'Prêt introuvable'}</div>;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/loans')} className="p-2 rounded-lg hover:bg-surface"><ArrowLeft size={16} /></button>
          <h1 className="text-xl font-semibold truncate">{data.loan.name}</h1>
        </div>
        <div>
          <input type="file" ref={fileRef} onChange={handleFileUpload} accept=".pdf" className="hidden" />
          <button 
            onClick={() => fileRef.current?.click()} 
            disabled={uploading}
            className="px-3 py-1.5 text-sm bg-surface border border-border rounded-lg hover:bg-surface-2 flex items-center gap-2"
          >
            <Upload size={14} />
            {uploading ? '...' : 'Import PDF'}
          </button>
        </div>
      </div>

      <div className="text-sm font-semibold mb-2">{t('loan_tabs_summary') || 'Synthèse'}</div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="text-xs text-muted uppercase">{t('loan_remaining_principal') || 'Restant dû'}</div>
          <div className="text-3xl mt-2 text-accent-400 font-semibold">{fc(data.loan.remaining)}</div>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="text-xs text-muted uppercase">{t('loan_monthly') || 'Mensualité'}</div>
          <div className="text-3xl mt-2">{data.loan.monthly_payment != null ? fc(data.loan.monthly_payment) : '-'}</div>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="text-xs text-muted uppercase">Taux</div>
          <div className="text-3xl mt-2">{data.loan.interest_rate}%</div>
        </div>
      </div>

      <div className="md:hidden mb-3 flex rounded-lg border border-border overflow-hidden text-sm">
        <button className={`flex-1 py-2 ${tab === 'summary' ? 'bg-surface text-white' : 'text-muted'}`} onClick={() => setTab('summary')}>{t('loan_tabs_summary') || 'Synthèse'}</button>
        <button className={`flex-1 py-2 ${tab === 'monthly' ? 'bg-surface text-white' : 'text-muted'}`} onClick={() => setTab('monthly')}>{t('loan_tabs_monthly') || 'Mensualité'}</button>
        <button className={`flex-1 py-2 ${tab === 'learn' ? 'bg-surface text-white' : 'text-muted'}`} onClick={() => setTab('learn')}>{t('loan_tabs_learn') || 'Apprendre'}</button>
        <button className={`flex-1 py-2 ${tab === 'assets' ? 'bg-surface text-white' : 'text-muted'}`} onClick={() => setTab('assets')}>{t('loan_tabs_linked_assets') || 'Actifs liés'}</button>
      </div>

      {(tab === 'summary' || tab === 'monthly' || window.innerWidth >= 768) && (
        <div className="grid grid-cols-1 xl:grid-cols-7 gap-3 mb-3">
          <div className="xl:col-span-3 bg-surface rounded-xl border border-border p-3">
            <div className="text-sm text-muted mb-2">{t('loan_remaining_timeline') || 'Évolution du capital restant dû'}</div>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.timeline}>
                  <XAxis dataKey="year" tick={{ fill: '#8d9099', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#8d9099', fontSize: 11 }} width={80} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(value: any) => formatCurrency(Number(value || 0))} />
                  <Area type="monotone" dataKey="remaining" stroke="#c7a26b" fillOpacity={1} fill="url(#loanDetailArea)" />
                  <defs>
                    <linearGradient id="loanDetailArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6f5530" stopOpacity={0.7} />
                      <stop offset="95%" stopColor="#1b1a17" stopOpacity={0.2} />
                    </linearGradient>
                  </defs>
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="xl:col-span-2 bg-surface rounded-xl border border-border p-4">
            <div className="text-xs text-muted uppercase">{t('loan_monthly') || 'Mensualité'}</div>
            <div className="text-3xl mt-1">{data.loan.monthly_payment != null ? fc(data.loan.monthly_payment) : (t('loan_no_data') || 'Pas de données')}</div>
            <div className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted">{t('loan_capital') || 'Capital'}</span><span>{fc(data.monthly_breakdown.capital)}</span></div>
              <div className="flex justify-between"><span className="text-muted">{t('loan_interest') || 'Intérêts'}</span><span>{fc(data.monthly_breakdown.interest)}</span></div>
              <div className="flex justify-between"><span className="text-muted">{t('loan_insurance') || 'Assurance'}</span><span>{fc(data.monthly_breakdown.insurance)}</span></div>
              <div className="flex justify-between pt-2 border-t border-border"><span className="text-muted">{t('loan_installments_paid') || 'Échéances payées'}</span><span>{data.loan.installments_paid ?? '-'}</span></div>
              <div className="flex justify-between"><span className="text-muted">{t('loan_installments_left') || 'Échéances restantes'}</span><span>{data.loan.installments_left ?? '-'}</span></div>
              <div className="flex justify-between"><span className="text-muted">{t('loan_end_date') || 'Date de fin'}</span><span>{data.loan.end_date || '-'}</span></div>
            </div>
          </div>

          <div className="xl:col-span-2 bg-surface rounded-xl border border-border p-4">
            <div className="text-xs text-muted uppercase">Total</div>
            <div className="text-3xl mt-1">{fc(data.totals.loan_cost)}</div>
            <div className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted">{t('loan_capital') || 'Capital'}</span><span>{fc(data.totals.capital_total)}</span></div>
              <div className="flex justify-between"><span className="text-muted">{t('loan_interest') || 'Intérêts'}</span><span>{fc(data.totals.interest_total ?? data.totals.interest_insurance_total)}</span></div>
              <div className="flex justify-between"><span className="text-muted">{t('loan_insurance') || 'Assurance'}</span><span>{fc(data.totals.insurance_total ?? 0)}</span></div>
              <div className="flex justify-between pt-2 border-t border-border"><span className="text-muted">{t('loan_total_repaid') || 'Total remboursé'}</span><span>{fc(data.totals.repaid_total)}</span></div>
              <div className="flex justify-between"><span className="text-muted">{t('loan_remaining_total') || 'Reste à rembourser'}</span><span>{fc(data.totals.remaining_to_repay)}</span></div>
              <div className="flex justify-between"><span className="text-muted">Reste %</span><span>{Math.round(data.totals.remaining_pct)} %</span></div>
              {data.loan.duration_months && <div className="flex justify-between pt-2 border-t border-border"><span className="text-muted">Durée</span><span>{Math.round(data.loan.duration_months / 12)} ans ({data.loan.duration_months} mois)</span></div>}
              {data.loan.start_date && <div className={`flex justify-between${data.loan.duration_months ? '' : ' pt-2 border-t border-border'}`}><span className="text-muted">Date de début</span><span>{data.loan.start_date}</span></div>}
              {data.loan.end_date && <div className="flex justify-between"><span className="text-muted">{t('loan_end_date') || 'Date de fin'}</span><span>{data.loan.end_date}</span></div>}
            </div>
          </div>
        </div>
      )}


      {(tab === 'monthly' || window.innerWidth >= 768) && (
        <div className="md:hidden bg-surface rounded-xl border border-border p-4 mb-3">
          <div className="text-xs text-muted uppercase mb-2">{t('loan_monthly') || 'Mensualité'}</div>
          <div className="text-sm text-muted">{t('loan_capital') || 'Capital'}: {fc(data.monthly_breakdown.capital)}</div>
          <div className="text-sm text-muted">{t('loan_interest') || 'Intérêts'}: {fc(data.monthly_breakdown.interest)}</div>
          <div className="text-sm text-muted mb-2">{t('loan_insurance') || 'Assurance'}: {fc(data.monthly_breakdown.insurance)}</div>
          <div className="text-sm text-muted">{t('loan_installments_paid') || 'Échéances payées'}: {data.loan.installments_paid ?? '-'}</div>
          <div className="text-sm text-muted">{t('loan_installments_left') || 'Échéances restantes'}: {data.loan.installments_left ?? '-'}</div>
          <div className="text-sm text-muted">{t('loan_end_date') || 'Date de fin'}: {data.loan.end_date || '-'}</div>
        </div>
      )}

      {(tab === 'learn' || window.innerWidth >= 768) && (
        <div className={`${window.innerWidth >= 768 ? 'mb-3' : ''}`}>
          {tab === 'learn' && (
            <div className="space-y-2 mb-3">
              {LEARN_ITEMS.map((item) => (
                <div key={item} className="bg-surface rounded-xl border border-border p-3">
                  <div className="flex items-center gap-2 text-accent-300 mb-1"><GraduationCap size={14} /> <span className="font-medium">{t('loan_tip') || 'Conseil'}</span></div>
                  <div className="text-sm text-muted">{item}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {(tab === 'assets' || window.innerWidth >= 768) && (
        <>
          <div className="text-sm font-semibold mb-2">{t('loan_tabs_linked_assets') || 'Actifs liés'}</div>
          <div className="space-y-2">
            {data.linked_assets.length === 0 && (
              <div className="bg-surface rounded-xl border border-border p-4 text-muted text-sm">{t('loan_no_linked_assets') || 'Aucun actif lié'}</div>
            )}
            {data.linked_assets.map((asset) => {
              const expanded = expandedAssetId === asset.asset_id;
              const usageLabel = asset.usage === 'principal' ? '🏠 Résidence principale' : asset.usage === 'rented_long' ? '🔑 Location longue durée' : asset.usage === 'rented_short' ? '🏖️ Location saisonnière' : asset.usage === 'vacant' ? '📦 Vacant' : asset.usage || null;
              const netCashflow = asset.monthly_revenues - asset.monthly_costs;
              return (
                <div key={asset.asset_id} className="bg-surface rounded-xl border border-border overflow-hidden">
                  <div className="px-4 py-3 cursor-pointer hover:bg-surface-hover transition-colors" onClick={() => setExpandedAssetId(expanded ? null : asset.asset_id)}>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white truncate min-w-0">{asset.name}</p>
                      <span className="text-sm font-semibold text-accent-400 flex-shrink-0">{fc(asset.allocation_amount)}</span>
                      {asset.pnl != null && (
                        <span className={`hidden md:inline text-xs font-medium flex-shrink-0 ${asset.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {asset.pnl_percent != null ? `${asset.pnl >= 0 ? '+' : ''}${asset.pnl_percent.toFixed(1)}%` : ''}
                        </span>
                      )}
                      <span className="flex-1" />
                      {usageLabel && <span className="hidden md:inline text-xs text-muted">{usageLabel}</span>}
                      <ChevronDown size={14} className={`text-muted flex-shrink-0 transition-transform ${expanded ? '' : '-rotate-90'}`} />
                    </div>
                    {netCashflow !== 0 && (
                      <div className="mt-1 text-xs">
                        <span className={netCashflow >= 0 ? 'text-green-400' : 'text-red-400'}>{netCashflow >= 0 ? '+' : ''}{fc(netCashflow)}/mois</span>
                      </div>
                    )}
                  </div>
                  {expanded && (
                    <div className="px-4 pb-4 border-t border-border/50 pt-3">
                      {asset.purchase_date && <p className="text-xs text-muted mb-2">{t('purchased') || 'Acquis le'} {asset.purchase_date}</p>}
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        {asset.purchase_price != null && (
                          <div><p className="text-[10px] text-muted uppercase">{t('purchase_price') || "Prix d'achat"}</p><p>{fc(asset.purchase_price)}</p></div>
                        )}
                        {asset.notary_fees != null && asset.notary_fees > 0 && (
                          <div><p className="text-[10px] text-muted uppercase">{t('notary_fees') || 'Frais de notaire'}</p><p>{fc(asset.notary_fees)}</p></div>
                        )}
                        {asset.travaux != null && asset.travaux > 0 && (
                          <div><p className="text-[10px] text-muted uppercase">Travaux</p><p>{fc(asset.travaux)}</p></div>
                        )}
                        {asset.purchase_price != null && ((asset.notary_fees && asset.notary_fees > 0) || (asset.travaux && asset.travaux > 0)) && (
                          <div><p className="text-[10px] text-muted uppercase">Investissement total</p><p className="font-semibold">{fc(asset.purchase_price + (asset.notary_fees || 0) + (asset.travaux || 0))}</p></div>
                        )}
                        {asset.current_value != null && (
                          <div><p className="text-[10px] text-muted uppercase">{t('current_value') || 'Valeur actuelle'}</p><p className="text-accent-400 font-semibold">{fc(asset.current_value)}</p></div>
                        )}
                        {asset.pnl != null && (
                          <div><p className="text-[10px] text-muted uppercase">P&L</p><p className={asset.pnl >= 0 ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>{asset.pnl >= 0 ? '+' : ''}{fc(asset.pnl)}</p></div>
                        )}
                      </div>
                      {asset.estimated_value != null && (
                        <div className="mt-3 bg-accent-500/5 border border-accent-500/20 rounded-lg p-3">
                          <div className="flex justify-between items-center">
                            <div>
                              <p className="text-[10px] text-muted uppercase">Estimation marché (DVF)</p>
                              <p className="text-accent-400 font-semibold">{fc(asset.estimated_value)}</p>
                              {asset.estimated_price_m2 && <p className="text-[10px] text-muted">{asset.estimated_price_m2.toLocaleString('fr-FR')} €/m²</p>}
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] text-muted uppercase">Votre estimation</p>
                              <p className="font-semibold">{asset.current_value ? fc(asset.current_value) : '—'}</p>
                              {asset.current_value && asset.estimated_value && (
                                <p className={`text-[10px] ${asset.current_value > asset.estimated_value ? 'text-green-400' : 'text-orange-400'}`}>
                                  {asset.current_value > asset.estimated_value ? '+' : ''}{((asset.current_value - asset.estimated_value) / asset.estimated_value * 100).toFixed(1)}% vs marché
                                </p>
                              )}
                            </div>
                          </div>
                          {asset.surface && <p className="text-[10px] text-muted mt-1">{asset.surface} m² · {asset.property_type} · {asset.address}</p>}
                        </div>
                      )}
                      {asset.costs.length > 0 && (
                        <div className="mt-3">
                          <p className="text-[10px] text-muted uppercase mb-1">{t('monthly_costs') || 'Charges'} ({fc(asset.monthly_costs)}/mois)</p>
                          <div className="space-y-1">
                            {asset.costs.map((c, i) => (
                              <div key={i} className="flex justify-between text-xs">
                                <span className="text-muted">{c.label}</span>
                                <span>{fc(c.amount)}{c.frequency === 'yearly' ? '/an' : c.frequency === 'one_time' ? '' : '/mois'}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {asset.revenues.length > 0 && (
                        <div className="mt-3">
                          <p className="text-[10px] text-muted uppercase mb-1">{t('monthly_revenues') || 'Revenus'} ({fc(asset.monthly_revenues)}/mois)</p>
                          <div className="space-y-1">
                            {asset.revenues.map((r, i) => (
                              <div key={i} className="flex justify-between text-xs">
                                <span className="text-muted">{r.label}</span>
                                <span className="text-green-400">{fc(r.amount)}{r.frequency === 'yearly' ? '/an' : '/mois'}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {(asset.costs.length > 0 || asset.revenues.length > 0) && (
                        <div className="mt-3 pt-2 border-t border-border/50 space-y-1">
                          <div className="flex justify-between text-sm font-medium">
                            <span>Cashflow mensuel</span>
                            <span className={netCashflow >= 0 ? 'text-green-400' : 'text-red-400'}>{netCashflow >= 0 ? '+' : ''}{fc(netCashflow)}/mois</span>
                          </div>
                          <div className="flex justify-between text-sm font-medium">
                            <span>Cashflow annuel</span>
                            <span className={netCashflow >= 0 ? 'text-green-400' : 'text-red-400'}>{netCashflow >= 0 ? '+' : ''}{fc(netCashflow * 12)}/an</span>
                          </div>
                          {asset.purchase_price != null && netCashflow !== 0 && (
                            <div className="flex justify-between text-xs text-muted">
                              <span>Rendement brut</span>
                              <span>{((asset.monthly_revenues * 12) / (asset.purchase_price + (asset.notary_fees || 0) + (asset.travaux || 0)) * 100).toFixed(1)}%</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
