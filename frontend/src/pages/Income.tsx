import { API } from '../config';
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Plus, Trash2, Edit3, X, Check, TrendingUp, ChevronDown, ArrowLeft, FolderOpen, RefreshCw, Upload, FileText } from 'lucide-react';
import DriveFolderPickerModal from '../components/DriveFolderPickerModal';
import EyeToggle from '../components/EyeToggle';
import { useNavigate } from 'react-router-dom';
import { useApi, useAuthFetch } from '../useApi';
import { useAmountVisibility } from '../AmountVisibilityContext';

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

const BENCHMARK_COUNTRIES = [
  { value: 'FR', label: 'France', flag: '🇫🇷', currency: 'EUR' },
  { value: 'CH', label: 'Suisse', flag: '🇨🇭', currency: 'CHF' },
  { value: 'US', label: 'USA', flag: '🇺🇸', currency: 'USD' },
  { value: 'UK', label: 'UK', flag: '🇬🇧', currency: 'GBP' },
  { value: 'DE', label: 'Allemagne', flag: '🇩🇪', currency: 'EUR' },
];

// "Wealth app users" distribution — finance tracking app users skew higher (EUR equiv.)
const APP_USERS_PERCENTILES = [
  { p: 10, gross: 32000 }, { p: 25, gross: 48000 }, { p: 50, gross: 70000 },
  { p: 75, gross: 100000 }, { p: 90, gross: 145000 }, { p: 95, gross: 180000 }, { p: 99, gross: 280000 },
];

// Currency conversion (approximate, 1 unit = X EUR)
const RATE_TO_EUR: Record<string, number> = { EUR: 1, CHF: 1.04, USD: 0.92, GBP: 1.16 };
function toEUR(v: number, currency: string) { return v * (RATE_TO_EUR[currency] ?? 1); }
function fromEUR(v: number, currency: string) { return v / (RATE_TO_EUR[currency] ?? 1); }
function convertSalary(v: number, from: string, to: string) { return fromEUR(toEUR(v, from), to); }
function fmtCurrency(v: number, currency: string) {
  const locale = currency === 'USD' || currency === 'GBP' ? 'en-US' : 'fr-FR';
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
}

function getPercentile(gross: number, data: { p: number; gross: number }[]): number {
  if (gross <= data[0].gross) return Math.max(1, Math.round(data[0].p * gross / data[0].gross));
  if (gross >= data[data.length - 1].gross) return 99;
  for (let i = 0; i < data.length - 1; i++) {
    if (gross >= data[i].gross && gross < data[i + 1].gross) {
      const ratio = (gross - data[i].gross) / (data[i + 1].gross - data[i].gross);
      return Math.round(data[i].p + ratio * (data[i + 1].p - data[i].p));
    }
  }
  return 50;
}

