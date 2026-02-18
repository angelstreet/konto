import { useState, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Upload, FileText, Check, AlertTriangle } from 'lucide-react';
import { API } from '../config';
import { useAuthFetch } from '../useApi';

interface CsvRow {
  date: string;       // YYYY-MM-DD
  amount: number;
  label: string;
  raw: string;        // original line for preview
}

interface Account {
  id: number;
  name: string;
  bank_name: string;
  type: string;
}

// Detect CSV format from header and first data rows
function parseCsv(text: string): { rows: CsvRow[]; format: string; error?: string } {
  // Normalize line endings
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) return { rows: [], format: 'unknown', error: 'File too short' };

  const header = lines[0];

  // Detect separator
  const sep = header.includes(';') ? ';' : header.includes('\t') ? '\t' : ',';

  const cols = header.split(sep).map(c => c.trim().toLowerCase().replace(/[éè]/g, 'e').replace(/[àâ]/g, 'a'));

  // Try to detect known formats
  // CIC format: Banque;Libellé Compte;RIB;Date opération;Libellé opération;Montant;Devise
  const dateCol = cols.findIndex(c => c.includes('date'));
  const amountCol = cols.findIndex(c => c.includes('montant') || c.includes('amount') || c.includes('debit') || c.includes('credit'));
  const labelCol = cols.findIndex(c => c.includes('libelle') || c.includes('label') || c.includes('description') || c.includes('wording'));

  if (dateCol === -1 || amountCol === -1) {
    // Try to detect debit/credit columns separately
    const debitCol = cols.findIndex(c => c.includes('debit'));
    const creditCol = cols.findIndex(c => c.includes('credit'));

    if (dateCol === -1) return { rows: [], format: 'unknown', error: `Cannot find date column. Headers: ${cols.join(', ')}` };
    if (amountCol === -1 && debitCol === -1 && creditCol === -1) {
      return { rows: [], format: 'unknown', error: `Cannot find amount column. Headers: ${cols.join(', ')}` };
    }

    // Debit/Credit format
    const rows: CsvRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const fields = lines[i].split(sep);
      if (fields.length < Math.max(dateCol, debitCol, creditCol, labelCol) + 1) continue;

      const date = parseDate(fields[dateCol].trim());
      if (!date) continue;

      const debit = debitCol >= 0 ? parseAmount(fields[debitCol]) : 0;
      const credit = creditCol >= 0 ? parseAmount(fields[creditCol]) : 0;
      const amount = credit - debit; // debit is negative, credit is positive

      rows.push({
        date,
        amount: Math.round(amount * 100) / 100,
        label: labelCol >= 0 ? fields[labelCol].trim() : '',
        raw: lines[i],
      });
    }
    return { rows, format: 'debit/credit' };
  }

  const format = cols.join(sep).includes('banque') ? 'CIC' :
    cols.join(sep).includes('rib') ? 'CIC' : 'generic';

  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = lines[i].split(sep);
    if (fields.length < Math.max(dateCol, amountCol, labelCol) + 1) continue;

    const date = parseDate(fields[dateCol].trim());
    if (!date) continue;

    const amount = parseAmount(fields[amountCol]);
    rows.push({
      date,
      amount: Math.round(amount * 100) / 100,
      label: labelCol >= 0 ? fields[labelCol].trim() : '',
      raw: lines[i],
    });
  }

  return { rows, format };
}

function parseDate(s: string): string | null {
  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  // YYYY-MM-DD
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) return s;
  // YYYY/MM/DD
  const ymd2 = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (ymd2) return `${ymd2[1]}-${ymd2[2]}-${ymd2[3]}`;
  return null;
}

