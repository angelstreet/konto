import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Props {
  hidden: boolean;
  onToggle: () => void;
  size?: number;
}

export default function EyeToggle({ hidden, onToggle, size = 18 }: Props) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onToggle}
      className="text-muted hover:text-white transition-colors p-2 flex-shrink-0"
      title={hidden ? t('show_all_balances') : t('hide_all_balances')}
    >
      {hidden ? <EyeOff size={size} /> : <Eye size={size} />}
    </button>
  );
}
