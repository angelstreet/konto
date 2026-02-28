import { useState, useEffect, useCallback } from 'react';
import { Key, Plus, Copy, RefreshCw, Trash2, Check, X } from 'lucide-react';
import { API } from '../config';
import { useAuthFetch } from '../useApi';

interface ApiKey {
  id: number;
  name: string;
  key_prefix: string;
  scope: string;
  created_at: string;
  last_used_at: string | null;
  active: number;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'jamais';
  const d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface CreateDialogProps {
  onClose: () => void;
  onCreate: (name: string, scope: string) => Promise<string | null>;
}

function CreateDialog({ onClose, onCreate }: CreateDialogProps) {
  const [name, setName] = useState('default');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [scope, setScope] = useState('personal');
  const [loading, setLoading] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    setLoading(true);
    const key = await onCreate(name, scope);
    setLoading(false);
    if (key) setNewKey(key);
  };

  const handleCopy = () => {
    if (newKey) {
      navigator.clipboard.writeText(newKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-surface border border-border rounded-xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="font-semibold text-sm">Nouvelle clé API</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        {!newKey ? (
          <div className="p-4 space-y-4">
            <div>
              <label className="text-xs text-muted block mb-1.5">Nom</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent-400"
                placeholder="default"
              />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1.5">Scope</label>
              <div className="flex gap-4">
                {[
                  { id: 'personal', label: 'Personnel' },
                  { id: 'analytics', label: 'Analytics' },
                ].map(s => (
                  <label key={s.id} onClick={() => setScope(s.id)} className="flex items-center gap-2 cursor-pointer text-sm">
                    <span
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${
                        scope === s.id ? 'border-accent-400' : 'border-border'
                      }`}
                    >
                      {scope === s.id && <span className="w-2 h-2 rounded-full bg-accent-400" />}
                    </span>
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleCreate}
                disabled={loading || !name.trim()}
                className="flex-1 bg-accent-500/20 text-accent-400 hover:bg-accent-500/30 transition-colors rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40"
              >
                {loading ? '...' : 'Créer'}
              </button>
              <button
                onClick={onClose}
                className="flex-1 bg-surface-hover text-muted hover:text-foreground transition-colors rounded-lg px-4 py-2 text-sm"
              >
                Annuler
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-4">
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
              <p className="text-xs text-yellow-400 font-medium mb-2">Copiez cette clé maintenant!</p>
              <p className="text-xs text-muted mb-3">Elle ne sera plus visible après fermeture de cette fenêtre.</p>
              <div className="font-mono text-xs bg-black/30 rounded px-3 py-2 break-all text-yellow-200">
                {newKey}
              </div>
            </div>
            <button
              onClick={handleCopy}
              className="w-full flex items-center justify-center gap-2 bg-surface-hover hover:bg-surface-active transition-colors rounded-lg px-4 py-2 text-sm"
            >
              {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
              {copied ? 'Copié !' : 'Copier'}
            </button>
            <button
              onClick={onClose}
              className="w-full text-sm text-muted hover:text-foreground transition-colors py-2"
            >
              OK, compris
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface RenewedKeyDialogProps {
  apiKey: string;
  onClose: () => void;
}

function RenewedKeyDialog({ apiKey, onClose }: RenewedKeyDialogProps) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-surface border border-border rounded-xl w-full max-w-sm shadow-2xl p-4 space-y-4">
        <h2 className="font-semibold text-sm">Clé renouvelée</h2>
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
          <p className="text-xs text-yellow-400 font-medium mb-2">Copiez cette clé maintenant!</p>
          <div className="font-mono text-xs bg-black/30 rounded px-3 py-2 break-all text-yellow-200">
            {apiKey}
          </div>
        </div>
        <button
          onClick={() => { navigator.clipboard.writeText(apiKey); setCopied(true); }}
          className="w-full flex items-center justify-center gap-2 bg-surface-hover rounded-lg px-4 py-2 text-sm"
        >
          {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
          {copied ? 'Copié !' : 'Copier'}
        </button>
        <button onClick={onClose} className="w-full text-sm text-muted hover:text-foreground transition-colors py-2">
          OK, compris
        </button>
      </div>
    </div>
  );
}

export default function ApiKeyManager() {
  const authFetch = useAuthFetch();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [renewingId, setRenewingId] = useState<number | null>(null);
  const [renewedKey, setRenewedKey] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const fetchKeys = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/settings/api-keys`);
      const data = await res.json();
      setKeys(Array.isArray(data) ? data : []);
    } catch {
      setKeys([]);
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  const handleCreate = async (name: string, scope: string): Promise<string | null> => {
    try {
      const res = await authFetch(`${API}/settings/api-keys`, {
        method: 'POST',
        body: JSON.stringify({ name, scope }),
      });
      const data = await res.json();
      if (data.key) {
        await fetchKeys();
        return data.key;
      }
    } catch {}
    return null;
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Supprimer cette clé API ?')) return;
    setDeletingId(id);
    try {
      await authFetch(`${API}/settings/api-keys/${id}`, { method: 'DELETE' });
      setKeys(prev => prev.filter(k => k.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  const handleRenew = async (id: number) => {
    setRenewingId(id);
    try {
      const res = await authFetch(`${API}/settings/api-keys/${id}/renew`, { method: 'POST', body: JSON.stringify({}) });
      const data = await res.json();
      if (data.key) {
        setRenewedKey(data.key);
        await fetchKeys();
      }
    } finally {
      setRenewingId(null);
    }
  };

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-xs text-muted uppercase tracking-wider">Clés API</h3>
          <p className="text-xs text-muted/60 mt-0.5">
            Les clés API permettent aux agents IA d'accéder à vos données Konto.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 text-xs text-accent-400 hover:text-accent-300 transition-colors bg-accent-500/10 hover:bg-accent-500/20 px-3 py-1.5 rounded-lg"
        >
          <Plus size={12} />
          Créer une clé
        </button>
      </div>

      {loading ? (
        <div className="text-xs text-muted py-4 text-center">Chargement...</div>
      ) : keys.filter(k => k.active).length === 0 ? (
        <div className="bg-surface rounded-xl border border-border px-4 py-6 text-center">
          <Key size={20} className="text-muted mx-auto mb-2" />
          <p className="text-xs text-muted">Aucune clé API. Créez-en une pour autoriser l'accès aux agents.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {keys.filter(k => k.active).map(key => (
            <div key={key.id} className="bg-surface border border-border rounded-xl px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Key size={14} className="text-accent-400 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{key.name}</div>
                    <div className="font-mono text-xs text-muted mt-0.5">
                      {key.key_prefix}••••••••
                    </div>
                    <div className="flex flex-wrap gap-x-2 mt-1 text-xs text-muted">
                      <span>Scope: {key.scope === 'analytics' ? 'Analytics' : 'Personnel'}</span>
                      <span>•</span>
                      <span>Créée: {formatDate(key.created_at)}</span>
                    </div>
                    <div className="text-xs text-muted mt-0.5">
                      Dernière utilisation: {formatDate(key.last_used_at)}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => handleRenew(key.id)}
                    disabled={renewingId === key.id}
                    className="flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors px-2 py-1 bg-surface-hover rounded-lg disabled:opacity-40"
                  >
                    <RefreshCw size={11} className={renewingId === key.id ? 'animate-spin' : ''} />
                    Renouveler
                  </button>
                  <button
                    onClick={() => handleDelete(key.id)}
                    disabled={deletingId === key.id}
                    className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors px-2 py-1 bg-red-500/10 rounded-lg disabled:opacity-40"
                  >
                    <Trash2 size={11} />
                    Supprimer
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateDialog
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}

      {renewedKey && (
        <RenewedKeyDialog
          apiKey={renewedKey}
          onClose={() => setRenewedKey(null)}
        />
      )}
    </div>
  );
}
