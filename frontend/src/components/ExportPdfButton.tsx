import { useState, useEffect } from 'react';
import { FileText } from 'lucide-react';
import { useAuthFetch } from '../useApi';
import { API } from '../config';
import { generateVisualReport, CaptureProgress } from '../services/pdfExport';

export default function ExportPdfButton() {
  const authFetch = useAuthFetch();
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<CaptureProgress | null>(null);
  const [hasLastReport, setHasLastReport] = useState(false);

  // Check if a previous report exists
  useEffect(() => {
    authFetch(`${API}/export/visual-report/check`)
      .then(r => r.json())
      .then(d => setHasLastReport(!!d.exists))
      .catch(() => {});
  }, [authFetch]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const pdfBytes = await generateVisualReport(setProgress);

      // Open in new tab
      const blob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');

      // Save to backend (skip if too large for Vercel's 4.5MB limit)
      if (pdfBytes.length < 3_500_000) {
        const base64 = btoa(String.fromCharCode(...pdfBytes));
        authFetch(`${API}/export/visual-report`, {
          method: 'POST',
          body: JSON.stringify({ pdf: base64 }),
        }).then(() => setHasLastReport(true)).catch(() => {});
      }
    } catch (e) {
      console.error('PDF export failed:', e);
    } finally {
      setExporting(false);
      setProgress(null);
    }
  };

  const handleOpenLast = async () => {
    try {
      const res = await authFetch(`${API}/export/visual-report`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch {}
  };

  return (
    <>
      <button
        onClick={handleExport}
        disabled={exporting}
        className="text-xs px-2 py-1 rounded-md font-medium transition-colors text-muted hover:text-white hover:bg-surface-hover flex-shrink-0 flex items-center gap-1"
        title="Exporter un rapport visuel PDF"
      >
        <FileText size={12} />
        PDF
      </button>

      {hasLastReport && !exporting && (
        <button
          onClick={handleOpenLast}
          className="text-xs px-2 py-1 rounded-md font-medium transition-colors text-muted hover:text-white hover:bg-surface-hover flex-shrink-0"
          title="Ouvrir le dernier rapport"
        >
          Dernier rapport
        </button>
      )}

      {exporting && progress && (
        <div id="pdf-export-overlay" className="fixed inset-0 z-[9999] bg-black/90 flex flex-col items-center justify-center">
          <div className="text-accent-400 text-lg font-semibold mb-4">Rapport visuel</div>
          <div className="w-64 h-1.5 bg-white/10 rounded-full overflow-hidden mb-3">
            <div
              className="h-full bg-accent-500 transition-all duration-300"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
          <div className="text-sm text-muted">
            {progress.label}... ({progress.current}/{progress.total})
          </div>
        </div>
      )}
    </>
  );
}
