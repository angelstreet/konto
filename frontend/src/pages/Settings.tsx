import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Globe, Palette, Bell, Building2, LogOut, Shield, Check } from 'lucide-react';

const THEMES = [
  { id: 'gold', label: 'Gold', color: '#d4a812' },
  { id: 'blue', label: 'Steel Blue', color: '#3b82f6' },
  { id: 'silver', label: 'Silver', color: '#94a3b8' },
  { id: 'red', label: 'Ruby', color: '#ef4444' },
  { id: 'emerald', label: 'Emerald', color: '#10b981' },
];

export default function Settings() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [showThemes, setShowThemes] = useState(false);
  const [currentTheme, setCurrentTheme] = useState(
    () => localStorage.getItem('kompta_theme') || 'gold'
  );

  const toggleLang = () => {
    i18n.changeLanguage(i18n.language === 'fr' ? 'en' : 'fr');
  };

  const applyTheme = (themeId: string) => {
    localStorage.setItem('kompta_theme', themeId);
    document.documentElement.setAttribute('data-theme', themeId);
    setCurrentTheme(themeId);
  };

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">{t('settings')}</h1>

      <div className="bg-surface rounded-xl border border-border divide-y divide-border">
        <button
          onClick={() => navigate('/companies')}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-hover transition-colors"
        >
          <Building2 size={18} className="text-muted" />
          <span className="text-sm">{t('nav_companies')}</span>
        </button>

        <button
          onClick={toggleLang}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-hover transition-colors"
        >
          <Globe size={18} className="text-muted" />
          <span className="text-sm">{t('language')}: {i18n.language.toUpperCase()}</span>
        </button>

        {/* Theme selector */}
        <div>
          <button
            onClick={() => setShowThemes(!showThemes)}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-hover transition-colors"
          >
            <Palette size={18} className="text-muted" />
            <span className="text-sm">{t('theme')}</span>
            <span className="ml-auto flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: THEMES.find(t => t.id === currentTheme)?.color }}
              />
            </span>
          </button>
          {showThemes && (
            <div className="px-4 pb-3 flex gap-3">
              {THEMES.map((theme) => (
                <button
                  key={theme.id}
                  onClick={() => applyTheme(theme.id)}
                  className={`flex flex-col items-center gap-1.5 p-2 rounded-lg transition-colors ${
                    currentTheme === theme.id ? 'bg-surface-hover' : 'hover:bg-surface-hover'
                  }`}
                  title={theme.label}
                >
                  <div className="relative">
                    <div
                      className="w-8 h-8 rounded-full border-2 transition-colors"
                      style={{
                        backgroundColor: theme.color,
                        borderColor: currentTheme === theme.id ? '#fff' : 'transparent',
                      }}
                    />
                    {currentTheme === theme.id && (
                      <Check size={14} className="absolute inset-0 m-auto text-white" />
                    )}
                  </div>
                  <span className="text-[10px] text-muted">{theme.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-muted/40 cursor-not-allowed"
          disabled
        >
          <Bell size={18} />
          <span className="text-sm">{t('notifications')}</span>
          <span className="ml-auto text-[10px] text-muted/30">{t('coming_soon')}</span>
        </button>

        <button
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-muted/40 cursor-not-allowed"
          disabled
        >
          <Shield size={18} />
          <span className="text-sm">{t('security_2fa')}</span>
          <span className="ml-auto text-[10px] text-muted/30">{t('coming_soon')}</span>
        </button>
      </div>

      <button
        onClick={() => {
          localStorage.removeItem('kompta_auth');
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
