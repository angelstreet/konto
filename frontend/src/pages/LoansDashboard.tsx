import { useTranslation } from 'react-i18next';
import { Banknote, Plus } from 'lucide-react';

export default function LoansDashboard() {
  const { t } = useTranslation();

  return (
    &lt;div&gt;
      &lt;div className=&quot;flex items-center justify-between gap-2 mb-2 h-10&quot;&gt;
        &lt;h1 className=&quot;text-xl font-semibold whitespace-nowrap&quot;&gt;Prêts&lt;/h1&gt;
        &lt;button className=&quot;flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-accent-500 text-black&quot;&gt;
          &lt;Plus size={16} /&gt;
          &lt;span className=&quot;hidden sm:inline&quot;&gt;Ajouter un prêt&lt;/span&gt;
        &lt;/button&gt;
      &lt;/div&gt;
      &lt;div className=&quot;bg-surface rounded-xl border border-border p-8 text-center&quot;&gt;
        &lt;Banknote className=&quot;mx-auto text-muted mb-3&quot; size={32} /&gt;
        &lt;p className=&quot;text-muted text-sm mb-4&quot;&gt;Aucun prêt ajouté.&lt;/p&gt;
        &lt;p className=&quot;text-muted text-xs mb-6&quot;&gt;Ajoutez vos emprunts immobiliers, prêts auto, etc. pour suivre votre endettement.&lt;/p&gt;
        &lt;button 
          className=&quot;flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-accent-500 text-black mx-auto&quot;
          onClick={() =&gt; alert(&#x27;Formulaire de prêt à venir (tâches suivantes)&#x27;)}
        &gt;
          &lt;Plus size={16} /&gt;
          + Ajouter un prêt
        &lt;/button&gt;
      &lt;/div&gt;
    &lt;/div&gt;
  );
}