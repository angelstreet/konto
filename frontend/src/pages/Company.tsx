import { useTranslation } from 'react-i18next';
import { Building2 } from 'lucide-react';

export default function Company() {
  const { t } = useTranslation();

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">{t('company_profile')}</h1>

      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <Building2 className="mx-auto text-muted mb-3" size={32} />
        <p className="text-muted text-sm">Configurez votre entreprise ici.</p>
      </div>
    </div>
  );
}
