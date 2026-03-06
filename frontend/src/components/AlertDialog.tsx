import { useTranslation } from 'react-i18next';

interface AlertDialogProps {
  open: boolean;
  title: string;
  message: string;
  variant?: 'success' | 'error' | 'info';
  onClose: () => void;
}

export default function AlertDialog({
  open,
  title,
  message,
  variant = 'info',
  onClose,
}: AlertDialogProps) {
  const { t } = useTranslation();

  if (!open) return null;

  const bgColor = {
    success: 'border-green-500',
    error: 'border-red-500', 
    info: 'border-accent-500',
  }[variant];

  const icon = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
  }[variant];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Dialog */}
      <div className={`relative bg-surface border-2 ${bgColor} rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4`}>
        <div className="flex items-start gap-4">
          <span className={`text-2xl ${
            variant === 'success' ? 'text-green-500' : 
            variant === 'error' ? 'text-red-500' : 'text-accent-500'
          }`}>
            {icon}
          </span>
          <div className="flex-1">
            <h3 className="text-base font-semibold mb-2">{title}</h3>
            <p className="text-sm text-muted mb-4">{message}</p>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-accent-500 text-black hover:bg-accent-400 transition-colors"
            >
              {t('ok', 'OK')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
