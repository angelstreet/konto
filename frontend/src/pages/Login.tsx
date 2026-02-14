import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { enableSandbox } from '../sandbox';

interface Props {
  onLogin: () => void;
}

export default function Login({ onLogin }: Props) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.toLowerCase() === 'user' && password === 'user') {
      onLogin();
    } else {
      setError(true);
    }
  };

  const handleDemo = () => {
    enableSandbox();
    onLogin();
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-bold text-center mb-2 text-accent-400">Konto</h1>
        <p className="text-muted text-center mb-8 text-sm">Comptabilité simplifiée</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-muted mb-1">{t('username')}</label>
            <input
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(false); }}
              className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-white focus:outline-none focus:border-accent-500 transition-colors"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">{t('password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(false); }}
              className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-white focus:outline-none focus:border-accent-500 transition-colors"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm">{t('invalid_credentials')}</p>
          )}

          <button
            type="submit"
            className="w-full bg-accent-500 hover:bg-accent-600 text-white font-semibold rounded-lg py-3 transition-colors"
          >
            {t('sign_in')}
          </button>
        </form>

        <div className="mt-6 text-center">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted uppercase">ou</span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <button
            onClick={handleDemo}
            className="w-full border border-accent-500/30 text-accent-400 hover:bg-accent-500/10 font-medium rounded-lg py-3 transition-colors text-sm"
          >
            🎮 Essayer en mode démo
          </button>
          <p className="text-xs text-muted mt-2">Données fictives, rien n'est sauvegardé</p>
        </div>
      </div>
    </div>
  );
}
