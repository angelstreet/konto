import { toJpeg } from 'html-to-image';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { BASE_PATH } from '../config';

const PAGES = [
  { path: '/', label: 'Synthèse' },
  { path: '/accounts', label: 'Comptes' },
  { path: '/companies', label: 'Entreprises' },
  { path: '/assets', label: 'Patrimoine' },
  { path: '/loans', label: 'Emprunts' },
  { path: '/crypto', label: 'Crypto' },
  { path: '/actions-fonds', label: 'Actions & Fonds' },
  { path: '/property-roi', label: 'Rendement' },
];

function waitFor(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getMainContent(): HTMLElement | null {
  return document.querySelector('main');
}

/** Wait until no "Loading" text is visible in the main content */
async function waitForDataLoad(maxMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const main = getMainContent();
    const text = main?.innerText || '';
    if (!text.includes('Loading') && !text.includes('Chargement') && text.length > 50) return;
    await waitFor(300);
  }
}

/** Collapse all expanded account sections (chevron-down → click to collapse) */
function collapseAllSections() {
  const main = getMainContent();
  if (!main) return;
  // AssetClassShell uses ChevronDown SVG — expanded = no -rotate-90, collapsed = has -rotate-90
  // Find all ChevronDown SVGs that are NOT rotated (i.e. expanded) and click their parent button
  const allSvgs = main.querySelectorAll<SVGElement>('svg.lucide-chevron-down');
  allSvgs.forEach(svg => {
    if (!svg.classList.contains('-rotate-90')) {
      const btn = svg.closest('button');
      if (btn) btn.click();
    }
  });
}

export type CaptureProgress = { current: number; total: number; label: string };

/** Navigate using pushState + popstate so BrowserRouter picks it up */
function navigateTo(path: string) {
  const fullPath = `${BASE_PATH}${path}`;
  window.history.pushState({}, '', fullPath);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export async function capturePages(
  onProgress: (p: CaptureProgress) => void,
): Promise<{ label: string; dataUrl: string }[]> {
  const savedPath = window.location.pathname;
  const results: { label: string; dataUrl: string }[] = [];

  // Remove sidebar margin from <main> during capture
  const main = getMainContent();
  const savedMargin = main?.style.marginLeft || '';
  if (main) main.style.setProperty('margin-left', '0', 'important');

  for (let i = 0; i < PAGES.length; i++) {
    const page = PAGES[i];
    onProgress({ current: i + 1, total: PAGES.length, label: page.label });

    // Navigate via BrowserRouter-compatible pushState
    navigateTo(page.path);
    await waitFor(800);
    await waitForDataLoad();
    await waitFor(2000); // Wait for charts/animations to render

    const currentMain = getMainContent();
    if (!currentMain) continue;
    // Ensure margin stays removed (React may re-render <main>)
    currentMain.style.setProperty('margin-left', '0', 'important');

    // Collapse expandable sections on pages like crypto/actions-fonds
    collapseAllSections();
    await waitFor(300);

    // Scroll to top so we capture the full page from the start
    currentMain.scrollTo?.(0, 0);
    window.scrollTo(0, 0);
    await waitFor(300);

    try {
      const dataUrl = await toJpeg(currentMain, {
        pixelRatio: 1.5,
        quality: 0.85,
        backgroundColor: '#0b0b0b',
        filter: (node: HTMLElement) => {
          if (node.id === 'pdf-export-overlay') return false;
          return true;
        },
      });
      results.push({ label: page.label, dataUrl });
    } catch (e) {
      console.error(`Failed to capture ${page.label}:`, e);
    }
  }

  // Restore sidebar margin and navigate back
  const finalMain = getMainContent();
  if (finalMain) { finalMain.style.marginLeft = savedMargin; finalMain.style.removeProperty('margin-left'); }
  window.history.pushState({}, '', savedPath);
  window.dispatchEvent(new PopStateEvent('popstate'));
  return results;
}

export async function buildPdf(captures: { label: string; dataUrl: string }[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // A4 landscape width as base
  const W = 841.89;
  const COVER_H = 595.28;

  // Cover page
  const cover = doc.addPage([W, COVER_H]);
  cover.drawRectangle({ x: 0, y: 0, width: W, height: COVER_H, color: rgb(0.043, 0.043, 0.043) });
  cover.drawText('Konto', { x: 60, y: COVER_H - 120, size: 48, font: fontBold, color: rgb(0.83, 0.64, 0.07) });
  cover.drawText('Rapport', { x: 60, y: COVER_H - 170, size: 24, font, color: rgb(1, 1, 1) });
  const now = new Date();
  cover.drawText(now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }), {
    x: 60, y: COVER_H - 210, size: 14, font, color: rgb(0.5, 0.5, 0.5),
  });
  cover.drawText(`${captures.length} pages`, {
    x: 60, y: COVER_H - 235, size: 12, font, color: rgb(0.4, 0.4, 0.4),
  });

  // Content pages — full width, proportional height, no margins
  for (const cap of captures) {
    const imgBytes = await fetch(cap.dataUrl).then(r => r.arrayBuffer());
    const img = await doc.embedJpg(imgBytes);
    const imgDims = img.scale(1);

    // Scale to full page width, compute proportional height
    const scale = W / imgDims.width;
    const drawH = imgDims.height * scale;

    // Create page sized to fit the image exactly
    const page = doc.addPage([W, drawH]);
    page.drawImage(img, {
      x: 0,
      y: 0,
      width: W,
      height: drawH,
    });
  }

  return doc.save();
}

export async function generateVisualReport(
  onProgress: (p: CaptureProgress) => void,
): Promise<Uint8Array> {
  const captures = await capturePages(onProgress);
  onProgress({ current: PAGES.length, total: PAGES.length, label: 'Génération PDF...' });
  return buildPdf(captures);
}