function parseAmount(s: string): number {
  // Handle French format: -23,470 (comma as decimal sep)
  // Also handle: -1 234,56 (space as thousands sep)
  let cleaned = s.trim().replace(/[€$\s]/g, '');
  // If has both . and , → determine which is decimal
  if (cleaned.includes(',') && cleaned.includes('.')) {
    // Last separator is decimal: 1.234,56 or 1,234.56
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    if (lastComma > lastDot) {
      // 1.234,56 → comma is decimal
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // 1,234.56 → dot is decimal
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes(',')) {
    // Only comma: could be decimal (23,47) or thousands (1,234)
    // If 3 digits after comma, it's decimal with 3 places (CIC format: -23,470)
    cleaned = cleaned.replace(',', '.');
  }
  return parseFloat(cleaned) || 0;
}

export default function Import() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const authFetch = useAuthFetch();
  const fileRef = useRef<HTMLInputElement>(null);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<number | null>(null);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [format, setFormat] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number; total: number } | null>(null);
  const [fileName, setFileName] = useState('');

  // Load accounts on mount
  useState(() => {
    authFetch(`${API}/bank-accounts`).then(r => r.json()).then((data: Account[]) => {
      setAccounts(data.filter(a => a.type === 'checking'));
    }).catch(() => {});
  });

  const handleFile = async (file: File) => {
    setError('');
    setResult(null);
    setFileName(file.name);

    // Try different encodings
    let text: string;
    try {
      // First try UTF-8
      text = await file.text();
      // If garbled (replacement chars), try Latin-1
      if (text.includes('�') || text.includes('\ufffd')) {
        const buf = await file.arrayBuffer();
        text = new TextDecoder('iso-8859-1').decode(buf);
      }
    } catch {
      text = await file.text();
    }

    const { rows, format: fmt, error: err } = parseCsv(text);
    if (err) {
      setError(err);
      setCsvRows([]);
      return;
    }
    setCsvRows(rows);
    setFormat(fmt);
  };

  const handleImport = async () => {
    if (!selectedAccount || csvRows.length === 0) return;
    setImporting(true);
    setError('');
    try {
      const res = await authFetch(`${API}/import/csv`, {
        method: 'POST',
        body: JSON.stringify({
          account_id: selectedAccount,
          rows: csvRows.map(r => ({ date: r.date, amount: r.amount, label: r.label })),
        }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setResult(data);
      }
    } catch (e: any) {
      setError(e.message);
    }
    setImporting(false);
  };

  const summary = useMemo(() => {
    if (csvRows.length === 0) return null;
    const income = csvRows.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0);
    const expenses = csvRows.filter(r => r.amount < 0).reduce((s, r) => s + r.amount, 0);
    const dates = csvRows.map(r => r.date).sort();
    return {
      count: csvRows.length,
      income: Math.round(income * 100) / 100,
      expenses: Math.round(expenses * 100) / 100,
      from: dates[0],
      to: dates[dates.length - 1],
    };
  }, [csvRows]);

  const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 h-10">
        <button onClick={() => navigate('/more')} className="md:hidden text-muted hover:text-white transition-colors p-1 -ml-1 flex-shrink-0">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-semibold whitespace-nowrap">{t('nav_import')}</h1>
      </div>

      {/* Step 1: Select account */}
      <div className="bg-surface rounded-xl border border-border p-4 mb-3">
        <label className="text-xs text-muted mb-2 block">{t('account')}</label>
        <select
          value={selectedAccount || ''}
          onChange={e => setSelectedAccount(Number(e.target.value) || null)}
          className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm"
        >
          <option value="">{t('select_account_to_link')}</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.name} {a.bank_name ? `(${a.bank_name})` : ''}</option>
          ))}
        </select>
      </div>

      {/* Step 2: Upload CSV */}
      <div className="bg-surface rounded-xl border border-border p-4 mb-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={!selectedAccount}
            className="flex items-center gap-2 px-4 py-2.5 bg-accent-500/15 text-accent-400 rounded-lg text-sm font-medium hover:bg-accent-500/25 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Upload size={16} /> {t('upload')} CSV
          </button>
          {fileName && (
            <div className="flex items-center gap-2 text-sm text-muted">
              <FileText size={14} />
              <span className="truncate max-w-[200px]">{fileName}</span>
              {format && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10">{format}</span>}
            </div>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt,.tsv"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = '';
          }}
        />
        <p className="text-[11px] text-muted/60 mt-2">
          CIC, BNP, SG, La Banque Postale, Boursorama, N26... (CSV, ;/,/tab)
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-3 text-sm text-red-400">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* Preview */}
      {summary && !result && (
        <div className="bg-surface rounded-xl border border-border overflow-hidden mb-3">
          <div className="grid grid-cols-4 gap-2 p-4 border-b border-border/50">
            <div className="text-center">
              <div className="text-[11px] text-muted">{t('transactions')}</div>
              <div className="text-sm font-bold">{summary.count}</div>
            </div>
            <div className="text-center">
              <div className="text-[11px] text-muted">{t('period')}</div>
              <div className="text-sm font-bold">{summary.from} → {summary.to}</div>
            </div>
            <div className="text-center">
              <div className="text-[11px] text-muted text-green-400">{t('revenue')}</div>
              <div className="text-sm font-bold font-mono text-green-400">{fmt(summary.income)}</div>
            </div>
            <div className="text-center">
              <div className="text-[11px] text-muted text-red-400">{t('expenses')}</div>
              <div className="text-sm font-bold font-mono text-red-400">{fmt(summary.expenses)}</div>
            </div>
          </div>

          {/* Rows preview (first 20) */}
          <div className="max-h-[300px] overflow-y-auto">
            {csvRows.slice(0, 50).map((row, i) => (
              <div key={i} className="flex items-center gap-2 px-4 py-2 text-xs border-b border-border/20 hover:bg-surface-hover/50">
                <span className="text-muted w-20 flex-shrink-0">{row.date}</span>
                <span className="truncate flex-1 min-w-0">{row.label}</span>
                <span className={`font-mono flex-shrink-0 ${row.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {fmt(row.amount)}
                </span>
              </div>
            ))}
            {csvRows.length > 50 && (
              <div className="text-center text-xs text-muted py-2">
                +{csvRows.length - 50} more...
              </div>
            )}
          </div>

          {/* Import button */}
          <div className="p-4 border-t border-border/50">
            <button
              onClick={handleImport}
              disabled={importing || !selectedAccount}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-accent-500 text-white rounded-lg text-sm font-medium hover:bg-accent-600 transition-colors disabled:opacity-50"
            >
              {importing ? (
                <span className="animate-pulse">{t('loading')}</span>
              ) : (
                <><Check size={16} /> {t('confirm')} — {summary.count} transactions</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-surface rounded-xl border border-green-500/30 p-4 text-center">
          <Check size={32} className="mx-auto text-green-400 mb-2" />
          <div className="text-sm font-medium mb-1">
            {result.imported} imported, {result.skipped} skipped (duplicates)
          </div>
          <div className="text-xs text-muted">
            {result.total} total rows processed
          </div>
          <button
            onClick={() => { setCsvRows([]); setResult(null); setFileName(''); }}
            className="mt-3 text-xs text-accent-400 hover:text-accent-300"
          >
            {t('upload')} another file
          </button>
        </div>
      )}
    </div>
  );
}
