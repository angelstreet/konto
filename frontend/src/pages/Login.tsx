import { useState } from 'react';
import { useTranslation } from 'react-i18next';

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
    if (username === 'user' && password === 'user') {
      onLogin();
    } else {
      setError(true);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-bold text-center mb-2 text-gold-400">Kompta</h1>
        <p className="text-muted text-center mb-8 text-sm">Comptabilité simplifiée</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-muted mb-1">{t('username')}</label>
            <input
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(false); }}
              className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-white focus:outline-none focus:border-gold-500 transition-colors"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">{t('password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(false); }}
              className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-white focus:outline-none focus:border-gold-500 transition-colors"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm">{t('invalid_credentials')}</p>
          )}

          <button
            type="submit"
            className="w-full bg-gold-500 hover:bg-gold-600 text-black font-semibold rounded-lg py-3 transition-colors"
          >
            {t('sign_in')}
          </button>
        </form>
      </div>
    </div>
  );
}
