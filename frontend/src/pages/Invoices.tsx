import { API } from '../config';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, RefreshCw, CheckCircle, AlertTriangle, Link2, Unlink, Trash2, CloudOff, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthFetch } from '../useApi';

interface Invoice {
  id: number;
  filename: string;
  vendor: string | null;
  amount_ht: number | null;
  tva_amount: number | null;
  tva_rate: number | null;
  date: string | null;
  invoice_number: string | null;
  transaction_id: number | null;
  match_confidence: number | null;
  drive_file_id: string;
  scanned_at: string;
  tx_label?: string;
  tx_amount?: number;
  tx_date?: string;
}

interface Stats {
  total: number;
  matched: number;
  unmatched: number;
  match_rate: number;
}

export default function Invoices() {
  const { t: _t } = useTranslation();
  const navigate = useNavigate();
  const authFetch = useAuthFetch();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState<'all' | 'matched' | 'unmatched'>('all');
  const [scanResult, setScanResult] = useState<any>(null);
  const [driveStatus, setDriveStatus] = useState<any>(null);

  const load = useCallback(async () => {
    const matchParam = filter === 'all' ? '' : `?matched=${filter === 'matched'}`;
    const [invRes, statsRes, driveRes] = await Promise.all([
      authFetch(`${API}/invoices${matchParam}`),
      authFetch(`${API}/invoices/stats`),
      authFetch(`${API}/drive/status`),
    ]);
    setInvoices(await invRes.json());
    setStats(await statsRes.json());
    setDriveStatus(await driveRes.json());
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const scan = async () => {
    setScanning(true);
    setScanResult(null);
    try {
      const res = await authFetch(`${API}/invoices/scan`, { method: 'POST', body: '{}' });
      const data = await res.json();
      setScanResult(data);
      await load();
    } finally {
      setScanning(false);
    }
  };

  const deleteInvoice = async (id: number) => {
    await authFetch(`${API}/invoices/${id}`, { method: 'DELETE' });
    await load();
  };

  const unmatch = async (id: number) => {
    await authFetch(`${API}/invoices/${id}/unmatch`, { method: 'POST', body: '{}' });
    await load();
  };

  const fmt = (n: number | null) => n != null ? `${n.toFixed(2)} €` : '—';

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2 h-10">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => navigate('/more')} className="md:hidden text-muted hover:text-white transition-colors p-1 -ml-1 flex-shrink-0">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-semibold whitespace-nowrap">Justificatifs</h1>
        </div>
        <button
          onClick={scan}
          disabled={scanning || !driveStatus?.connected}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-500 text-white rounded-lg text-xs font-medium disabled:opacity-40 flex-shrink-0"
        >
          <RefreshCw size={14} className={scanning ? 'animate-spin' : ''} />
          {scanning ? 'Scan...' : 'Scanner'}
        </button>
      </div>

      {!driveStatus?.connected && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 mb-4 text-sm text-yellow-300 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <CloudOff size={16} className="shrink-0" />
            Drive non connecté
          </span>
          <button
            onClick={async () => {
              const res = await authFetch(`${API}/drive/connect`, { method: 'POST', body: '{}' });
              const data = await res.json();
              if (data.url) window.location.href = data.url;
              else await load();
            }}
            className="px-3 py-1.5 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-200 rounded-lg text-xs font-medium whitespace-nowrap transition-colors"
          >
            Lier Drive
          </button>
        </div>
      )}

      {scanResult && (
        <div className="bg-surface rounded-xl border border-border p-4 mb-4 text-sm">
          <p>✅ Scan terminé: {scanResult.scanned} nouveaux fichiers, {scanResult.matched} rapprochés</p>
          {scanResult.errors?.length > 0 && (
            <p className="text-red-400 mt-1">⚠️ {scanResult.errors.length} erreurs</p>
          )}
        </div>
      )}

      {/* Stats */}
      {stats && stats.total > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-surface rounded-xl border border-border p-4 text-center">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-xs text-muted">Total</div>
          </div>
          <div className="bg-surface rounded-xl border border-border p-4 text-center">
            <div className="text-2xl font-bold text-green-400">{stats.matched}</div>
            <div className="text-xs text-muted">Rapprochés</div>
          </div>
          <div className="bg-surface rounded-xl border border-border p-4 text-center">
            <div className="text-2xl font-bold text-yellow-400">{stats.unmatched}</div>
            <div className="text-xs text-muted">Non rapprochés</div>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {(['all', 'matched', 'unmatched'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-2.5 rounded-lg text-xs font-medium transition-colors min-h-[44px] ${
              filter === f ? 'bg-accent-500/20 text-accent-400' : 'bg-surface text-muted hover:text-foreground'
            }`}
          >
            {f === 'all' ? 'Tous' : f === 'matched' ? '✅ Rapprochés' : '⚠️ Manquants'}
          </button>
        ))}
      </div>

      {/* Invoice list */}
      <div className="space-y-2">
        {invoices.length === 0 && (
          <div className="bg-surface rounded-xl border border-border p-8 text-center text-muted">
            <Search size={32} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">Aucun justificatif trouvé. Lancez un scan pour commencer.</p>
          </div>
        )}
        {invoices.map(inv => (
          <div key={inv.id} className="bg-surface rounded-xl border border-border p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {inv.transaction_id ? (
                    <CheckCircle size={14} className="text-green-400 shrink-0" />
                  ) : (
                    <AlertTriangle size={14} className="text-yellow-400 shrink-0" />
                  )}
                  <span className="text-sm font-medium truncate">{inv.filename}</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  {inv.vendor && <span>🏢 {inv.vendor}</span>}
                  {inv.amount_ht != null && <span>💰 {fmt(inv.amount_ht)} HT</span>}
                  {inv.tva_amount != null && <span>📊 TVA {fmt(inv.tva_amount)}</span>}
                  {inv.date && <span>📅 {inv.date}</span>}
                  {inv.invoice_number && <span>📄 {inv.invoice_number}</span>}
                </div>
                {inv.transaction_id && inv.tx_label && (
                  <div className="mt-2 text-xs text-green-400/80 flex items-center gap-1">
                    <Link2 size={12} />
                    Lié à: {inv.tx_label} ({fmt(inv.tx_amount ?? null)}, {inv.tx_date})
                    {inv.match_confidence && <span className="ml-1 opacity-60">({Math.round(inv.match_confidence * 100)}%)</span>}
                  </div>
                )}
              </div>
              <div className="flex gap-1 ml-2 shrink-0">
                {inv.transaction_id && (
                  <button onClick={() => unmatch(inv.id)} className="p-1.5 rounded-lg hover:bg-surface-hover text-muted" title="Délier">
                    <Unlink size={14} />
                  </button>
                )}
                <button onClick={() => deleteInvoice(inv.id)} className="p-1.5 rounded-lg hover:bg-surface-hover text-red-400/60" title="Supprimer">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
