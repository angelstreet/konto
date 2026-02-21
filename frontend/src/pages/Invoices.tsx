import { API } from '../config';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, RefreshCw, CloudOff, ArrowLeft, FolderOpen, Check, Paperclip, Upload, Link2, Unlink, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthFetch, useApi } from '../useApi';
import DriveFolderPickerModal from '../components/DriveFolderPickerModal';

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

interface TxRow {
  id: number;
  label: string;
  amount: number;
  date: string;
  category: string | null;
  invoice_id: number | null;
  filename: string | null;
  drive_file_id: string | null;
  vendor: string | null;
  amount_ht: number | null;
}

interface DriveFile {
  id: number;
  filename: string;
  drive_file_id: string;
  date: string | null;
  vendor: string | null;
  amount_ht: number | null;
  transaction_id: number | null;
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
  const [_invoices, _setInvoices] = useState<Invoice[]>([]);
  const [txRows, setTxRows] = useState<TxRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ total: number; processed: number; scanned: number; matched: number } | null>(null);
  const [scanDone, setScanDone] = useState(false);
  const [filter, setFilter] = useState<'all' | 'matched' | 'unmatched'>('all');
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(0); // 0 = all
  const [uploadingTxId, setUploadingTxId] = useState<number | null>(null);
  const [linkingTx, setLinkingTx] = useState<TxRow | null>(null);
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [loadingDriveFiles, setLoadingDriveFiles] = useState(false);
  const [scanResult, setScanResult] = useState<any>(null);
  const [driveStatus, setDriveStatus] = useState<any>(null);
  const [showYearFolderPicker, setShowYearFolderPicker] = useState(false);
  const [yearFolderMapping, setYearFolderMapping] = useState<{ folder_id: string; folder_path: string | null } | null>(null);

  const load = useCallback(async () => {
    const cid = selectedCompanyId;
    const driveParam = cid ? `?company_id=${cid}` : '';
    const statsParam = cid ? `?company_id=${cid}&year=${year}` : '';
    const yearPurpose = cid ? `invoices_${year}_${cid}` : `invoices_${year}`;
    if (cid) {
      const [txRes, statsRes, driveRes, yearMappingRes] = await Promise.all([
        authFetch(`${API}/invoices/transactions?company_id=${cid}&year=${year}${filter !== 'all' ? `&matched=${filter === 'matched'}` : ''}`),
        authFetch(`${API}/invoices/stats${statsParam}`),
        authFetch(`${API}/drive/status${driveParam}`),
        authFetch(`${API}/drive/folder-mapping?purpose=${yearPurpose}`),
      ]);
      setTxRows(await txRes.json());
      setStats(await statsRes.json());
      setDriveStatus(await driveRes.json());
      const ym = await yearMappingRes.json();
      setYearFolderMapping(ym.mapping || null);
    } else {
      const [driveRes] = await Promise.all([
        authFetch(`${API}/drive/status`),
      ]);
      setTxRows([]);
      setStats(null);
      setDriveStatus(await driveRes.json());
      setYearFolderMapping(null);
    }
  }, [filter, selectedCompanyId, year]);

  useEffect(() => { load(); }, [load]);

  const scan = async () => {
    setScanning(true);
    setScanDone(false);
    setScanResult(null);
    setScanProgress(null);
    try {
      const res = await authFetch(`${API}/invoices/scan`, {
        method: 'POST',
        body: JSON.stringify({ company_id: selectedCompanyId, year })
      });
      const data = await res.json();
      if (data.error) {
        setScanResult({ error: data.error });
        setScanning(false);
        return;
      }

      const scanId = data.scan_id;
      if (!scanId) { setScanning(false); return; }

      // Poll for progress
      const poll = async () => {
        try {
          const pollRes = await authFetch(`${API}/invoices/scan/${scanId}`);
          const status = await pollRes.json();
          setScanProgress({ total: status.total, processed: status.processed, scanned: status.scanned, matched: status.matched });

          if (status.status === 'running') {
            setTimeout(poll, 1500);
          } else {
            // Done or error
            setScanResult(status);
            await load();
            setScanDone(true);
            setScanning(false);
            setTimeout(() => setScanDone(false), 30000);
          }
        } catch {
          setScanning(false);
        }
      };
      setTimeout(poll, 1000);
    } catch {
      setScanning(false);
    }
  };


  const unmatch = async (id: number) => {
    await authFetch(`${API}/invoices/${id}/unmatch`, { method: 'POST', body: '{}' });
    await load();
  };

  const uploadInvoice = async (txId: number, file: File) => {
    setUploadingTxId(txId);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('transaction_id', String(txId));
      if (selectedCompanyId) fd.append('company_id', String(selectedCompanyId));
      await authFetch(`${API}/invoices/upload`, { method: 'POST', body: fd });
      await load();
    } finally {
      setUploadingTxId(null);
    }
  };

  const openFilePicker = async (tx: TxRow) => {
    setLinkingTx(tx);
    setLoadingDriveFiles(true);
    try {
      const res = await authFetch(`${API}/invoices/files?company_id=${selectedCompanyId}`);
      setDriveFiles(await res.json());
    } finally {
      setLoadingDriveFiles(false);
    }
  };

  const linkFile = async (invoiceId: number) => {
    if (!linkingTx) return;
    await authFetch(`${API}/invoices/link`, {
      method: 'POST',
      body: JSON.stringify({ invoice_id: invoiceId, transaction_id: linkingTx.id })
    });
    setLinkingTx(null);
    await load();
  };

  const handleYearFolderSelected = async (folderId: string | null, folderPath: string | null) => {
    const purpose = selectedCompanyId ? `invoices_${year}_${selectedCompanyId}` : `invoices_${year}`;
    await authFetch(`${API}/drive/folder-mapping`, {
      method: 'PUT',
      body: JSON.stringify({ purpose, folder_id: folderId, folder_path: folderPath }),
    });
    setYearFolderMapping(folderId ? { folder_id: folderId, folder_path: folderPath } : null);
    setShowYearFolderPicker(false);
    scan();
  };

  const unlinkYearFolder = async () => {
    const purpose = selectedCompanyId ? `invoices_${year}_${selectedCompanyId}` : `invoices_${year}`;
    await authFetch(`${API}/drive/folder-mapping?purpose=${encodeURIComponent(purpose)}`, { method: 'DELETE' });
    setYearFolderMapping(null);
  };



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
                ? <><RefreshCw size={14} className="animate-spin" />{scanProgress && scanProgress.total > 0 ? `${scanProgress.processed}/${scanProgress.total}` : 'Scan...'}</>
                : <><RefreshCw size={14} />Scanner</>
            }
          </button>
        </div>
      </div>

      {/* Scan progress bar */}
      {scanning && scanProgress && scanProgress.total > 0 && (
        <div className="mb-3">
          <div className="h-1 bg-border rounded-full overflow-hidden">
            <div
              className="h-full bg-accent-500 transition-all duration-500 ease-out"
              style={{ width: `${Math.round((scanProgress.processed / scanProgress.total) * 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted mt-1">
            <span>{scanProgress.scanned} nouveaux · {scanProgress.matched} rapprochés</span>
            <span>{Math.round((scanProgress.processed / scanProgress.total) * 100)}%</span>
          </div>
        </div>
      )}

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


      {scanResult && (scanResult.scanned > 0 || scanResult.matched > 0 || scanResult.errors?.length > 0) && (
        <div className="bg-surface rounded-xl border border-border p-3 mb-3 text-xs text-muted">
          {scanResult.scanned} nouveaux fichiers trouvés, {scanResult.matched} rapprochés automatiquement
          {scanResult.errors?.length > 0 && <span className="text-red-400 ml-2">· {scanResult.errors.length} erreurs</span>}
        </div>
      )}

      {!selectedCompanyId ? (
        <div className="bg-surface rounded-xl border border-border p-10 text-center text-muted">
          <Paperclip size={28} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Sélectionnez une entreprise pour voir le rapprochement</p>
        </div>
      ) : (
        <>
          {/* Stats + filters */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex gap-3">
              <div className="text-center">
                <div className="text-xl font-bold text-green-400">{stats?.matched ?? '—'}</div>
                <div className="text-[10px] text-muted uppercase tracking-wide">Justifiés</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-yellow-400">{stats?.unmatched ?? '—'}</div>
                <div className="text-[10px] text-muted uppercase tracking-wide">Manquants</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-white/40">{stats?.total ?? '—'}</div>
                <div className="text-[10px] text-muted uppercase tracking-wide">Total</div>
              </div>
            </div>
            {/* Mobile: both dropdowns — Desktop: year only (month pills below) */}
            <div className="flex items-center gap-2">
              <select
                value={year}
                onChange={e => { setYear(Number(e.target.value)); setMonth(0); }}
                className="text-xs px-2 py-1.5 bg-surface border border-border rounded-lg"
              >
                {[0, 1].map(i => {
                  const y = new Date().getFullYear() - i;
                  return <option key={y} value={y}>{y}</option>;
                })}
              </select>
              <select
                value={month}
                onChange={e => setMonth(Number(e.target.value))}
                className="md:hidden text-xs px-2 py-1.5 bg-surface border border-border rounded-lg"
              >
                <option value={0}>Tous</option>
                {['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'].map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Month pills — desktop only */}
          <div className="hidden md:flex flex-wrap gap-1 mb-3">
            {[0,1,2,3,4,5,6,7,8,9,10,11,12].map(m => (
              <button
                key={m}
                onClick={() => setMonth(m)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  month === m ? 'bg-accent-500/25 text-accent-400' : 'bg-surface text-muted hover:text-white'
                }`}
              >
                {m === 0 ? 'Tous' : ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'][m - 1]}
              </button>
            ))}
          </div>

          {/* Per-year folder row */}
          <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg mb-3 text-sm ${yearFolderMapping ? 'bg-surface border border-border' : 'bg-surface-hover border border-dashed border-border'}`}>
            <FolderOpen size={15} className={yearFolderMapping ? 'text-accent-400 shrink-0' : 'text-muted shrink-0'} />
            {yearFolderMapping ? (
              <>
                <span className="flex-1 truncate text-xs text-white/80">{yearFolderMapping.folder_path || yearFolderMapping.folder_id}</span>
                <button onClick={() => setShowYearFolderPicker(true)} className="text-xs text-muted hover:text-white transition-colors shrink-0">Modifier</button>
                <button onClick={unlinkYearFolder} className="text-xs text-muted hover:text-red-400 transition-colors shrink-0">Unlink</button>
              </>
            ) : (
              <>
                <span className="flex-1 text-xs text-muted">Aucun dossier pour {year}</span>
                <button onClick={() => setShowYearFolderPicker(true)} className="text-xs text-accent-400 hover:text-accent-300 transition-colors shrink-0">Sélectionner →</button>
              </>
            )}
          </div>

          {showYearFolderPicker && (
            <DriveFolderPickerModal
              authFetch={authFetch}
              companyId={selectedCompanyId}
              onSelect={handleYearFolderSelected}
              onClose={() => setShowYearFolderPicker(false)}
            />
          )}

          {/* Tabs */}
          <div className="flex gap-2 mb-3">
            {(['all', 'matched', 'unmatched'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  filter === f ? 'bg-accent-500/20 text-accent-400' : 'bg-surface text-muted hover:text-foreground'
                }`}
              >
                {f === 'all'
                  ? `Tous${stats ? ` · ${stats.total}` : ''}`
                  : f === 'matched'
                  ? `Justifiés${stats ? ` · ${stats.matched}` : ''}`
                  : `Manquants${stats ? ` · ${stats.unmatched}` : ''}`}
              </button>
            ))}
          </div>

          {/* Transaction list */}
          <div className="bg-surface rounded-xl border border-border overflow-hidden">
            {(() => {
              const visibleRows = month ? txRows.filter(tx => parseInt(tx.date?.slice(5, 7) || '0') === month) : txRows;
              if (visibleRows.length === 0) return (
                <div className="p-8 text-center text-muted">
                  <Search size={28} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">{filter === 'matched' ? 'Aucune transaction justifiée' : filter === 'unmatched' ? 'Toutes les transactions sont justifiées' : 'Aucune transaction'}</p>
                </div>
              );
              return visibleRows.map((tx, i) => (
              <div key={tx.id} className={`flex items-center gap-3 px-4 py-3 ${i < visibleRows.length - 1 ? 'border-b border-border/50' : ''} hover:bg-white/[0.02] transition-colors`}>
                {/* Status dot */}
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${tx.invoice_id ? 'bg-green-400' : 'bg-yellow-400/60'}`} />

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm truncate">{tx.label}</span>
                    <span className="text-xs text-muted shrink-0">{tx.date?.slice(0, 10)}</span>
                  </div>
                  {tx.filename && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Paperclip size={10} className="text-green-400/70 shrink-0" />
                      <span className="text-xs text-green-400/70 truncate">{tx.filename}</span>
                      {tx.drive_file_id && (
                        <a
                          href={`https://drive.google.com/file/d/${tx.drive_file_id}/view`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-green-400/50 hover:text-green-400 transition-colors shrink-0 ml-0.5"
                          title="Ouvrir dans Drive"
                          onClick={e => e.stopPropagation()}
                        >
                          <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                  )}
                </div>

                {/* Amount */}
                <span className="text-sm font-mono text-red-400 shrink-0">{Math.abs(tx.amount).toFixed(2)} €</span>

                {/* Action */}
                {filter === 'matched' ? (
                  <button
                    onClick={() => tx.invoice_id && unmatch(tx.invoice_id)}
                    className="p-1.5 rounded-lg text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                    title="Retirer le justificatif"
                  >
                    <Unlink size={13} />
                  </button>
                ) : (
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Link from Drive (already scanned files) */}
                    <button
                      onClick={() => openFilePicker(tx)}
                      className="p-1.5 rounded-lg text-muted hover:text-accent-400 hover:bg-accent-500/10 transition-colors"
                      title="Lier depuis Drive"
                    >
                      <Link2 size={13} />
                    </button>
                    {/* Upload from device */}
                    <label className="cursor-pointer p-1.5 rounded-lg text-muted hover:text-accent-400 hover:bg-accent-500/10 transition-colors" title="Envoyer depuis l'appareil">
                      {uploadingTxId === tx.id
                        ? <RefreshCw size={13} className="animate-spin" />
                        : <Upload size={13} />
                      }
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.heic"
                        className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadInvoice(tx.id, f); e.target.value = ''; }}
                      />
                    </label>
                  </div>
                )}
              </div>
            ));
            })()}
          </div>
        </>
      )}

      {/* Drive File Picker Modal (link existing file to transaction) */}
      {linkingTx && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setLinkingTx(null)}>
          <div className="bg-[#1c1c1e] rounded-xl border border-white/10 p-3 max-w-sm w-full max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <div className="min-w-0">
                <div className="text-xs font-medium text-white">Choisir un justificatif</div>
                <div className="text-[10px] text-muted truncate mt-0.5">{linkingTx.label}</div>
              </div>
              <button onClick={() => setLinkingTx(null)} className="text-muted hover:text-white p-1 ml-2 shrink-0 text-sm leading-none">✕</button>
            </div>
            <div className="overflow-auto flex-1 -mx-1">
              {loadingDriveFiles && <div className="text-center text-muted py-6 text-xs">Chargement...</div>}
              {!loadingDriveFiles && driveFiles.length === 0 && (
                <div className="text-center text-muted py-6 text-xs">Aucun fichier scanné — lancez un scan d'abord</div>
              )}
              {driveFiles.map((f, i) => (
                <button
                  key={f.id}
                  onClick={() => linkFile(f.id)}
                  className={`w-full text-left px-3 py-2.5 flex items-center justify-between gap-2 hover:bg-white/[0.04] transition-colors ${i < driveFiles.length - 1 ? 'border-b border-white/5' : ''} ${f.transaction_id ? 'opacity-40' : ''}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Paperclip size={12} className="text-muted shrink-0" />
                    <span className="text-xs truncate">{f.filename}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-[10px] text-muted">
                    {f.amount_ht != null && <span>{f.amount_ht.toFixed(2)} €</span>}
                    {f.transaction_id && <span className="text-yellow-500/60">lié</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
