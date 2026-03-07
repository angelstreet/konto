import { API } from '../config';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, Treemap, Cell } from 'recharts';
import { Plus, Download, GraduationCap, Pencil, Trash2 } from 'lucide-react';
import { useApi, useAuthFetch, invalidateApi } from '../useApi';
import { useFilter } from '../FilterContext';
import { usePreferences } from '../PreferencesContext';
import { useAmountVisibility } from '../AmountVisibilityContext';
import ScopeSelect from '../components/ScopeSelect';
import EyeToggle from '../components/EyeToggle';

type LearnItem = { id: string; title: string; summary: string };

type LoanRow = {
  loan_id: number;
  name: string;
  provider: string | null;
  remaining: number;
  monthly_payment: number | null;
  interest_rate: number | null;
  repaid_pct: number | null;
  start_date: string | null;
  end_date: string | null;
  monthly_breakdown: {
    capital: number | null;
    interest: number | null;
    insurance: number;
  };
  usage: 'personal' | 'professional';
  company_id: number | null;
};

type LoansResponse = {
  date: string;
  total_outstanding: number;
  summary: {
    monthly_total: number;
    monthly_breakdown: { capital: number; interest: number; insurance: number };
    avg_duration_years: number | null;
    avg_rate: number | null;
    capacity_available: number | null;
  };
  distribution: { loan_id: number; name: string; remaining: number; share_pct: number }[];
  timeline: { year: number; remaining: number }[];
  loans: LoanRow[];
  notifications?: { loan_id: number; loan_name: string; milestone: number; repaid_pct: number }[];
};

type LoanForm = {
  name: string;
  provider_name: string;
  remaining: string;
  principal_amount: string;
  monthly_payment: string;
  interest_rate: string;
  insurance_monthly: string;
  fees_total: string;
  start_date: string;
  end_date: string;
  duration_months: string;
  installments_paid: string;
  usage: 'personal' | 'professional';
};

const TREEMAP_COLORS = ['#c65766', '#7f3f86', '#e09a5b', '#5b90d6', '#5ab79a', '#c78a4e'];

const EMPTY_FORM: LoanForm = {
  name: '',
  provider_name: '',
  remaining: '',
  principal_amount: '',
  monthly_payment: '',
  interest_rate: '',
  insurance_monthly: '',
  fees_total: '',
  start_date: '',
  end_date: '',
  duration_months: '',
  installments_paid: '',
  usage: 'personal',
};

function parseNum(value: string): number | undefined {
  const v = Number(value);
  return Number.isFinite(v) ? v : undefined;
}

