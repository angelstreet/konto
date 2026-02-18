import { API } from '../config';
import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Plus, Trash2, Edit3, X, Check, TrendingUp, ChevronDown, ArrowLeft } from 'lucide-react';
import EyeToggle from '../components/EyeToggle';
import { useNavigate } from 'react-router-dom';
import { useApi, useAuthFetch } from '../useApi';
import { useAmountVisibility } from '../AmountVisibilityContext';

interface Company {
  id: number;
  name: string;
}

interface IncomeEntry {
  id: number;
  year: number;
  employer: string;
  job_title: string | null;
  country: string;
  gross_annual: number;
  net_annual: number | null;
  start_date: string | null;
  end_date: string | null;
  company_id: number | null;
  company_name: string | null;
}

function fmt(v: number, currency = 'EUR') {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
}

function fmtCHF(v: number) { return fmt(v, 'CHF'); }

export default function Income() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const authFetch = useAuthFetch();
  const { hideAmounts, toggleHideAmounts } = useAmountVisibility();
  const mask = (v: string) => hideAmounts ? <span className="amount-masked">{v}</span> : v;

  // Income tracking state - using cache
  const { data: incomeData, setData: setIncomeData } = useApi<{ entries: IncomeEntry[] }>(`${API}/income`);
  const { data: companiesData } = useApi<Company[]>(`${API}/companies`);

  const entries = incomeData?.entries || [];
  const companies = Array.isArray(companiesData) ? companiesData : [];

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ year: new Date().getFullYear(), employer: '', job_title: '', country: 'FR', gross_annual: '', net_annual: '', start_date: '', end_date: '', company_id: '' });
  const [expandedYears, setExpandedYears] = useState<Set<number> | null>(null); // null = default (last 3 years expanded)

  // Collapsible sections
  const [incomeOpen, setIncomeOpen] = useState(true);

  const handleSave = async () => {
    const body = {
      ...form,
      gross_annual: parseFloat(form.gross_annual) || 0,
      net_annual: form.net_annual ? parseFloat(form.net_annual) : null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      company_id: form.company_id ? parseInt(form.company_id) : null,
    };
    if (!body.employer || !body.gross_annual) return;
    if (editId) {
      await authFetch(`${API}/income/${editId}`, { method: 'PUT', body: JSON.stringify(body) });
    } else {
      await authFetch(`${API}/income`, { method: 'POST', body: JSON.stringify(body) });
    }
    setShowForm(false);
    setEditId(null);
    setForm({ year: new Date().getFullYear(), employer: '', job_title: '', country: 'FR', gross_annual: '', net_annual: '', start_date: '', end_date: '', company_id: '' });
    // Refetch to update cache
    const updated = await authFetch(`${API}/income`).then(r => r.json());
    setIncomeData(updated);
  };

  const handleDelete = async (id: number) => {
    await authFetch(`${API}/income/${id}`, { method: 'DELETE' });
    // Refetch to update cache
    const updated = await authFetch(`${API}/income`).then(r => r.json());
    setIncomeData(updated);
  };

  const startEdit = (e: IncomeEntry) => {
    setEditId(e.id);
    setForm({
      year: e.year, employer: e.employer, job_title: e.job_title || '', country: e.country,
      gross_annual: String(e.gross_annual), net_annual: e.net_annual ? String(e.net_annual) : '',
      start_date: e.start_date || '', end_date: e.end_date || '',
      company_id: e.company_id ? String(e.company_id) : '',
    });
    setShowForm(true);
  };

  // Chart data: salary progression by year
  const chartData = useMemo(() => {
    const byYear: Record<number, number> = {};
    entries.forEach(e => { byYear[e.year] = (byYear[e.year] || 0) + e.gross_annual; });
    return Object.entries(byYear).sort(([a], [b]) => Number(a) - Number(b)).map(([year, total]) => ({ year: Number(year), total }));
  }, [entries]);

  const countries = [
    { value: 'FR', label: '🇫🇷 France' },
    { value: 'CH', label: '🇨🇭 Suisse' },
    { value: 'OTHER', label: '🌍 Autre' },
  ];

  return (
    <div className="space-y-8 max-w-5xl">
      <div className="flex items-center justify-between gap-2 mb-2 h-10">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => navigate('/more')} className="md:hidden text-muted hover:text-white transition-colors p-1 -ml-1 flex-shrink-0">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-semibold whitespace-nowrap">{t('nav_income')}</h1>
          <EyeToggle hidden={hideAmounts} onToggle={toggleHideAmounts} />
        </div>
      </div>

      {/* ===== SECTION 1: Income Tracking ===== */}
      <section className="bg-surface rounded-xl border border-border p-4 space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2 cursor-pointer select-none" onClick={() => setIncomeOpen(!incomeOpen)}>
            <TrendingUp size={20} /> {t('income_tracking')}
            <ChevronDown size={16} className={`text-muted transition-transform ${incomeOpen ? '' : '-rotate-90'}`} />
          </h2>
          {incomeOpen && (
            <button
              onClick={() => { setShowForm(true); setEditId(null); setForm({ year: new Date().getFullYear(), employer: '', job_title: '', country: 'FR', gross_annual: '', net_annual: '', start_date: '', end_date: '', company_id: '' }); }}
              className="flex items-center gap-1.5 px-3 py-2.5 bg-accent-500 text-white rounded-lg text-sm min-h-[44px] font-medium hover:bg-accent-600 transition-colors"
            >
              <Plus size={16} /> <span className="hidden sm:inline">{t('add_employer')}</span>
            </button>
          )}
        </div>
        {incomeOpen && (<>

        {/* Form */}
        {showForm && (
          <div className="bg-surface-hover rounded-lg p-4 space-y-3 border border-border">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-muted mb-1 block">{t('year')}</label>
                <input type="number" value={form.year} onChange={e => setForm({ ...form, year: parseInt(e.target.value) })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">{t('employer')}</label>
                <input type="text" value={form.employer} onChange={e => setForm({ ...form, employer: e.target.value })}
                  placeholder="Ex: Google" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">{t('job_title')}</label>
                <input type="text" value={form.job_title} onChange={e => setForm({ ...form, job_title: e.target.value })}
                  placeholder="Ex: Développeur" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">{t('country')}</label>
                <select value={form.country} onChange={e => setForm({ ...form, country: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm">
                  {countries.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-muted mb-1 block">{t('start_date')}</label>
                <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">{t('end_date')}</label>
                <input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })}
                  placeholder="En cours" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">{t('gross_annual')}</label>
                <input type="number" value={form.gross_annual} onChange={e => setForm({ ...form, gross_annual: e.target.value })}
                  placeholder="55000" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">{t('net_annual')}</label>
                <input type="number" value={form.net_annual} onChange={e => setForm({ ...form, net_annual: e.target.value })}
                  placeholder="42000" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            {companies.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-muted mb-1 block">{t('company')}</label>
                  <select value={form.company_id} onChange={e => setForm({ ...form, company_id: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm">
                    <option value="">—</option>
                    {companies.map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
                  </select>
                </div>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowForm(false); setEditId(null); }}
                className="px-3 py-1.5 text-sm text-muted hover:text-white transition-colors"><X size={16} /></button>
              <button onClick={handleSave}
                className="flex items-center gap-1 px-4 py-2.5 bg-accent-500 text-white rounded-lg text-sm min-h-[44px] font-medium hover:bg-accent-600 transition-colors">
                <Check size={16} /> {editId ? t('save') : t('create')}
              </button>
            </div>
          </div>
        )}

        {/* Entries — table on desktop, cards on mobile */}
        {entries.length > 0 ? (
          <>
            {/* Mobile: group by year, one line per year, expand for details */}
            <div className="sm:hidden space-y-1">
              {(() => {
                // Group entries by year, sort descending
                const byYear = new Map<number, IncomeEntry[]>();
                entries.forEach(e => {
                  if (!byYear.has(e.year)) byYear.set(e.year, []);
                  byYear.get(e.year)!.push(e);
                });
                const years = [...byYear.keys()].sort((a, b) => b - a);
                const defaultExpanded = new Set(years.slice(0, 3));
                return years.map(year => {
                  const yearEntries = byYear.get(year)!;
                  const totalGross = yearEntries.reduce((s, e) => s + e.gross_annual, 0);
                  const isExpanded = expandedYears === null ? defaultExpanded.has(year) : expandedYears.has(year);
                  const mainCurrency = yearEntries[0]?.country === 'CH' ? 'CHF' : 'EUR';
                  const fmtYear = mainCurrency === 'CHF' ? fmtCHF : fmt;
                  const toggleYear = () => {
                    setExpandedYears(prev => {
                      const current = prev ?? new Set(defaultExpanded);
                      const next = new Set(current);
                      if (next.has(year)) next.delete(year);
                      else next.add(year);
                      return next;
                    });
                  };
                  return (
                    <div key={year} className="bg-surface-hover rounded-lg overflow-hidden">
                      {/* Year summary line */}
                      <div
                        className="flex items-center justify-between px-3 py-2.5 cursor-pointer"
                        onClick={toggleYear}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-sm font-bold text-white">{year}</span>
                          <span className="text-sm font-mono font-medium text-green-400">{mask(fmtYear(totalGross))}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs text-muted">{yearEntries.length} {yearEntries.length > 1 ? 'employeurs' : 'employeur'}</span>
                          <ChevronDown size={14} className={`text-muted transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                        </div>
                      </div>
                      {/* Expanded: individual entries */}
                      {isExpanded && (
                        <div className="px-3 pb-2 space-y-1">
                          {yearEntries.map(e => {
                            const fmtE = e.country === 'CH' ? fmtCHF : fmt;
                            const months = e.start_date && e.end_date
                              ? `${new Date(e.start_date).toLocaleDateString('fr-FR', { month: 'short' })}–${new Date(e.end_date).toLocaleDateString('fr-FR', { month: 'short' })}`
                              : e.start_date
                              ? `${new Date(e.start_date).toLocaleDateString('fr-FR', { month: 'short' })}–…`
                              : '';
                            return (
                              <div key={e.id} className="flex items-center justify-between py-1.5 pl-2 border-l-2 border-accent-500/30">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <span className="text-sm truncate">{e.employer}</span>
                                  {months && <span className="text-[10px] text-muted flex-shrink-0">({months})</span>}
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  <span className="text-sm font-mono text-green-400">{mask(fmtE(e.gross_annual))}</span>
                                  <button onClick={(ev) => { ev.stopPropagation(); startEdit(e); }} className="p-1.5 text-muted hover:text-white"><Edit3 size={12} /></button>
                                  <button onClick={(ev) => { ev.stopPropagation(); handleDelete(e.id); }} className="p-1.5 text-muted hover:text-red-400"><Trash2 size={12} /></button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
            {/* Desktop: group by year, last 3 years expanded by default */}
            <div className="hidden sm:block space-y-1">
              {(() => {
                const byYear = new Map<number, IncomeEntry[]>();
                entries.forEach(e => {
                  if (!byYear.has(e.year)) byYear.set(e.year, []);
                  byYear.get(e.year)!.push(e);
                });
                const years = [...byYear.keys()].sort((a, b) => b - a);
                const defaultExpanded = new Set(years.slice(0, 3));
                return years.map(year => {
                  const yearEntries = byYear.get(year)!;
                  const totalGross = yearEntries.reduce((s, e) => s + e.gross_annual, 0);
                  const isExpanded = expandedYears === null ? defaultExpanded.has(year) : expandedYears.has(year);
                  const mainCurrency = yearEntries[0]?.country === 'CH' ? 'CHF' : 'EUR';
                  const fmtYear = mainCurrency === 'CHF' ? fmtCHF : fmt;
                  const toggleYear = () => {
                    setExpandedYears(prev => {
                      const current = prev ?? new Set(defaultExpanded);
                      const next = new Set(current);
                      if (next.has(year)) next.delete(year);
                      else next.add(year);
                      return next;
                    });
                  };
                  return (
                    <div key={year} className="bg-surface-hover rounded-lg overflow-hidden">
                      <div
                        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-white/5 transition-colors"
                        onClick={toggleYear}
                      >
                        <div className="flex items-center gap-4 min-w-0">
                          <span className="text-base font-bold text-white">{year}</span>
                          <span className="text-base font-mono font-medium text-green-400">{mask(fmtYear(totalGross))}</span>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <span className="text-xs text-muted">{yearEntries.length} {yearEntries.length > 1 ? 'employeurs' : 'employeur'}</span>
                          <ChevronDown size={16} className={`text-muted transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="px-4 pb-3">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-muted text-xs border-b border-border/50">
                                <th className="text-left py-1.5 px-2">{t('period')}</th>
                                <th className="text-left py-1.5 px-2">{t('employer')}</th>
                                <th className="text-left py-1.5 px-2">{t('job_title')}</th>
                                <th className="text-left py-1.5 px-2">{t('country')}</th>
                                <th className="text-right py-1.5 px-2">{t('gross_annual')}</th>
                                <th className="text-right py-1.5 px-2">{t('net_annual')}</th>
                                <th className="text-right py-1.5 px-2"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {yearEntries.map(e => {
                                const fmtE = e.country === 'CH' ? fmtCHF : fmt;
                                const period = e.start_date
                                  ? `${e.start_date.slice(5)}${e.end_date ? ' → ' + e.end_date.slice(5) : ' → …'}`
                                  : '—';
                                return (
                                  <tr key={e.id} className="border-b border-border/30 hover:bg-white/5 transition-colors">
                                    <td className="py-2 px-2 text-xs text-muted">{period}</td>
                                    <td className="py-2 px-2">
                                      {e.employer}
                                      {e.company_name && <span className="text-xs text-accent-400 ml-1">({e.company_name})</span>}
                                    </td>
                                    <td className="py-2 px-2 text-muted">{e.job_title || '—'}</td>
                                    <td className="py-2 px-2">{countries.find(c => c.value === e.country)?.label || e.country}</td>
                                    <td className="py-2 px-2 text-right font-mono font-medium text-green-400">{mask(fmtE(e.gross_annual))}</td>
                                    <td className="py-2 px-2 text-right font-mono text-emerald-300">{e.net_annual ? mask(fmtE(e.net_annual)) : '—'}</td>
                                    <td className="py-2 px-2 text-right">
                                      <button onClick={() => startEdit(e)} className="p-1 text-muted hover:text-white"><Edit3 size={14} /></button>
                                      <button onClick={() => handleDelete(e.id)} className="p-1 text-muted hover:text-red-400 ml-1"><Trash2 size={14} /></button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </>
        
        ) : (
          <p className="text-muted text-sm text-center py-2.5">{t('no_income_entries')}</p>
        )}

        {/* Salary progression chart */}
        {chartData.length > 1 && (
          <div className="mt-4">
            <h3 className="text-sm font-medium text-muted mb-2">{t('salary_progression')}</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="year" tick={{ fill: '#888', fontSize: 12 }} />
                <YAxis tick={{ fill: '#888', fontSize: 12 }} tickFormatter={v => hideAmounts ? '' : `${Math.round(v / 1000)}k`} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} formatter={(v: any) => mask(fmt(v))} contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #333', borderRadius: 8, color: '#e5e5e5' }} itemStyle={{ color: '#e5e5e5' }} />
                <Bar dataKey="total" fill="#6366f1" radius={[4, 4, 0, 0]} name="Salaire brut" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        </>)}
      </section>

      {/* Tax Estimation and Borrowing Capacity moved to Outils page */}
    </div>
  );
}
