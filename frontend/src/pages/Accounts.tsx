import { useTranslation } from 'react-i18next';
import { Landmark } from 'lucide-react';

export default function Accounts() {
  const { t } = useTranslation();

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">{t('accounts')}</h1>

      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <Landmark className="mx-auto text-muted mb-3" size={32} />
        <p className="text-muted text-sm">{t('no_accounts')}</p>
      </div>
    </div>
  );
}
