import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Construction, ArrowLeft } from 'lucide-react';

interface Props {
  titleKey: string;
}

export default function ComingSoon({ titleKey }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 h-10">
        <button onClick={() => navigate('/more')} className="md:hidden text-muted hover:text-white transition-colors p-1 -ml-1 flex-shrink-0">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-semibold whitespace-nowrap">{t(titleKey)}</h1>
      </div>
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
        <Construction size={48} className="text-accent-400/50 mb-4" />
        <p className="text-muted text-sm">{t('coming_soon')}</p>
      </div>
    </div>
  );
}
