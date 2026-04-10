import { useState } from 'react';
import { FileText } from 'lucide-react';
import { useAuthFetch } from '../useApi';
import { usePreferences } from '../PreferencesContext';
import { API } from '../config';
import { generateVisualReport, CaptureProgress } from '../services/pdfExport';

const LAST_REPORT_KEY = 'konto_last_report_b64';
const LAST_REPORT_DATE_KEY = 'konto_last_report_date';

/** Create/update a DOM overlay that survives React unmounts */
function showOverlay(p: CaptureProgress) {
  let el = document.getElementById('pdf-export-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pdf-export-overlay';
    el.className = 'fixed inset-0 z-[9999] bg-black/95 flex flex-col items-center justify-center';
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <div class="text-accent-400 text-lg font-semibold mb-4">Rapport</div>
    <div class="w-64 h-1.5 bg-white/10 rounded-full overflow-hidden mb-3">
      <div class="h-full bg-accent-500 transition-all duration-300" style="width:${(p.current / p.total) * 100}%"></div>
    </div>
    <div class="text-sm text-muted">${p.label}... (${p.current}/${p.total})</div>
  `;
}

function hideOverlay() {
  const el = document.getElementById('pdf-export-overlay');
  if (el) el.remove();
}

export default function ExportPdfButton() {
  const authFetch = useAuthFetch();
  const { prefs } = usePreferences();
  const [exporting, setExporting] = useState(false);
  const [lastReportDate] = useState<string | null>(
    () => localStorage.getItem(LAST_REPORT_DATE_KEY)
  );

  const handleExport = async () => {
    setExporting(true);
    try {
      const pdfBytes = await generateVisualReport(showOverlay, { hideCrypto: !!prefs?.hide_crypto });

      // Open in new tab
      const blob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');

      // Save PDF as base64 to localStorage so it survives page reloads
      const base64 = btoa(String.fromCharCode(...pdfBytes));
      try { localStorage.setItem(LAST_REPORT_KEY, base64); } catch { /* quota exceeded */ }
      localStorage.setItem(LAST_REPORT_DATE_KEY, new Date().toISOString());

      // Also save to backend (skip if too large for Vercel's 4.5MB limit)
      if (pdfBytes.length < 3_500_000) {
        authFetch(`${API}/export/visual-report`, {
          method: 'POST',
          body: JSON.stringify({ pdf: base64 }),
        }).catch(() => {});
      }
    } catch (e) {
      console.error('PDF export failed:', e);
    } finally {
      hideOverlay();
      setExporting(false);
    }
  };

  const handleOpenLast = async () => {
    // Rebuild blob from base64 stored in localStorage
    const b64 = localStorage.getItem(LAST_REPORT_KEY);
    if (b64) {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'application/pdf' });
      window.open(URL.createObjectURL(blob), '_blank');
      return;
    }
    // Fall back to backend
    try {
      const res = await authFetch(`${API}/export/visual-report`);
      if (!res.ok) return;
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), '_blank');
    } catch {}
  };

  return (
    <>
      {lastReportDate && !exporting && (
        <button
          onClick={handleOpenLast}
          className="text-xs px-2 py-1 rounded-md font-medium transition-colors text-muted hover:text-white hover:bg-surface-hover flex-shrink-0"
          title="Ouvrir le dernier rapport"
        >
          {new Date(lastReportDate).toLocaleDateString('fr-FR')}
        </button>
      )}

      <button
        onClick={handleExport}
        disabled={exporting}
        className="text-xs px-2 py-1 rounded-md font-medium transition-colors text-muted hover:text-white hover:bg-surface-hover flex-shrink-0 flex items-center gap-1"
        title="Exporter un rapport PDF"
      >
        <FileText size={12} />
        PDF
      </button>
    </>
  );
}
