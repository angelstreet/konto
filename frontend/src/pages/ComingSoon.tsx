import { useTranslation } from 'react-i18next';
import { Construction } from 'lucide-react';

interface Props {
  titleKey: string;
}

export default function ComingSoon({ titleKey }: Props) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <Construction size={48} className="text-accent-400/50 mb-4" />
      <h2 className="text-xl font-semibold text-white mb-2">{t(titleKey)}</h2>
      <p className="text-muted text-sm">{t('coming_soon')}</p>
    </div>
  );
}
