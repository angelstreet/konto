import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Calculator, BarChart3, Wallet, FileSearch, CloudUpload, Download, Upload, Settings,
} from 'lucide-react';

interface Tool {
  icon: string;
  lucideIcon: typeof Calculator;
  labelKey: string;
  path: string;
}

const tools: Tool[] = [
  { icon: '🧮', lucideIcon: Calculator, labelKey: 'tool_credit_simulator', path: '/simulators' },
  { icon: '📊', lucideIcon: BarChart3, labelKey: 'tool_tax_estimation', path: '/analysis' },
  { icon: '💰', lucideIcon: Wallet, labelKey: 'tool_borrowing_capacity', path: '/simulators' },
  { icon: '📄', lucideIcon: FileSearch, labelKey: 'tool_invoice_scanner', path: '/reconciliation' },
  { icon: '☁️', lucideIcon: CloudUpload, labelKey: 'tool_sync_drive', path: '/settings' },
  { icon: '📥', lucideIcon: Download, labelKey: 'tool_import_data', path: '/import' },
  { icon: '📤', lucideIcon: Upload, labelKey: 'tool_export_data', path: '/reports' },
  { icon: '⚙️', lucideIcon: Settings, labelKey: 'settings', path: '/settings' },
];

export default function Outils() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">{t('nav_outils') || 'Outils'}</h1>
      <div className="grid grid-cols-2 gap-3">
        {tools.map(({ icon, labelKey, path }) => (
          <button
            key={labelKey}
            onClick={() => navigate(path)}
            className="bg-surface rounded-xl border border-border p-4 text-left hover:bg-surface-hover hover:border-accent-500/30 transition-all active:scale-[0.98]"
          >
            <span className="text-2xl block mb-2">{icon}</span>
            <span className="text-sm font-medium text-white">{t(labelKey) || labelKey.replace('tool_', '').replace(/_/g, ' ')}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
