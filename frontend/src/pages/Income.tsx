import { API } from '../config';
import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Plus, Trash2, Edit3, X, Check, Briefcase, TrendingUp, Calculator, CreditCard, ChevronDown } from 'lucide-react';
import { useAuthFetch } from '../useApi';

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

interface TaxResult {
  gross_annual: number;
  tax: number;
  netIncome: number;
  effectiveRate: number;
  brackets: { rate: number; amount: number }[];
  country: string;
  parts: number;
}

interface BorrowingResult {
  net_monthly: number;
  max_payment: number;
  available_payment: number;
  max_loan: number;
  rate: number;
  duration_years: number;
}

function fmt(v: number, currency = 'EUR') {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
}

function fmtCHF(v: number) { return fmt(v, 'CHF'); }

export default function Income() {
  const { t } = useTranslation();
  const authFetch = useAuthFetch();

  // Income tracking state
  const [entries, setEntries] = useState<IncomeEntry[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ year: new Date().getFullYear(), employer: '', job_title: '', country: 'FR', gross_annual: '', net_annual: '', start_date: '', end_date: '', company_id: '' });
  const [expandedEntryId, setExpandedEntryId] = useState<number | null>(null);

  // Tax estimation state
  const [taxInput, setTaxInput] = useState({ gross_annual: '', country: 'FR', canton: 'ZH', situation: 'single', children: 0 });
  const [taxResult, setTaxResult] = useState<TaxResult | null>(null);

  // Borrowing capacity state
  const [borrowInput, setBorrowInput] = useState({ net_monthly: '', existing_payments: '', rate: '3.35', duration_years: '20' });
  const [borrowResult, setBorrowResult] = useState<BorrowingResult | null>(null);

  useEffect(() => { fetchEntries(); fetchCompanies(); }, []);

  const fetchEntries = () => {
    authFetch(`${API}/income`).then(r => r.json()).then(d => setEntries(d.entries || []));
  };

  const fetchCompanies = () => {
    authFetch(`${API}/companies`).then(r => r.json()).then(d => setCompanies(Array.isArray(d) ? d : []));
  };

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
    fetchEntries();
  };

  const handleDelete = async (id: number) => {
    await authFetch(`${API}/income/${id}`, { method: 'DELETE' });
    fetchEntries();
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

  const estimateTax = async () => {
    const body = { ...taxInput, gross_annual: parseFloat(taxInput.gross_annual) || 0 };
    if (!body.gross_annual) return;
    const res = await authFetch(`${API}/tax/estimate`, { method: 'POST', body: JSON.stringify(body) });
    setTaxResult(await res.json());
  };

  const estimateBorrowing = async () => {
    const body = {
      net_monthly: parseFloat(borrowInput.net_monthly) || 0,
      existing_payments: parseFloat(borrowInput.existing_payments) || 0,
      rate: parseFloat(borrowInput.rate) || 3.35,
      duration_years: parseInt(borrowInput.duration_years) || 20,
    };
    if (!body.net_monthly) return;
    const res = await authFetch(`${API}/borrowing-capacity`, { method: 'POST', body: JSON.stringify(body) });
    setBorrowResult(await res.json());
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

  const cantons = ['ZH', 'GE', 'VD', 'BE', 'BS', 'LU', 'AG', 'SG', 'TI', 'VS'];

  const isCHF = taxInput.country === 'CH';
  const fmtTax = isCHF ? fmtCHF : fmt;

  return (
    <div className="space-y-8 max-w-5xl">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Briefcase size={24} /> {t('nav_income')}
      </h1>

      {/* ===== SECTION 1: Income Tracking ===== */}
      <section className="bg-surface rounded-xl border border-border p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <TrendingUp size={20} /> {t('income_tracking')}
          </h2>
          <button
            onClick={() => { setShowForm(true); setEditId(null); setForm({ year: new Date().getFullYear(), employer: '', job_title: '', country: 'FR', gross_annual: '', net_annual: '', start_date: '', end_date: '', company_id: '' }); }}
            className="flex items-center gap-1.5 px-3 py-2.5 bg-accent-500 text-white rounded-lg text-sm min-h-[44px] font-medium hover:bg-accent-600 transition-colors"
          >
            <Plus size={16} /> <span className="hidden sm:inline">{t('add_employer')}</span>
          </button>
        </div>

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
            {/* Mobile cards — max 3 lines, tap to expand */}
            <div className="sm:hidden space-y-2">
              {entries.map(e => {
                const fmtE = e.country === 'CH' ? fmtCHF : fmt;
                const isExpanded = expandedEntryId === e.id;
                const period = e.start_date
                  ? `${e.start_date.slice(5)}${e.end_date ? ' → ' + e.end_date.slice(5) : ' → …'}`
                  : '';
                return (
                  <div key={e.id} className="bg-surface-hover rounded-lg overflow-hidden">
                    {/* Compact 3-line view — tap to expand */}
                    <div
                      className="p-3 cursor-pointer"
                      onClick={() => setExpandedEntryId(isExpanded ? null : e.id)}
                    >
                      {/* Line 1: Employer — Company */}
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-white truncate flex-1 min-w-0">
                          {e.employer}
                          {e.company_name && <span className="text-xs text-accent-400 ml-1">({e.company_name})</span>}
                        </p>
                        <ChevronDown size={14} className={`text-muted flex-shrink-0 ml-2 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                      </div>
                      {/* Line 2: Gross salary */}
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-sm font-mono font-medium text-green-400">{fmtE(e.gross_annual)}</span>
                        {e.net_annual && <span className="text-xs font-mono text-emerald-300">{fmtE(e.net_annual)} net</span>}
                      </div>
                      {/* Line 3: Year — period — job title */}
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-muted">
                        <span className="font-medium">{e.year}</span>
                        {period && <span>{period}</span>}
                        {e.job_title && <span className="truncate">· {e.job_title}</span>}
                      </div>
                    </div>
                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="px-3 pb-3 border-t border-border/50 pt-2 flex gap-2">
                        <button onClick={() => startEdit(e)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted hover:text-white bg-white/5 hover:bg-white/10 transition-colors"><Edit3 size={12} /> {t('edit')}</button>
                        <button onClick={() => handleDelete(e.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted hover:text-red-400 bg-white/5 hover:bg-red-500/10 transition-colors"><Trash2 size={12} /> {t('delete')}</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted text-xs border-b border-border">
                    <th className="text-left py-2 px-2">{t('year')}</th>
                    <th className="text-left py-2 px-2">{t('period')}</th>
                    <th className="text-left py-2 px-2">{t('employer')}</th>
                    <th className="text-left py-2 px-2">{t('job_title')}</th>
                    <th className="text-left py-2 px-2">{t('country')}</th>
                    <th className="text-right py-2 px-2">{t('gross_annual')}</th>
                    <th className="text-right py-2 px-2">{t('net_annual')}</th>
                    <th className="text-right py-2 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(e => {
                    const fmtE = e.country === 'CH' ? fmtCHF : fmt;
                    const period = e.start_date
                      ? `${e.start_date.slice(5)}${e.end_date ? ' → ' + e.end_date.slice(5) : ' → …'}`
                      : '—';
                    return (
                      <tr key={e.id} className="border-b border-border/50 hover:bg-surface-hover transition-colors">
                        <td className="py-2 px-2 font-medium">{e.year}</td>
                        <td className="py-2 px-2 text-xs text-muted">{period}</td>
                        <td className="py-2 px-2">
                          {e.employer}
                          {e.company_name && <span className="text-xs text-accent-400 ml-1">({e.company_name})</span>}
                        </td>
                        <td className="py-2 px-2 text-muted">{e.job_title || '—'}</td>
                        <td className="py-2 px-2">{countries.find(c => c.value === e.country)?.label || e.country}</td>
                        <td className="py-2 px-2 text-right font-mono font-medium text-green-400">{fmtE(e.gross_annual)}</td>
                        <td className="py-2 px-2 text-right font-mono text-emerald-300">{e.net_annual ? fmtE(e.net_annual) : '—'}</td>
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
          </>
        
        ) : (
          <p className="text-muted text-sm text-center py-4">{t('no_income_entries')}</p>
        )}

        {/* Salary progression chart */}
        {chartData.length > 1 && (
          <div className="mt-4">
            <h3 className="text-sm font-medium text-muted mb-2">{t('salary_progression')}</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="year" tick={{ fill: '#888', fontSize: 12 }} />
                <YAxis tick={{ fill: '#888', fontSize: 12 }} tickFormatter={v => `${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(v: any) => fmt(v)} contentStyle={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 8 }} />
                <Bar dataKey="total" fill="#6366f1" radius={[4, 4, 0, 0]} name="Salaire brut" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* ===== SECTION 2: Tax Estimation ===== */}
      <section className="bg-surface rounded-xl border border-border p-6 space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Calculator size={20} /> {t('tax_estimation')}
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div>
            <label className="text-xs text-muted mb-1 block">{t('gross_annual')}</label>
            <input type="number" value={taxInput.gross_annual} onChange={e => setTaxInput({ ...taxInput, gross_annual: e.target.value })}
              placeholder="55000" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">{t('country')}</label>
            <select value={taxInput.country} onChange={e => setTaxInput({ ...taxInput, country: e.target.value })}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm">
              <option value="FR">🇫🇷 France</option>
              <option value="CH">🇨🇭 Suisse</option>
            </select>
          </div>
          {taxInput.country === 'CH' && (
            <div>
              <label className="text-xs text-muted mb-1 block">{t('canton')}</label>
              <select value={taxInput.canton} onChange={e => setTaxInput({ ...taxInput, canton: e.target.value })}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm">
                {cantons.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-xs text-muted mb-1 block">{t('situation')}</label>
            <select value={taxInput.situation} onChange={e => setTaxInput({ ...taxInput, situation: e.target.value })}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm">
              <option value="single">{t('single')}</option>
              <option value="married">{t('married')}</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">{t('children')}</label>
            <input type="number" min={0} max={10} value={taxInput.children} onChange={e => setTaxInput({ ...taxInput, children: parseInt(e.target.value) || 0 })}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>

        <button onClick={estimateTax}
          className="px-4 py-2 bg-accent-500 text-white rounded-lg text-sm font-medium hover:bg-accent-600 transition-colors">
          {t('estimate')}
        </button>

        {taxResult && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-2">
            <div className="bg-background rounded-lg p-4 text-center">
              <p className="text-xs text-muted mb-1">{t('gross_annual')}</p>
              <p className="text-lg font-bold text-white">{fmtTax(taxResult.gross_annual)}</p>
            </div>
            <div className="bg-background rounded-lg p-4 text-center">
              <p className="text-xs text-muted mb-1">{t('estimated_tax')}</p>
              <p className="text-lg font-bold text-red-400">{fmtTax(taxResult.tax)}</p>
            </div>
            <div className="bg-background rounded-lg p-4 text-center">
              <p className="text-xs text-muted mb-1">{t('net_income')}</p>
              <p className="text-lg font-bold text-green-400">{fmtTax(taxResult.netIncome)}</p>
            </div>
            <div className="bg-background rounded-lg p-4 text-center">
              <p className="text-xs text-muted mb-1">{t('effective_rate')}</p>
              <p className="text-lg font-bold text-yellow-400">{taxResult.effectiveRate}%</p>
            </div>
          </div>
        )}
      </section>

      {/* ===== SECTION 3: Borrowing Capacity ===== */}
      <section className="bg-surface rounded-xl border border-border p-6 space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <CreditCard size={20} /> {t('borrowing_capacity')}
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-muted mb-1 block">{t('net_monthly_income')}</label>
            <input type="number" value={borrowInput.net_monthly} onChange={e => setBorrowInput({ ...borrowInput, net_monthly: e.target.value })}
              placeholder="3500" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">{t('existing_payments')}</label>
            <input type="number" value={borrowInput.existing_payments} onChange={e => setBorrowInput({ ...borrowInput, existing_payments: e.target.value })}
              placeholder="0" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">{t('interest_rate')} (%)</label>
            <input type="number" step="0.05" value={borrowInput.rate} onChange={e => setBorrowInput({ ...borrowInput, rate: e.target.value })}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">{t('duration_years')}</label>
            <input type="number" value={borrowInput.duration_years} onChange={e => setBorrowInput({ ...borrowInput, duration_years: e.target.value })}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>

        <button onClick={estimateBorrowing}
          className="px-4 py-2 bg-accent-500 text-white rounded-lg text-sm font-medium hover:bg-accent-600 transition-colors">
          {t('estimate')}
        </button>

        {borrowResult && (
          <div className="bg-background rounded-lg p-5 space-y-3 mt-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xs text-muted mb-1">{t('max_monthly_payment')}</p>
                <p className="text-lg font-bold text-white">{fmt(borrowResult.max_payment)}</p>
                <p className="text-xs text-muted">33% × {fmt(borrowResult.net_monthly)}</p>
              </div>
              <div>
                <p className="text-xs text-muted mb-1">{t('available_payment')}</p>
                <p className="text-lg font-bold text-yellow-400">{fmt(borrowResult.available_payment)}</p>
              </div>
              <div>
                <p className="text-xs text-muted mb-1">{t('max_borrowing')}</p>
                <p className="text-2xl font-bold text-green-400">{fmt(borrowResult.max_loan)}</p>
                <p className="text-xs text-muted">{t('over')} {borrowResult.duration_years} {t('years_at')} {borrowResult.rate}%</p>
              </div>
            </div>
            <p className="text-xs text-muted text-center mt-2">
              {t('borrowing_note')}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
