import { API } from '../config';
import { useState, useRef } from 'react';
import { Download, FileText, Check } from 'lucide-react';


const CATEGORIES = [
  { key: 'bank', label: 'Comptes bancaires', icon: '🏦' },
  { key: 'immobilier', label: 'Immobilier', icon: '🏠' },
  { key: 'crypto', label: 'Crypto', icon: '₿' },
  { key: 'stocks', label: 'Actions & Fonds', icon: '📈' },
];

function formatCurrency(v: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(v);
}

interface ReportSection {
  title: string;
  items: { name: string; value: number }[];
  total: number;
}

export default function Report() {
  const [selected, setSelected] = useState<Set<string>>(new Set(['bank', 'immobilier', 'crypto', 'stocks']));
  const [report, setReport] = useState<{ sections: ReportSection[]; grandTotal: number; generatedAt: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const toggleCategory = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === CATEGORIES.length) setSelected(new Set());
    else setSelected(new Set(CATEGORIES.map(c => c.key)));
  };

  const generate = () => {
    if (selected.size === 0) return;
    setLoading(true);
    fetch(`${API}/report/patrimoine?categories=${Array.from(selected).join(',')}`)
      .then(r => r.json())
      .then(d => setReport(d))
      .finally(() => setLoading(false));
  };

  const handlePrint = () => {
    if (!printRef.current) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`
      <html><head><title>Déclaration de patrimoine - Kompta</title>
      <style>
        body { font-family: -apple-system, sans-serif; padding: 40px; color: #111; }
        h1 { font-size: 22px; margin-bottom: 4px; }
        h2 { font-size: 16px; margin-top: 24px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
        .date { color: #888; font-size: 12px; margin-bottom: 24px; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        td { padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 13px; }
        .right { text-align: right; }
        .total-row td { font-weight: bold; border-top: 2px solid #333; }
        .grand-total { margin-top: 24px; font-size: 18px; font-weight: bold; text-align: right; }
      </style></head><body>
      <h1>Déclaration de patrimoine</h1>
      <div class="date">Généré le ${new Date().toLocaleDateString('fr-FR')} par Kompta</div>
      ${report?.sections.map(s => `
        <h2>${s.title}</h2>
        <table>
          ${s.items.map(i => `<tr><td>${i.name}</td><td class="right">${formatCurrency(i.value)}</td></tr>`).join('')}
          <tr class="total-row"><td>Total ${s.title}</td><td class="right">${formatCurrency(s.total)}</td></tr>
        </table>
      `).join('')}
      <div class="grand-total">Total patrimoine : ${formatCurrency(report?.grandTotal || 0)}</div>
      </body></html>
    `);
    w.document.close();
    w.print();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <FileText size={20} />
          Rapport de patrimoine
        </h1>
      </div>

      {/* Category selection */}
      <div className="bg-surface rounded-xl border border-border p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-muted">Catégories à inclure</h3>
          <button onClick={toggleAll} className="text-xs text-accent-400 hover:text-accent-300">
            {selected.size === CATEGORIES.length ? 'Tout désélectionner' : 'Tout sélectionner'}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {CATEGORIES.map(cat => (
            <button
              key={cat.key}
              onClick={() => toggleCategory(cat.key)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                selected.has(cat.key)
                  ? 'border-accent-500/50 bg-accent-500/10 text-accent-400'
                  : 'border-border text-muted hover:border-border/80'
              }`}
            >
              <span>{cat.icon}</span>
              <span className="flex-1 text-left">{cat.label}</span>
              {selected.has(cat.key) && <Check size={14} />}
            </button>
          ))}
        </div>
        <button
          onClick={generate}
          disabled={selected.size === 0 || loading}
          className="mt-4 w-full py-2.5 rounded-lg bg-accent-500 text-black font-medium text-sm hover:bg-accent-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Génération...' : 'Générer mon rapport'}
        </button>
      </div>

      {/* Report preview */}
      {report && (
        <div ref={printRef}>
          <div className="bg-surface rounded-xl border border-border p-4 mb-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">Déclaration de patrimoine</h2>
                <p className="text-xs text-muted">Généré le {new Date(report.generatedAt).toLocaleDateString('fr-FR')}</p>
              </div>
              <button
                onClick={handlePrint}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-500/20 text-accent-400 text-sm hover:bg-accent-500/30 transition-colors"
              >
                <Download size={14} />
                Imprimer / PDF
              </button>
            </div>

            {report.sections.map(section => (
              <div key={section.title} className="mb-4">
                <h3 className="text-sm font-medium text-muted uppercase tracking-wide border-b border-border pb-1 mb-2">
                  {section.title}
                </h3>
                <div className="space-y-1">
                  {section.items.map((item, i) => (
                    <div key={i} className="flex items-center justify-between text-sm px-1">
                      <span>{item.name}</span>
                      <span className={item.value >= 0 ? 'text-accent-400' : 'text-red-400'}>{formatCurrency(item.value)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between text-sm font-semibold px-1 pt-1 border-t border-border/50">
                    <span>Total {section.title}</span>
                    <span className="text-accent-400">{formatCurrency(section.total)}</span>
                  </div>
                </div>
              </div>
            ))}

            <div className="flex items-center justify-between pt-3 border-t-2 border-accent-500/30">
              <span className="text-lg font-bold">Total patrimoine</span>
              <span className="text-lg font-bold text-accent-400">{formatCurrency(report.grandTotal)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
