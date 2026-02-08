import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Globe, Palette, Bell, Building2, LogOut } from 'lucide-react';

export default function Settings() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const toggleLang = () => {
    i18n.changeLanguage(i18n.language === 'fr' ? 'en' : 'fr');
  };

  const items = [
    { icon: Building2, label: t('company'), action: () => navigate('/company') },
    { icon: Globe, label: `${t('language')}: ${i18n.language.toUpperCase()}`, action: toggleLang },
    { icon: Palette, label: t('theme'), action: () => {} },
    { icon: Bell, label: t('notifications'), action: () => {} },
  ];

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">{t('settings')}</h1>

      <div className="bg-surface rounded-xl border border-border divide-y divide-border">
        {items.map(({ icon: Icon, label, action }) => (
          <button
            key={label}
            onClick={action}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-hover transition-colors"
          >
            <Icon size={18} className="text-muted" />
            <span className="text-sm">{label}</span>
          </button>
        ))}
      </div>

      <button
        onClick={() => {
          sessionStorage.removeItem('kompta_auth');
          window.location.reload();
        }}
        className="w-full mt-4 flex items-center gap-3 px-4 py-3.5 bg-surface rounded-xl border border-border text-red-400 hover:bg-surface-hover transition-colors"
      >
        <LogOut size={18} />
        <span className="text-sm">{t('logout')}</span>
      </button>
    </div>
  );
}
