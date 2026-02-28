import { useTranslation } from 'react-i18next';
import { Banknote, Plus } from 'lucide-react';

export default function LoansDashboard() {
  const { t: _t } = useTranslation();

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2 h-10">
        <h1 className="text-xl font-semibold whitespace-nowrap">Prêts</h1>
        <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-accent-500 text-black">
          <Plus size={16} />
          <span className="hidden sm:inline">Ajouter un prêt</span>
        </button>
      </div>
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <Banknote className="mx-auto text-muted mb-3" size={32} />
        <p className="text-muted text-sm mb-4">Aucun prêt ajouté.</p>
        <p className="text-muted text-xs mb-6">Ajoutez vos emprunts immobiliers, prêts auto, etc. pour suivre votre endettement.</p>
        <button 
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-accent-500 text-black mx-auto"
          onClick={() => alert('Formulaire de prêt à venir (tâches suivantes)')}
        >
          <Plus size={16} />
          + Ajouter un prêt
        </button>
      </div>
    </div>
  );
}