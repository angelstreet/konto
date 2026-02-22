import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export default function CookieConsent() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem('konto_cookie_consent');
    if (!consent) setVisible(true);
  }, []);

  if (!visible) return null;

  const accept = () => {
    localStorage.setItem('konto_cookie_consent', 'accepted');
    setVisible(false);
  };

  const decline = () => {
    localStorage.setItem('konto_cookie_consent', 'declined');
    setVisible(false);
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[9999] bg-[#1a1a1a] border-t border-[#333] p-4 md:p-6 shadow-2xl">
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex-1 text-sm text-[#ccc]">
          <p>
            {t('cookie_text', 'Konto utilise uniquement des cookies essentiels au fonctionnement de l\'application (session, préférences). Aucun cookie publicitaire ni de suivi n\'est utilisé.')}
          </p>
          <a href="/konto/privacy" className="text-accent-400 underline text-xs mt-1 inline-block">
            {t('privacy_policy', 'Politique de confidentialité')}
          </a>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={decline}
            className="px-4 py-2 text-sm rounded bg-[#333] text-white hover:bg-[#444] transition"
          >
            {t('decline', 'Refuser')}
          </button>
          <button
            onClick={accept}
            className="px-4 py-2 text-sm rounded bg-accent-500 text-black font-medium hover:bg-accent-600 transition"
          >
            {t('accept', 'Accepter')}
          </button>
        </div>
      </div>
    </div>
  );
}
