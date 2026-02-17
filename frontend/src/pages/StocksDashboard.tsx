import { useTranslation } from 'react-i18next';
import { BarChart3, Plus } from 'lucide-react';

export default function StocksDashboard() {
  const { t } = useTranslation();

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-4 h-10">
        <h1 className="text-xl font-semibold">Actions & Fonds</h1>
        <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-accent-500 text-black">
          <Plus size={16} />
          <span className="hidden sm:inline">Ajouter un compte</span>
        </button>
      </div>
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <BarChart3 className="mx-auto text-muted mb-3" size={32} />
        <p className="text-muted text-sm mb-4">Aucun compte ajouté.</p>
        <p className="text-muted text-xs mb-6">Ajoutez vos PEA, PER, CTO, etc. pour suivre vos investissements.</p>
        <button 
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-accent-500 text-black mx-auto"
          onClick={() => alert('Formulaire compte investissements à venir (#734)')}
        >
          <Plus size={16} />
          + Ajouter un compte
        </button>
      </div>
    </div>
  );
}