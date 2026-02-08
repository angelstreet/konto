import { useTranslation } from 'react-i18next';
import { useFilter } from '../FilterContext';

export default function ScopeSelect() {
  const { t } = useTranslation();
  const { scope, setScope, companies } = useFilter();

  if (companies.length === 0) return null;

  return (
    <select
      value={String(scope)}
      onChange={e => {
        const v = e.target.value;
        setScope(v === 'all' ? 'all' : v === 'personal' ? 'personal' : v === 'pro' ? 'pro' : Number(v));
      }}
      className="bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-accent-500 transition-colors max-w-[140px] truncate"
    >
      <option value="all">{t('scope_all')}</option>
      <option value="personal">{t('scope_personal')}</option>
      <option value="pro">{t('scope_pro')}</option>
      {companies.map(c => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </select>
  );
}