export default function Income() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const authFetch = useAuthFetch();
  const { hideAmounts, toggleHideAmounts } = useAmountVisibility();
  const mask = (v: string) => hideAmounts ? <span className="amount-masked">{v}</span> : v;

  // Income tracking state - using cache
  const { data: incomeData, setData: setIncomeData } = useApi<{ entries: IncomeEntry[] }>(`${API}/income`);
  const { data: benchmarkDb } = useApi<Record<string, Record<number, { p: number; gross: number }[]>>>(`${API}/salary-benchmarks`);

  const entries = incomeData?.entries || [];

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ year: new Date().getFullYear(), employer: '', job_title: '', country: 'FR', gross_annual: '', net_annual: '', start_date: '', end_date: '' });
  const [expandedYears, setExpandedYears] = useState<Set<number> | null>(null); // null = default (last 3 years expanded)
  const [benchmarkCountry, setBenchmarkCountry] = useState<string | null>(null); // null = auto from entries

  // Collapsible sections
  const [incomeOpen, setIncomeOpen] = useState(true);

  const handleSave = async () => {
    const body = {
      ...form,
      gross_annual: parseFloat(form.gross_annual) || 0,
      net_annual: form.net_annual ? parseFloat(form.net_annual) : null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
    };
    if (!body.employer || !body.gross_annual) return;
    if (editId) {
      await authFetch(`${API}/income/${editId}`, { method: 'PUT', body: JSON.stringify(body) });
    } else {
      await authFetch(`${API}/income`, { method: 'POST', body: JSON.stringify(body) });
    }
    setShowForm(false);
    setEditId(null);
    setForm({ year: new Date().getFullYear(), employer: '', job_title: '', country: 'FR', gross_annual: '', net_annual: '', start_date: '', end_date: '' });
    // Refetch to update cache
    const updated = await authFetch(`${API}/income`).then(r => r.json());
    setIncomeData(updated);
  };

  const handleDeleteIncome = async (id: number) => {
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
    });
    setShowForm(true);
  };

  // Chart data: salary progression by year
  const chartData = useMemo(() => {
    const byYear: Record<number, number> = {};
    entries.forEach(e => { byYear[e.year] = (byYear[e.year] || 0) + e.gross_annual; });
    return Object.entries(byYear).sort(([a], [b]) => Number(a) - Number(b)).map(([year, total]) => ({ year: Number(year), total }));
  }, [entries]);

  const benchmarkData = useMemo(() => {
    if (entries.length === 0 || !benchmarkDb) return null;
    // Group entries by year, take last 3 years
    const byYear: Record<number, { total: number; country: string }> = {};
    entries.forEach(e => {
      if (!byYear[e.year]) byYear[e.year] = { total: 0, country: e.country };
      byYear[e.year].total += e.gross_annual;
    });
    const allYears = Object.keys(byYear).map(Number).sort((a, b) => b - a);
    const maxYear = allYears[0];
    const latestCountry = byYear[maxYear]?.country || 'FR';
    const incomeCurrency = latestCountry === 'CH' ? 'CHF' : 'EUR';
    // Selected benchmark country
    const autoCountry = BENCHMARK_COUNTRIES.some(c => c.value === latestCountry) ? latestCountry : 'FR';
    const selectedCountry = benchmarkCountry ?? autoCountry;
    const selectedConfig = BENCHMARK_COUNTRIES.find(c => c.value === selectedCountry)!;
    const benchCurrency = selectedConfig.currency;
    // Compute progression for last 3 years
    const progression = allYears.slice(0, 3).map(year => {
      const gross = byYear[year].total;
      const comparable = convertSalary(gross, incomeCurrency, benchCurrency);
      const yearData = benchmarkDb[selectedCountry]?.[year] ?? benchmarkDb[selectedCountry]?.[Math.max(...Object.keys(benchmarkDb[selectedCountry] || {}).map(Number))];
      if (!yearData) return null;
      const popPercentile = getPercentile(comparable, yearData);
      const appPercentile = getPercentile(toEUR(gross, incomeCurrency), APP_USERS_PERCENTILES);
      const median = yearData.find(d => d.p === 50)?.gross ?? yearData[Math.floor(yearData.length / 2)].gross;
      return { year, gross, comparable, benchCurrency, popPercentile, appPercentile, median };
    }).filter(Boolean) as { year: number; gross: number; comparable: number; benchCurrency: string; popPercentile: number; appPercentile: number; median: number }[];
    if (progression.length === 0) return null;
    const latest = progression[0];
    // CAGR & best YoY
    const yearTotals = allYears.map(y => ({ year: y, total: byYear[y].total })).sort((a, b) => a.year - b.year);
    let cagr: number | null = null;
    let bestYoY: { year: number; pct: number } | null = null;
    if (yearTotals.length >= 2) {
      const nYears = yearTotals[yearTotals.length - 1].year - yearTotals[0].year;
      if (nYears > 0) cagr = Math.round(((yearTotals[yearTotals.length - 1].total / yearTotals[0].total) ** (1 / nYears) - 1) * 1000) / 10;
      let best = { year: 0, pct: -Infinity };
      for (let i = 1; i < yearTotals.length; i++) {
        const pct = (yearTotals[i].total - yearTotals[i - 1].total) / yearTotals[i - 1].total * 100;
        if (pct > best.pct) best = { year: yearTotals[i].year, pct };
      }
      if (best.year > 0) bestYoY = { year: best.year, pct: Math.round(best.pct) };
    }
    return { latestYear: maxYear, selectedCountry, benchCurrency, incomeCurrency, progression, latest, cagr, bestYoY };
  }, [entries, benchmarkCountry, benchmarkDb]);

  // ===== PAYSLIPS STATE =====
  interface Payslip {
    id: number;
    year: number;
    month: number;
    drive_file_id: string | null;
    filename: string | null;
    gross: number | null;
    net: number | null;
    employer: string | null;
    status: string;
  }

  const currentYear = new Date().getFullYear();
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [driveConnected, setDriveConnected] = useState<boolean | null>(null);
  const [folderMapping, setFolderMapping] = useState<{ folder_id: string; folder_path: string | null } | null>(null);
  const [scanning, setScanning] = useState(false);

  // Folder picker state
  const [showFolderPicker, setShowFolderPicker] = useState(false);

  // Edit payslip state
  const [editingPayslip, setEditingPayslip] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ gross: '', net: '', employer: '' });

  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploadingMonth, setUploadingMonth] = useState<number | null>(null);

  const MONTH_KEYS = ['month_jan', 'month_feb', 'month_mar', 'month_apr', 'month_may', 'month_jun', 'month_jul', 'month_aug', 'month_sep', 'month_oct', 'month_nov', 'month_dec'];

  // Load Drive status + folder mapping + payslips for current year
  const loadPayslipsData = useCallback(async () => {
    try {
      const [statusRes, mappingRes, payslipsRes] = await Promise.all([
        authFetch(`${API}/drive/status`).then(r => r.json()),
        authFetch(`${API}/drive/folder-mapping?purpose=payslips`).then(r => r.json()),
        authFetch(`${API}/payslips?year=${currentYear}`).then(r => r.json()),
      ]);
      setDriveConnected(statusRes.connected);
      setFolderMapping(mappingRes.mapping);
      setPayslips(payslipsRes.payslips || []);
    } catch {
      setDriveConnected(false);
    }
  }, [currentYear]);

  useEffect(() => { loadPayslipsData(); }, [loadPayslipsData]);

  const handleFolderSelected = async (folderId: string | null, folderPath: string | null) => {
    await authFetch(`${API}/drive/folder-mapping`, {
      method: 'PUT',
      body: JSON.stringify({ purpose: 'payslips', folder_id: folderId, folder_path: folderPath }),
    });
    setFolderMapping(folderId ? { folder_id: folderId, folder_path: folderPath } : null);
    setShowFolderPicker(false);
    if (folderId) handleScan();
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      const res = await authFetch(`${API}/payslips/scan`, {
        method: 'POST',
        body: JSON.stringify({ year: currentYear }),
      });
      const data = await res.json();
      setPayslips(data.payslips || []);
    } catch {}
    setScanning(false);
  };

  const handleConfirm = async (payslip: Payslip) => {
    await authFetch(`${API}/payslips/${payslip.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'confirmed' }),
    });
    setPayslips(prev => prev.map(p => p.id === payslip.id ? { ...p, status: 'confirmed' } : p));
  };

  const handleEditSave = async (payslip: Payslip) => {
    await authFetch(`${API}/payslips/${payslip.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        gross: parseFloat(editForm.gross) || null,
        net: parseFloat(editForm.net) || null,
        employer: editForm.employer || null,
        status: 'confirmed',
      }),
    });
    setPayslips(prev => prev.map(p => p.id === payslip.id ? {
      ...p,
      gross: parseFloat(editForm.gross) || null,
      net: parseFloat(editForm.net) || null,
      employer: editForm.employer || null,
      status: 'confirmed',
    } : p));
    setEditingPayslip(null);
  };

  const handleDeletePayslip = async (id: number) => {
    await authFetch(`${API}/payslips/${id}`, { method: 'DELETE' });
    setPayslips(prev => prev.filter(p => p.id !== id));
  };

  const handleUpload = async (month: number, file: File) => {
    setUploadingMonth(month);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('year', String(currentYear));
      formData.append('month', String(month));

      const res = await authFetch(`${API}/payslips/upload`, {
        method: 'POST',
        body: formData as any,
      });
      const data = await res.json();
      if (data.payslip) {
        setPayslips(prev => {
          const existing = prev.findIndex(p => p.month === month);
          if (existing >= 0) return prev.map(p => p.month === month ? data.payslip : p);
          return [...prev, data.payslip].sort((a, b) => a.month - b.month);
        });
      }
    } catch {}
    setUploadingMonth(null);
  };

  // Payslip annual summary
  const payslipSummary = useMemo(() => {
    const confirmed = payslips.filter(p => p.status === 'confirmed' || p.status === 'extracted');
    if (confirmed.length === 0) return null;
    const totalGross = confirmed.reduce((s, p) => s + (p.gross || 0), 0);
    const totalNet = confirmed.reduce((s, p) => s + (p.net || 0), 0);
    return { count: confirmed.length, totalGross, totalNet };
  }, [payslips]);

  const countries = [
    { value: 'FR', label: '🇫🇷 France' },
    { value: 'CH', label: '🇨🇭 Suisse' },
    { value: 'OTHER', label: '🌍 Autre' },
  ];

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between gap-2 mb-3 h-10">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => navigate('/more')} className="md:hidden text-muted hover:text-white transition-colors p-1 -ml-1 flex-shrink-0">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-semibold whitespace-nowrap">{t('nav_income')}</h1>
          <EyeToggle hidden={hideAmounts} onToggle={toggleHideAmounts} />
        </div>
      </div>

      <div className="space-y-4">
      {/* ===== SECTION 1: Income Tracking ===== */}
      <section className="bg-surface rounded-xl border border-border p-4 space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2 cursor-pointer select-none" onClick={() => setIncomeOpen(!incomeOpen)}>
            <TrendingUp size={20} /> {t('income_tracking')}
            <ChevronDown size={16} className={`text-muted transition-transform ${incomeOpen ? '' : '-rotate-90'}`} />
          </h2>
          {incomeOpen && (
            <button
              onClick={() => { setShowForm(true); setEditId(null); setForm({ year: new Date().getFullYear(), employer: '', job_title: '', country: 'FR', gross_annual: '', net_annual: '', start_date: '', end_date: '' }); }}
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
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
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
                                  <button onClick={(ev) => { ev.stopPropagation(); handleDeleteIncome(e.id); }} className="p-1.5 text-muted hover:text-red-400"><Trash2 size={12} /></button>
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
                                    </td>
                                    <td className="py-2 px-2 text-muted">{e.job_title || '—'}</td>
                                    <td className="py-2 px-2">{countries.find(c => c.value === e.country)?.label || e.country}</td>
                                    <td className="py-2 px-2 text-right font-mono font-medium text-green-400">{mask(fmtE(e.gross_annual))}</td>
                                    <td className="py-2 px-2 text-right font-mono text-emerald-300">{e.net_annual ? mask(fmtE(e.net_annual)) : '—'}</td>
                                    <td className="py-2 px-2 text-right">
                                      <button onClick={() => startEdit(e)} className="p-1 text-muted hover:text-white"><Edit3 size={14} /></button>
                                      <button onClick={() => handleDeleteIncome(e.id)} className="p-1 text-muted hover:text-red-400 ml-1"><Trash2 size={14} /></button>
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
                <Bar dataKey="total" fill="#6366f1" radius={[4, 4, 0, 0]} name={t('gross_annual')} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        </>)}
      </section>

      {/* ===== SECTION 2: Salary Benchmark ===== */}
      {benchmarkData && (
        <section className="bg-surface rounded-xl border border-border p-4 space-y-4">
          {/* Header + country selector */}
          <div className="space-y-3">
            <div>
              <h2 className="text-base font-semibold">Positionnement salarial</h2>
              <p className="text-xs text-muted mt-0.5">Progression sur les {benchmarkData.progression.length} dernières années</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {BENCHMARK_COUNTRIES.map(c => (
                <button
                  key={c.value}
                  onClick={() => setBenchmarkCountry(c.value)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    benchmarkData.selectedCountry === c.value
                      ? 'bg-accent-500 text-white'
                      : 'bg-surface-hover text-muted hover:text-white'
                  }`}
                >
                  {c.flag} {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* 3-year progression */}
          <div className="space-y-4">
            {benchmarkData.progression.map((p, i) => (
              <div key={p.year} className={i > 0 ? 'pt-4 border-t border-border/40' : ''}>
                <div className="flex items-baseline justify-between mb-3">
                  <span className="text-sm font-semibold text-white">{p.year}</span>
                  <span className="text-xs text-muted font-mono">{mask(fmtCurrency(p.gross, benchmarkData.incomeCurrency))}</span>
                </div>

                {/* Slider: vs Population */}
                <div className="mb-3">
                  <div className="flex justify-between items-baseline mb-1.5">
                    <span className="text-xs text-muted">
                      {BENCHMARK_COUNTRIES.find(c => c.value === benchmarkData.selectedCountry)?.flag} Population {BENCHMARK_COUNTRIES.find(c => c.value === benchmarkData.selectedCountry)?.label}
                    </span>
                    <span className="text-base font-bold text-white leading-none">Top {100 - p.popPercentile}%</span>
                  </div>
                  <div className="relative h-1.5 rounded-full" style={{ background: 'linear-gradient(to right, #ef4444 0%, #f59e0b 35%, #22c55e 70%, #16a34a 100%)' }}>
                    <div
                      className="absolute top-1/2 w-3 h-3 bg-white rounded-full border-2 border-gray-800 shadow"
                      style={{ left: `${Math.min(Math.max(p.popPercentile, 2), 98)}%`, transform: 'translateX(-50%) translateY(-50%)' }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-muted mt-1">
                    <span>Bas</span>
                    <span>Médiane {fmtCurrency(p.median, p.benchCurrency)}</span>
                    <span>Haut</span>
                  </div>
                </div>

                {/* Slider: vs App users */}
                <div>
                  <div className="flex justify-between items-baseline mb-1.5">
                    <span className="text-xs text-muted">Utilisateurs de l'app</span>
                    <span className="text-base font-bold text-white leading-none">Top {100 - p.appPercentile}%</span>
                  </div>
                  <div className="relative h-1.5 rounded-full" style={{ background: 'linear-gradient(to right, #ef4444 0%, #f59e0b 35%, #22c55e 70%, #16a34a 100%)' }}>
                    <div
                      className="absolute top-1/2 w-3 h-3 bg-white rounded-full border-2 border-gray-800 shadow"
                      style={{ left: `${Math.min(Math.max(p.appPercentile, 2), 98)}%`, transform: 'translateX(-50%) translateY(-50%)' }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-muted mt-1">
                    <span>Bas</span>
                    <span>Médiane ~{fmtCurrency(70000, 'EUR')}</span>
                    <span>Haut</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Stat cards */}
          <div className={`grid gap-3 ${benchmarkData.cagr !== null && benchmarkData.bestYoY ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {benchmarkData.cagr !== null && (
              <div className="bg-surface-hover rounded-xl p-3 text-center">
                <div className={`text-xl font-bold ${benchmarkData.cagr >= 0 ? 'text-green-400' : 'text-orange-400'}`}>
                  {benchmarkData.cagr >= 0 ? '+' : ''}{benchmarkData.cagr}%<span className="text-sm font-normal">/an</span>
                </div>
                <div className="text-xs text-muted mt-0.5">Croissance (CAGR)</div>
              </div>
            )}
            {benchmarkData.bestYoY && (
              <div className="bg-surface-hover rounded-xl p-3 text-center">
                <div className="text-xl font-bold text-indigo-400">
                  {benchmarkData.bestYoY.pct >= 0 ? '+' : ''}{benchmarkData.bestYoY.pct}%
                </div>
                <div className="text-xs text-muted mt-0.5">Meilleure année ({benchmarkData.bestYoY.year})</div>
              </div>
            )}
          </div>

          <p className="text-[10px] text-muted/60">
            Source : INSEE / OFS / BLS / ONS / Destatis — salaires bruts annuels
          </p>
        </section>
      )}

      {/* ===== Fiches de paie (current year only, Drive connected) ===== */}
      {driveConnected && (
        <section className="bg-surface rounded-xl border border-border overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3">
            <FileText size={18} className="text-accent-400 flex-shrink-0" />
            <div className="flex-1 text-left min-w-0">
              <span className="text-sm font-medium">{t('payslips')} {currentYear}</span>
              {payslipSummary && (
                <span className="text-xs text-muted ml-2">
                  {payslipSummary.count}/12 {t('months').toLowerCase()} · {mask(fmt(payslipSummary.totalGross))} {t('gross').toLowerCase()}
                </span>
              )}
            </div>
            {!folderMapping && (
              <button onClick={() => setShowFolderPicker(true)} className="flex items-center gap-1.5 text-xs text-accent-400 hover:text-accent-300 px-3 py-1.5 rounded-lg bg-accent-500/10 flex-shrink-0">
                <FolderOpen size={14} /> {t('choose')}
              </button>
            )}
          </div>

          {(folderMapping || showFolderPicker) && (
            <div className="px-4 pb-4 space-y-3 border-t border-border/50">

              {/* Folder picker */}
              {showFolderPicker && (
                <DriveFolderPickerModal
                  authFetch={authFetch}
                  onSelect={handleFolderSelected}
                  onClose={() => setShowFolderPicker(false)}
                />
              )}

              {/* Folder selected → monthly grid */}
              {folderMapping && (
                <>
                  {/* Toolbar */}
                  <div className="flex items-center gap-2 pt-3 text-xs text-muted">
                    <FolderOpen size={13} className="text-accent-400/60" />
                    <span className="truncate flex-1">{folderMapping.folder_path || folderMapping.folder_id}</span>
                    <button onClick={() => setShowFolderPicker(true)} className="text-accent-400/70 hover:text-accent-300">{t('change')}</button>
                    <button
                      onClick={handleScan}
                      disabled={scanning}
                      className="flex items-center gap-1 text-accent-400 hover:text-accent-300 disabled:opacity-50 px-2 py-1 rounded bg-accent-500/10"
                    >
                      <RefreshCw size={12} className={scanning ? 'animate-spin' : ''} /> {t('scan')}
                    </button>
                  </div>

                  {/* Monthly rows */}
                  <div className="space-y-0.5">
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(month => {
                      const payslip = payslips.find(p => p.month === month);
                      const isFuture = month > new Date().getMonth() + 1;
                      const isEditing = editingPayslip === payslip?.id;

                      if (isFuture && !payslip) return (
                        <div key={month} className="flex items-center gap-2 px-3 py-2 opacity-25">
                          <span className="text-xs font-medium w-16 text-muted">{t(MONTH_KEYS[month - 1])}</span>
                          <span className="text-xs text-muted/50 flex-1">—</span>
                        </div>
                      );

                      if (isEditing && payslip) return (
                        <div key={month} className="bg-surface-hover rounded-lg px-3 py-2.5 space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium w-16">{t(MONTH_KEYS[month - 1])}</span>
                            <span className="text-[11px] text-muted truncate">{payslip.filename}</span>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <input type="number" value={editForm.gross} onChange={e => setEditForm(f => ({ ...f, gross: e.target.value }))}
                              className="bg-background border border-border rounded px-2 py-1 text-xs" placeholder={t('gross')} />
                            <input type="number" value={editForm.net} onChange={e => setEditForm(f => ({ ...f, net: e.target.value }))}
                              className="bg-background border border-border rounded px-2 py-1 text-xs" placeholder={t('net')} />
                            <input type="text" value={editForm.employer} onChange={e => setEditForm(f => ({ ...f, employer: e.target.value }))}
                              className="bg-background border border-border rounded px-2 py-1 text-xs" placeholder={t('employer')} />
                          </div>
                          <div className="flex gap-2 justify-end">
                            <button onClick={() => setEditingPayslip(null)} className="text-[11px] text-muted hover:text-white px-2 py-0.5">{t('cancel')}</button>
                            <button onClick={() => handleEditSave(payslip)} className="text-[11px] text-accent-400 hover:text-accent-300 px-2 py-0.5">OK</button>
                          </div>
                        </div>
                      );

                      if (payslip) return (
                        <div key={month} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-hover hover:bg-white/[0.04] transition-colors">
                          <span className="text-xs font-medium w-16 flex-shrink-0">{t(MONTH_KEYS[month - 1])}</span>
                          <span className="text-[11px] text-muted truncate flex-1 min-w-0">{payslip.filename || '—'}</span>
                          <span className="text-xs font-mono text-green-400 flex-shrink-0">{payslip.gross ? mask(fmt(payslip.gross)) : '—'}</span>
                          <span className="text-xs font-mono text-emerald-300 flex-shrink-0 hidden sm:block">{payslip.net ? mask(fmt(payslip.net)) : '—'}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                            payslip.status === 'confirmed' ? 'bg-green-500/20 text-green-400' :
                            payslip.status === 'extracted' ? 'bg-amber-500/20 text-amber-400' :
                            'bg-white/10 text-muted'
                          }`}>
                            {payslip.status === 'confirmed' ? t('confirmed') : payslip.status === 'extracted' ? t('extracted') : '?'}
                          </span>
                          <div className="flex items-center flex-shrink-0">
                            {payslip.status !== 'confirmed' && (
                              <button onClick={() => handleConfirm(payslip)} className="p-0.5 text-green-400/70 hover:text-green-300"><Check size={13} /></button>
                            )}
                            <button
                              onClick={() => { setEditingPayslip(payslip.id); setEditForm({ gross: String(payslip.gross || ''), net: String(payslip.net || ''), employer: payslip.employer || '' }); }}
                              className="p-0.5 text-muted hover:text-white"
                            ><Edit3 size={13} /></button>
                            <button onClick={() => handleDeletePayslip(payslip.id)} className="p-0.5 text-muted hover:text-red-400"><Trash2 size={13} /></button>
                          </div>
                        </div>
                      );

                      // Missing month (past, no payslip)
                      return (
                        <div key={month} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-hover/50 transition-colors">
                          <span className="text-xs font-medium w-16 flex-shrink-0 text-muted/60">{t(MONTH_KEYS[month - 1])}</span>
                          <span className="text-[11px] text-muted/30 flex-1">—</span>
                          <button
                            onClick={() => { if (uploadRef.current) { setUploadingMonth(month); uploadRef.current.click(); } }}
                            className="flex items-center gap-1 text-[11px] text-muted/50 hover:text-accent-400 transition-colors"
                          >
                            <Upload size={11} /> {t('add')}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Hidden upload input */}
                  <input ref={uploadRef} type="file" accept=".pdf" className="hidden"
                    onChange={(e) => { const file = e.target.files?.[0]; if (file && uploadingMonth) handleUpload(uploadingMonth, file); e.target.value = ''; }}
                  />

                  {/* Summary */}
                  {payslipSummary && (
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/40">
                      <div className="text-center py-2">
                        <div className="text-[11px] text-muted">{t('months')}</div>
                        <div className="text-sm font-bold">{payslipSummary.count}/12</div>
                      </div>
                      <div className="text-center py-2">
                        <div className="text-[11px] text-muted">{t('gross_annual_total')}</div>
                        <div className="text-sm font-bold font-mono text-green-400">{mask(fmt(payslipSummary.totalGross))}</div>
                      </div>
                      <div className="text-center py-2">
                        <div className="text-[11px] text-muted">{t('net_annual_total')}</div>
                        <div className="text-sm font-bold font-mono text-emerald-300">{mask(fmt(payslipSummary.totalNet))}</div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      )}
      </div>
    </div>
  );
}
