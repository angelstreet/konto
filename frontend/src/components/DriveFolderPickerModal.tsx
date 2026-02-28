import { useState, useEffect, useRef, useCallback } from 'react';
import { API } from '../config';
import { FolderOpen, ChevronRight, CheckCircle, Folder, X, AlertTriangle } from 'lucide-react';

interface Props {
  onSelect: (folderId: string | null, folderPath: string | null) => void;
  onClose: () => void;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  companyId?: number | null;
}

type FolderItem = { id: string; name: string };

export default function DriveFolderPickerModal({ onSelect, onClose, authFetch, companyId }: Props) {
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string | null; name: string }[]>([{ id: null, name: 'Mon Drive' }]);

  // In-memory cache: folderId → children
  const cache = useRef<Map<string, FolderItem[]>>(new Map());
  const cacheKey = (id: string | null) => id ?? '__root__';

  const fetchFolder = useCallback(async (folderId: string | null): Promise<FolderItem[] | null> => {
    const key = cacheKey(folderId);
    const cached = cache.current.get(key);
    if (cached) return cached;

    const parts: string[] = [];
    if (companyId) parts.push(`company_id=${companyId}`);
    if (folderId) parts.push(`parent_id=${folderId}`);
    const res = await authFetch(`${API}/drive/folders${parts.length ? '?' + parts.join('&') : ''}`);
    const data = await res.json();
    if (data.error) return null;
    const items: FolderItem[] = data.folders || [];
    cache.current.set(key, items);
    return items;
  }, [authFetch, companyId]);

  // Preload children of visible folders (one level ahead)
  const preload = useCallback((items: FolderItem[]) => {
    for (const f of items) {
      if (!cache.current.has(f.id)) {
        fetchFolder(f.id).catch(() => {});
      }
    }
  }, [fetchFolder]);

  const navigateFolder = useCallback(async (folderId: string | null, folderName: string, force = false) => {
    const key = cacheKey(folderId);
    const cached = !force ? cache.current.get(key) : undefined;

    if (cached) {
      // Instant — from cache
      setFolders(cached);
      setError('');
      setLoading(false);
      setCurrentFolderId(folderId);
      setBreadcrumbs(prev => {
        const existing = prev.findIndex(f => f.id === folderId);
        if (existing >= 0) return prev.slice(0, existing + 1);
        if (folderId === null) return [{ id: null, name: 'Mon Drive' }];
        return [...prev, { id: folderId, name: folderName }];
      });
      preload(cached);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const items = await fetchFolder(folderId);
      if (items === null) {
        setError('No active Google Drive connection');
        setFolders([]);
      } else {
        setFolders(items);
        preload(items);
      }
      setCurrentFolderId(folderId);
      setBreadcrumbs(prev => {
        const existing = prev.findIndex(f => f.id === folderId);
        if (existing >= 0) return prev.slice(0, existing + 1);
        if (folderId === null) return [{ id: null, name: 'Mon Drive' }];
        return [...prev, { id: folderId, name: folderName }];
      });
    } catch {
      setError('Connexion impossible');
      setFolders([]);
    }
    setLoading(false);
  }, [fetchFolder, preload]);

  // Load on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { navigateFolder(null, 'Mon Drive'); }, []);

  function buildPath(extraName?: string) {
    const parts = breadcrumbs.map(b => b.name);
    if (extraName) parts.push(extraName);
    return parts.join(' / ');
  }

  function handleSelect(folderId: string | null, folderName: string | null) {
    const path = folderId
      ? buildPath(folderName && !breadcrumbs.find(b => b.id === folderId) ? folderName : undefined)
      : null;
    onSelect(folderId, path);
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-xl border border-border p-4 w-full max-w-sm max-h-[70vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header: breadcrumbs + close */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1 text-xs text-muted overflow-x-auto flex-1 min-w-0">
            {breadcrumbs.map((crumb, i) => (
              <div key={crumb.id ?? 'root'} className="flex items-center gap-0.5 shrink-0">
                {i > 0 && <ChevronRight size={11} className="text-muted/40" />}
                <button
                  onClick={() => navigateFolder(crumb.id, crumb.name)}
                  className={i === breadcrumbs.length - 1 ? 'text-white font-medium' : 'hover:text-white transition-colors'}
                >
                  {crumb.name}
                </button>
              </div>
            ))}
          </div>
          <button onClick={onClose} className="text-muted hover:text-white ml-2 shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* Folder list */}
        <div className="overflow-y-auto flex-1 space-y-0.5">
          {/* Select current folder / scan all */}
          {!loading && !error && (
            currentFolderId ? (
              <button
                onClick={() => handleSelect(currentFolderId, breadcrumbs[breadcrumbs.length - 1].name)}
                className="w-full text-left px-2 py-2 rounded-lg hover:bg-accent-500/10 text-accent-400 text-xs font-medium transition-colors flex items-center gap-2"
              >
                <CheckCircle size={13} className="shrink-0" />
                Sélectionner ce dossier
              </button>
            ) : (
              <button
                onClick={() => handleSelect(null, null)}
                className="w-full text-left px-2 py-2 rounded-lg hover:bg-white/5 text-xs text-muted hover:text-white transition-colors flex items-center gap-2"
              >
                <Folder size={13} className="shrink-0" />
                Tous les dossiers (scan complet)
              </button>
            )
          )}

          {/* Skeleton loading */}
          {loading && (
            <div className="space-y-1 py-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-2">
                  <div className="w-[13px] h-[13px] rounded bg-white/5 animate-pulse shrink-0" />
                  <div className="h-3 rounded bg-white/5 animate-pulse" style={{ width: `${60 + i * 15}px` }} />
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <AlertTriangle size={20} className="text-red-400/60" />
              <div className="text-xs text-red-400/80">{error}</div>
              <button
                onClick={() => navigateFolder(currentFolderId, breadcrumbs[breadcrumbs.length - 1]?.name || 'Mon Drive', true)}
                className="text-[11px] text-accent-400 hover:text-accent-300 mt-1"
              >
                Réessayer
              </button>
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && folders.length === 0 && (
            <div className="text-center text-muted py-4 text-xs">Aucun sous-dossier</div>
          )}

          {/* Folder items */}
          {!loading && !error && folders.map(f => (
            <button
              key={f.id}
              onClick={() => navigateFolder(f.id, f.name)}
              className="w-full text-left px-2 py-2 rounded-lg hover:bg-white/5 transition-colors flex items-center justify-between group"
            >
              <div className="flex items-center gap-2 min-w-0">
                <FolderOpen size={13} className="shrink-0 text-muted group-hover:text-accent-400 transition-colors" />
                <span className="text-xs truncate">{f.name}</span>
              </div>
              <ChevronRight size={12} className="text-muted/30 group-hover:text-muted shrink-0 transition-colors" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
