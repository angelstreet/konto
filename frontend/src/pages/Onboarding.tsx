import { API } from '../config';
import { useTranslation } from 'react-i18next';
import { Landmark, PlusCircle } from 'lucide-react';
import { useAuthFetch } from '../useApi';

interface Props {
  onComplete: () => void;
}

export default function Onboarding({ onComplete }: Props) {
  const { t } = useTranslation();
  const authFetch = useAuthFetch();

  const connectBank = async () => {
    // Redirect to Powens bank connect
    const res = await authFetch(`${API}/bank/connect`);
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    }
  };

  const skipOnboarding = async () => {
    await authFetch(`${API}/preferences`, {
      method: 'PATCH',
      body: JSON.stringify({ onboarded: 1 }),
    });
    onComplete();
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="text-5xl mb-4">🦎</div>
        <h1 className="text-3xl font-bold mb-2 text-accent-400">{t('welcome_kompta')}</h1>
        <p className="text-muted text-sm mb-10">{t('onboarding_subtitle')}</p>

        <div className="space-y-3">
          <button
            onClick={connectBank}
            className="w-full flex items-center gap-3 px-5 py-4 bg-accent-500 hover:bg-accent-600 text-white rounded-xl transition-colors font-medium"
          >
            <Landmark size={20} />
            <span>{t('connect_bank')}</span>
          </button>

          <button
            onClick={skipOnboarding}
            className="w-full flex items-center gap-3 px-5 py-4 bg-surface hover:bg-surface-hover border border-border rounded-xl transition-colors text-sm text-muted"
          >
            <PlusCircle size={18} />
            <span>{t('add_account_manually')}</span>
          </button>
        </div>

        <button
          onClick={skipOnboarding}
          className="mt-8 text-xs text-muted/50 hover:text-muted transition-colors"
        >
          {t('skip_for_now')}
        </button>
      </div>
    </div>
  );
}