export default function LoansDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const authFetch = useAuthFetch();
  const { appendScope } = useFilter();
  const { formatCurrency } = usePreferences();
  const { hideAmounts, toggleHideAmounts } = useAmountVisibility();
  const [mobileTab, setMobileTab] = useState<'loans' | 'learn'>('loans');
  const [selectedProvider, setSelectedProvider] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editingLoanId, setEditingLoanId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<LoanForm>(EMPTY_FORM);

  const dataUrl = appendScope(`${API}/loans`);
  const { data, loading, refetch } = useApi<LoansResponse>(dataUrl);
  const learn = useApi<{ items: LearnItem[] }>(`${API}/loans/learn`);

  const loans = data?.loans || [];
  const providerLabel = (loan?: LoanRow) => (loan?.provider && loan.provider.trim()) || '';
  const providers = Array.from(new Set(loans.map((l) => l.provider).filter(Boolean) as string[]));

  const filteredLoans = useMemo(() => {
    if (selectedProvider === 'all') return loans;
    return loans.filter((l) => providerLabel(l) === selectedProvider);
  }, [loans, selectedProvider]);
  const filteredDistribution = useMemo(() => {
    if (!data) return [];
    return data.distribution.filter((d) => selectedProvider === 'all' || providerLabel(loans.find((l) => l.loan_id === d.loan_id)) === selectedProvider);
  }, [data, loans, selectedProvider]);

  const fc = (amount: number | null | undefined) => {
    const value = amount || 0;
    return hideAmounts ? <span className="amount-masked">{formatCurrency(value)}</span> : formatCurrency(value);
  };
  const formatLoanDate = (value: string | null) => {
    if (!value) return '-';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return '-';
    return dt.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
  };

  const summary = useMemo(() => {
    const monthlyCapital = filteredLoans.reduce((s, l) => s + (l.monthly_breakdown.capital || 0), 0);
    const monthlyInterest = filteredLoans.reduce((s, l) => s + (l.monthly_breakdown.interest || 0), 0);
    const monthlyInsurance = filteredLoans.reduce((s, l) => s + (l.monthly_breakdown.insurance || 0), 0);
    const monthlyTotal = filteredLoans.reduce((s, l) => s + (l.monthly_payment || 0), 0);
    return { monthlyCapital, monthlyInterest, monthlyInsurance, monthlyTotal };
  }, [filteredLoans]);

  const totalOutstanding = filteredLoans.reduce((s, l) => s + l.remaining, 0);

  const openCreate = () => {
    setEditingLoanId(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEdit = (loan: LoanRow) => {
    setEditingLoanId(loan.loan_id);
    setForm({
      name: loan.name,
      provider_name: loan.provider || '',
      remaining: String(Math.round(loan.remaining * 100) / 100),
      principal_amount: '',
      monthly_payment: loan.monthly_payment != null ? String(loan.monthly_payment) : '',
      interest_rate: loan.interest_rate != null ? String(loan.interest_rate) : '',
      insurance_monthly: String(loan.monthly_breakdown.insurance || ''),
      fees_total: '',
      start_date: loan.start_date || '',
      end_date: loan.end_date || '',
      duration_months: '',
      installments_paid: '',
      usage: loan.usage || 'personal',
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setForm(EMPTY_FORM);
    setEditingLoanId(null);
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        provider_name: form.provider_name || undefined,
        remaining: parseNum(form.remaining),
        principal_amount: parseNum(form.principal_amount),
        monthly_payment: parseNum(form.monthly_payment),
        interest_rate: parseNum(form.interest_rate),
        insurance_monthly: parseNum(form.insurance_monthly),
        fees_total: parseNum(form.fees_total),
        start_date: form.start_date || undefined,
        end_date: form.end_date || undefined,
        duration_months: parseNum(form.duration_months),
        installments_paid: parseNum(form.installments_paid),
        usage: form.usage,
      };

      const url = editingLoanId ? `${API}/loans/${editingLoanId}` : `${API}/loans`;
      const method = editingLoanId ? 'PATCH' : 'POST';
      await authFetch(url, {
        method,
        body: JSON.stringify(payload),
      });
      invalidateApi(dataUrl);
      await refetch();
      closeModal();
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (loan: LoanRow) => {
    if (!window.confirm(t('loan_delete_confirm') || 'Supprimer ce prêt ?')) return;
    await authFetch(`${API}/loans/${loan.loan_id}`, { method: 'DELETE' });
    invalidateApi(dataUrl);
    await refetch();
  };

  const onExport = async () => {
    const res = await authFetch(appendScope(`${API}/loans/export.csv`));
    let csv = await res.text();
    // Sandbox interceptor wraps all payloads as JSON.
    if ((csv.startsWith('\"') && csv.endsWith('\"')) || (csv.startsWith('{') && csv.endsWith('}'))) {
      try {
        const parsed = JSON.parse(csv);
        if (typeof parsed === 'string') csv = parsed;
      } catch {
        // no-op
      }
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = 'loans.csv';
    a.click();
    URL.revokeObjectURL(href);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2 h-10">
        <div className="flex items-center gap-1 min-w-0">
          <h1 className="text-xl font-semibold whitespace-nowrap">{t('loans_title') || 'Emprunts'}</h1>
          <EyeToggle hidden={hideAmounts} onToggle={toggleHideAmounts} />
        </div>
        <div className="flex items-center gap-1">
          <ScopeSelect />
          <button onClick={onExport} className="p-2 rounded-lg border border-border text-muted hover:text-white hover:bg-surface-hover" title={t('loan_export') || 'Exporter'}>
            <Download size={16} />
          </button>
          <button onClick={openCreate} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-accent-500 text-black">
            <Plus size={16} />
            <span className="hidden sm:inline">{t('loan_add') || 'Ajouter un prêt'}</span>
          </button>
        </div>
      </div>

      <div className="md:hidden mb-3 flex rounded-lg border border-border overflow-hidden">
        <button
          className={`flex-1 py-2 text-sm ${mobileTab === 'loans' ? 'bg-surface text-white' : 'bg-background text-muted'}`}
          onClick={() => setMobileTab('loans')}
        >
          {t('loans_tab_loans') || 'Emprunts'}
        </button>
        <button
          className={`flex-1 py-2 text-sm ${mobileTab === 'learn' ? 'bg-surface text-white' : 'bg-background text-muted'}`}
          onClick={() => setMobileTab('learn')}
        >
          {t('loans_tab_learn') || 'Apprendre'}
        </button>
      </div>

      {loading && !data ? (
        <div className="text-center text-muted py-10">Loading...</div>
      ) : null}

      {!loading && data && (
        <>
          {(data.notifications || []).length > 0 && (
            <div className="mb-3 bg-surface border border-border rounded-xl p-3 text-sm text-accent-300">
              {(data.notifications || []).slice(0, 3).map((n) => (
                <div key={`${n.loan_id}-${n.milestone}`}>{n.loan_name}: {t('loan_milestone_msg', { milestone: n.milestone }) || `objectif ${n.milestone}% atteint`}</div>
              ))}
            </div>
          )}

          {(mobileTab === 'loans' || window.innerWidth >= 768) && (
            <>
              <div className="bg-surface rounded-xl border border-border p-4 mb-3">
                <p className="text-xs text-muted">{data.date}</p>
                <p className="text-3xl font-semibold text-accent-400">{fc(totalOutstanding)}</p>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-5 gap-3 mb-3">
                <div className="xl:col-span-3 bg-surface rounded-xl border border-border p-3">
                  <div className="text-sm text-muted mb-2">{t('loan_remaining_timeline') || 'Évolution du capital restant dû'}</div>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.timeline}>
                        <XAxis dataKey="year" tick={{ fill: '#8d9099', fontSize: 11 }} />
                        <YAxis tick={{ fill: '#8d9099', fontSize: 11 }} width={80} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                        <Tooltip formatter={(value: any) => formatCurrency(Number(value || 0))} />
                        <Area type="monotone" dataKey="remaining" stroke="#c7a26b" fillOpacity={1} fill="url(#loanArea)" />
                        <defs>
                          <linearGradient id="loanArea" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6f5530" stopOpacity={0.7} />
                            <stop offset="95%" stopColor="#1b1a17" stopOpacity={0.2} />
                          </linearGradient>
                        </defs>
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="xl:col-span-2 bg-surface rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="text-sm text-muted">{t('loans_distribution') || 'Distribution'}</div>
                  <select
                    value={selectedProvider}
                    onChange={(e) => setSelectedProvider(e.target.value)}
                    className="text-xs rounded-md border border-border bg-background px-2 py-1"
                    >
                      <option value="all">{t('loans_all') || 'Tous les emprunts'}</option>
                      {providers.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <Treemap
                        data={filteredDistribution}
                        dataKey="remaining"
                        stroke="#111"
                        content={({ x, y, width, height, index, name, value }) => {
                          if (width < 40 || height < 25) return <g />;
                          return (
                            <g>
                              <rect x={x} y={y} width={width} height={height} fill={TREEMAP_COLORS[(index || 0) % TREEMAP_COLORS.length]} opacity={0.9} />
                              <text x={x + 6} y={y + 16} fill="#fff" fontSize={11} fontWeight="600" pointerEvents="none">
                                {name}
                              </text>
                              <text x={x + 6} y={y + 32} fill="#d1d5db" fontSize={10} pointerEvents="none">
                                {formatCurrency(Number(value || 0))}
                              </text>
                            </g>
                          );
                        }}
                      >
                        {filteredDistribution.map((_, idx) => (
                          <Cell key={idx} fill={TREEMAP_COLORS[idx % TREEMAP_COLORS.length]} />
                        ))}
                      </Treemap>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-muted">
                    {filteredDistribution.map((d, idx) => (
                      <div key={d.loan_id} className="flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: TREEMAP_COLORS[idx % TREEMAP_COLORS.length] }} />
                          <span className="text-white">{d.name}</span>
                        </span>
                        <span className="text-muted">{formatCurrency(d.remaining)} · {d.share_pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="text-sm font-semibold mb-2">{t('loans_analysis') || 'Analyse'}</div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-4">
                <div className="bg-surface rounded-xl border border-border p-4">
                  <div className="text-xs text-muted uppercase">{t('loan_monthly') || 'Mensualité'}</div>
                  <div className="text-3xl mt-1 mb-2">{fc(summary.monthlyTotal)}</div>
                  <div className="text-xs text-muted">{t('loan_capital') || 'Capital'}: {fc(summary.monthlyCapital)}</div>
                  <div className="text-xs text-muted">{t('loan_interest') || 'Intérêts'}: {fc(summary.monthlyInterest)}</div>
                  <div className="text-xs text-muted">{t('loan_insurance') || 'Assurance'}: {fc(summary.monthlyInsurance)}</div>
                </div>
                <div className="bg-surface rounded-xl border border-border p-4">
                  <div className="text-xs text-muted uppercase">{t('loan_avg_duration') || 'Durée moyenne'}</div>
                  <div className="text-3xl mt-3">{data.summary.avg_duration_years != null ? `${data.summary.avg_duration_years} ans` : (t('loan_no_data') || 'Pas de données')}</div>
                </div>
                <div className="bg-surface rounded-xl border border-border p-4">
                  <div className="text-xs text-muted uppercase">{t('loan_avg_rate') || 'Taux moyen'}</div>
                  <div className="text-3xl mt-3">{data.summary.avg_rate != null ? `${data.summary.avg_rate} %` : (t('loan_no_data') || 'Pas de données')}</div>
                </div>
              </div>

              <div className="hidden md:block bg-surface rounded-xl border border-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted border-b border-border">
                      <th className="text-left px-4 py-3">{t('label') || 'Nom'}</th>
                      <th className="text-right px-4 py-3">{t('loan_total_repaid') || 'Total remboursé'}</th>
                      <th className="text-right px-4 py-3">{t('interest_rate') || "Taux d'intérêt"}</th>
                      <th className="text-right px-4 py-3">{t('loan_monthly') || 'Mensualité'}</th>
                      <th className="text-right px-4 py-3">{t('loan_remaining_principal') || 'Capital restant dû'}</th>
                      <th className="text-right px-4 py-3">...</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLoans.map((loan) => (
                      <tr key={loan.loan_id} className="border-b border-border/70 hover:bg-surface-hover">
                        <td className="px-4 py-3 cursor-pointer" onClick={() => navigate(`/loans/${loan.loan_id}`)}>
                          <div>{loan.name}</div>
                          {providerLabel(loan) ? <div className="text-xs text-muted">{providerLabel(loan)}</div> : null}
                          <div className="text-xs text-muted">
                            {formatLoanDate(loan.start_date) !== '-' || formatLoanDate(loan.end_date) !== '-' ? (
                              <>
                                Début {formatLoanDate(loan.start_date)} · Fin {formatLoanDate(loan.end_date)}
                                {loan.start_date && loan.end_date ? (() => {
                                  const years = (new Date(loan.end_date).getTime() - new Date(loan.start_date).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
                                  return years > 0 ? ` · ${Math.round(years)} ans` : null;
                                })() : null}
                              </>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">{loan.repaid_pct != null ? `${Math.round(loan.repaid_pct)} %` : '-'}</td>
                        <td className="px-4 py-3 text-right">{loan.interest_rate != null ? `${loan.interest_rate} %` : '-'}</td>
                        <td className="px-4 py-3 text-right">{loan.monthly_payment != null ? fc(loan.monthly_payment) : '-'}</td>
                        <td className="px-4 py-3 text-right">{fc(loan.remaining)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            <button className="p-1.5 rounded hover:bg-background" onClick={() => openEdit(loan)} title={t('edit') || 'Modifier'}><Pencil size={14} /></button>
                            <button className="p-1.5 rounded hover:bg-background text-red-300" onClick={() => onDelete(loan)} title={t('delete') || 'Supprimer'}><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden space-y-2">
                {filteredLoans.map((loan) => (
                  <div key={loan.loan_id} className="bg-surface rounded-xl border border-border p-3">
                    <button className="w-full text-left" onClick={() => navigate(`/loans/${loan.loan_id}`)}>
                      <div className="font-medium truncate">{loan.name}</div>
                      {providerLabel(loan) ? <div className="text-xs text-muted mb-2">{providerLabel(loan)}</div> : null}
                      <div className="text-2xl font-semibold text-accent-400 mb-1">{fc(loan.remaining)}</div>
                      <div className="text-xs text-muted mb-1">{loan.repaid_pct != null ? `${t('loan_repaid_sentence') || 'Vous avez remboursé'} ${Math.round(loan.repaid_pct)} %` : (t('loan_no_data') || 'Pas de données')}</div>
                      <div className="h-1.5 bg-background rounded-full overflow-hidden">
                        <div className="h-full bg-accent-500" style={{ width: `${Math.max(0, Math.min(100, loan.repaid_pct || 0))}%` }} />
                      </div>
                    </button>
                    <div className="flex justify-end gap-2 mt-2">
                      <button className="p-1.5 rounded hover:bg-background" onClick={() => openEdit(loan)}><Pencil size={14} /></button>
                      <button className="p-1.5 rounded hover:bg-background text-red-300" onClick={() => onDelete(loan)}><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {mobileTab === 'learn' && (
            <div className="md:hidden space-y-2">
              {(learn.data?.items || []).map((item) => (
                <div key={item.id} className="bg-surface rounded-xl border border-border p-3">
                  <div className="flex items-center gap-2 text-accent-300 mb-1"><GraduationCap size={14} /> <span className="font-medium">{item.title}</span></div>
                  <div className="text-sm text-muted">{item.summary}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-surface border border-border rounded-xl p-4 max-h-[90vh] overflow-y-auto">
            <div className="text-lg font-semibold mb-3">{editingLoanId ? (t('loan_edit') || 'Modifier un prêt') : (t('loan_add') || 'Ajouter un prêt')}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input className="bg-background border border-border rounded-lg px-3 py-2" placeholder={t('label') || 'Nom'} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              <input className="bg-background border border-border rounded-lg px-3 py-2" placeholder={t('provider_name') || 'Banque'} value={form.provider_name} onChange={(e) => setForm((f) => ({ ...f, provider_name: e.target.value }))} />
              <input className="bg-background border border-border rounded-lg px-3 py-2" placeholder={t('loan_remaining_principal') || 'Capital restant dû'} value={form.remaining} onChange={(e) => setForm((f) => ({ ...f, remaining: e.target.value }))} />
              <input className="bg-background border border-border rounded-lg px-3 py-2" placeholder={t('loan_principal') || 'Capital initial'} value={form.principal_amount} onChange={(e) => setForm((f) => ({ ...f, principal_amount: e.target.value }))} />
              <input className="bg-background border border-border rounded-lg px-3 py-2" placeholder={t('loan_monthly') || 'Mensualité'} value={form.monthly_payment} onChange={(e) => setForm((f) => ({ ...f, monthly_payment: e.target.value }))} />
              <input className="bg-background border border-border rounded-lg px-3 py-2" placeholder={t('interest_rate') || "Taux d'intérêt"} value={form.interest_rate} onChange={(e) => setForm((f) => ({ ...f, interest_rate: e.target.value }))} />
              <input className="bg-background border border-border rounded-lg px-3 py-2" placeholder={t('loan_insurance') || 'Assurance mensuelle'} value={form.insurance_monthly} onChange={(e) => setForm((f) => ({ ...f, insurance_monthly: e.target.value }))} />
              <input className="bg-background border border-border rounded-lg px-3 py-2" placeholder={t('loan_fees') || 'Frais'} value={form.fees_total} onChange={(e) => setForm((f) => ({ ...f, fees_total: e.target.value }))} />
              <input className="bg-background border border-border rounded-lg px-3 py-2" type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
              <input className="bg-background border border-border rounded-lg px-3 py-2" type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
              <input className="bg-background border border-border rounded-lg px-3 py-2" placeholder={t('loan_duration_months') || 'Durée (mois)'} value={form.duration_months} onChange={(e) => setForm((f) => ({ ...f, duration_months: e.target.value }))} />
              <input className="bg-background border border-border rounded-lg px-3 py-2" placeholder={t('loan_installments_paid') || 'Échéances payées'} value={form.installments_paid} onChange={(e) => setForm((f) => ({ ...f, installments_paid: e.target.value }))} />
              <select className="bg-background border border-border rounded-lg px-3 py-2" value={form.usage} onChange={(e) => setForm((f) => ({ ...f, usage: e.target.value as 'personal' | 'professional' }))}>
                <option value="personal">{t('scope_personal') || 'Personnel'}</option>
                <option value="professional">{t('scope_pro') || 'Pro'}</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="px-3 py-2 rounded-lg border border-border" onClick={closeModal}>{t('cancel') || 'Annuler'}</button>
              <button className="px-3 py-2 rounded-lg bg-accent-500 text-black font-semibold disabled:opacity-60" disabled={saving || !form.name || !form.remaining} onClick={onSave}>
                {saving ? '...' : (t('save') || 'Enregistrer')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
