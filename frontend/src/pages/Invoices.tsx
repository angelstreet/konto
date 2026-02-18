import { API } from '../config';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, RefreshCw, CheckCircle, AlertTriangle, Link2, Unlink, Trash2, CloudOff, ArrowLeft, FolderOpen, Folder, ChevronRight, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthFetch, useApi } from '../useApi';

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

interface Company {
  id: number;
  name: string;
}

export default function Invoices() {
  const { t: _t } = useTranslation();
  const navigate = useNavigate();
  const authFetch = useAuthFetch();
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(() => {
    const stored = localStorage.getItem('konto_invoices_company');
    if (!stored) return null;
    const num = parseInt(stored, 10);
    return isNaN(num) ? null : num;
  });
  const { data: companies } = useApi<Company[]>(`${API}/companies`);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanDone, setScanDone] = useState(false);
  const [filter, setFilter] = useState<'all' | 'matched' | 'unmatched'>('all');
  const [scanResult, setScanResult] = useState<any>(null);
  const [driveStatus, setDriveStatus] = useState<any>(null);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [folders, setFolders] = useState<any[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<Array<{id: string | null, name: string}>>([{id: null, name: 'Mon Drive'}]);

  const load = useCallback(async () => {
    const matchParam = filter === 'all' ? '' : `?matched=${filter === 'matched'}`;
    const driveParam = selectedCompanyId ? `?company_id=${selectedCompanyId}` : '';
    const [invRes, statsRes, driveRes] = await Promise.all([
      authFetch(`${API}/invoices${matchParam}`),
      authFetch(`${API}/invoices/stats`),
      authFetch(`${API}/drive/status${driveParam}`),
    ]);
    setInvoices(await invRes.json());
    setStats(await statsRes.json());
    setDriveStatus(await driveRes.json());
  }, [filter, selectedCompanyId]);

  useEffect(() => { load(); }, [load]);

  const scan = async () => {
    setScanning(true);
    setScanDone(false);
    setScanResult(null);
    try {
      const res = await authFetch(`${API}/invoices/scan`, {
        method: 'POST',
        body: JSON.stringify({ company_id: selectedCompanyId })
      });
      const data = await res.json();
      setScanResult(data);
      await load();
      setScanDone(true);
      setTimeout(() => setScanDone(false), 30000);
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

  const loadFolders = async (parentId: string | null = null, parentName: string = 'Mon Drive') => {
    setLoadingFolders(true);
    try {
      const companyParam = selectedCompanyId ? `company_id=${selectedCompanyId}` : '';
      const parentParam = parentId ? `parent_id=${parentId}` : '';
      const params = [companyParam, parentParam].filter(Boolean).join('&');
      const url = `${API}/drive/folders${params ? '?' + params : ''}`;

      const res = await authFetch(url);
      const data = await res.json();
      setFolders(data.folders || []);
      setCurrentFolderId(parentId);

      // Update breadcrumb path
      if (parentId) {
        const existingIndex = folderPath.findIndex(f => f.id === parentId);
        if (existingIndex >= 0) {
          setFolderPath(folderPath.slice(0, existingIndex + 1));
        } else {
          setFolderPath([...folderPath, { id: parentId, name: parentName }]);
        }
      } else {
        setFolderPath([{ id: null, name: 'Mon Drive' }]);
      }

      setShowFolderPicker(true);
    } catch (err) {
      console.error('Failed to load folders:', err);
    } finally {
      setLoadingFolders(false);
    }
  };

  const navigateToFolder = (folderId: string | null, folderName: string) => {
    loadFolders(folderId, folderName);
  };

  const selectFolder = async (folderId: string | null, folderName: string | null) => {
    try {
      // Build full path for display
      const fullPath = folderId ? folderPath.map(f => f.name).join(' / ') : null;

      await authFetch(`${API}/drive/folder`, {
        method: 'PATCH',
        body: JSON.stringify({
          company_id: selectedCompanyId,
          folder_id: folderId,
          folder_name: fullPath
        })
      });
      setShowFolderPicker(false);
      setFolderPath([{ id: null, name: 'Mon Drive' }]);
      setCurrentFolderId(null);
      await load();
      scan();
    } catch (err) {
      console.error('Failed to update folder:', err);
    }
  };

  const disconnectDrive = async () => {
    if (!confirm(`Déconnecter Drive pour ${companyName} ?`)) return;
    try {
      const param = selectedCompanyId ? `?company_id=${selectedCompanyId}` : '';
      await authFetch(`${API}/drive/disconnect${param}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      console.error('Failed to disconnect:', err);
    }
  };

  const fmt = (n: number | null) => n != null ? `${n.toFixed(2)} €` : '—';

  const selectedCompany = companies?.find(c => c.id === selectedCompanyId);
  const companyName = selectedCompany?.name || 'Personnel';

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2 h-10">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => navigate('/more')} className="md:hidden text-muted hover:text-white transition-colors p-1 -ml-1 flex-shrink-0">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-semibold whitespace-nowrap">Justificatifs</h1>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <select
            value={selectedCompanyId || ''}
            onChange={(e) => {
              const id = e.target.value ? parseInt(e.target.value) : null;
              if (id === null) localStorage.removeItem('konto_invoices_company');
              else localStorage.setItem('konto_invoices_company', String(id));
              setSelectedCompanyId(id);
            }}
            className="text-xs px-2 py-1.5 bg-surface border border-border rounded-lg"
          >
            <option value="">Personnel</option>
            {companies?.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            onClick={scan}
            disabled={scanning || scanDone || !driveStatus?.connected}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0 transition-colors ${
              scanDone
                ? 'bg-green-500 text-white'
                : 'bg-accent-500 text-white disabled:opacity-40'
            }`}
          >
            {scanDone
              ? <><Check size={14} />Terminé</>
              : scanning
                ? <><RefreshCw size={14} className="animate-spin" />Scan en cours...</>
                : <><RefreshCw size={14} />Scanner</>
            }
          </button>
        </div>
      </div>

      {!driveStatus?.connected && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 mb-4 text-sm text-yellow-300 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <CloudOff size={16} className="shrink-0" />
            Drive non connecté pour {companyName}
          </span>
          <button
            onClick={async () => {
              const res = await authFetch(`${API}/drive/connect`, {
                method: 'POST',
                body: JSON.stringify({ company_id: selectedCompanyId, return_to: window.location.pathname })
              });
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

      {driveStatus?.connected && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-3 mb-4 text-sm text-green-300 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 min-w-0 truncate">
            <FolderOpen size={14} className="shrink-0" />
            <span className="truncate">{driveStatus.folder_path || 'Tous les dossiers'}</span>
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => loadFolders()}
              disabled={loadingFolders}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 text-green-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors disabled:opacity-40"
              title="Changer le dossier"
            >
              <Folder size={13} />
              <span className="hidden sm:inline">{loadingFolders ? '...' : 'Dossier'}</span>
            </button>
            <button
              onClick={disconnectDrive}
              className="p-1.5 rounded-lg text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Déconnecter Drive"
            >
              <Unlink size={14} />
            </button>
          </div>
        </div>
      )}

      {scanResult && (scanResult.scanned > 0 || scanResult.matched > 0 || scanResult.errors?.length > 0) && (
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

      {/* Folder Picker Modal */}
      {showFolderPicker && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowFolderPicker(false)}>
          <div className="bg-surface rounded-xl border border-border p-3 max-w-sm w-full max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1 text-xs text-muted overflow-x-auto">
                {folderPath.map((folder, idx) => (
                  <div key={folder.id || 'root'} className="flex items-center gap-0.5 shrink-0">
                    {idx > 0 && <ChevronRight size={12} className="text-muted/50" />}
                    <button
                      onClick={() => navigateToFolder(folder.id, folder.name)}
                      className={idx === folderPath.length - 1 ? 'text-white font-medium' : 'hover:text-white transition-colors'}
                    >
                      {folder.name}
                    </button>
                  </div>
                ))}
              </div>
              <button onClick={() => { setShowFolderPicker(false); setFolderPath([{id: null, name: 'Mon Drive'}]); }} className="text-muted hover:text-white p-1 ml-2 shrink-0 text-sm leading-none">✕</button>
            </div>

            <div className="overflow-auto flex-1 -mx-1">
              {/* Select current folder / all folders */}
              {currentFolderId ? (
                <button
                  onClick={() => selectFolder(currentFolderId, folderPath[folderPath.length - 1].name)}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-accent-500/10 text-accent-400 text-xs font-medium transition-colors flex items-center gap-2"
                >
                  <CheckCircle size={12} className="shrink-0" />
                  Sélectionner ce dossier
                </button>
              ) : (
                <button
                  onClick={() => selectFolder(null, null)}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-white/5 text-xs text-muted hover:text-white transition-colors flex items-center gap-2"
                >
                  <Folder size={12} className="shrink-0" />
                  Tous les dossiers
                </button>
              )}

              {/* Folder list */}
              {loadingFolders && (
                <div className="text-center text-muted py-6 text-xs">Chargement...</div>
              )}
              {!loadingFolders && folders.length === 0 && (
                <div className="text-center text-muted py-6 text-xs">Aucun sous-dossier</div>
              )}
              {folders.map((folder: any) => (
                <button
                  key={folder.id}
                  onClick={() => navigateToFolder(folder.id, folder.name)}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-white/5 transition-colors flex items-center justify-between group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FolderOpen size={12} className="shrink-0 text-muted group-hover:text-white transition-colors" />
                    <span className="text-xs truncate">{folder.name}</span>
                  </div>
                  <ChevronRight size={12} className="text-muted/30 group-hover:text-muted shrink-0 transition-colors" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
