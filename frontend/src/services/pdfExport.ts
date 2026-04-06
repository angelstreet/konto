import { toJpeg } from 'html-to-image';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

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

export type CaptureProgress = { current: number; total: number; label: string };

export async function capturePages(
  onProgress: (p: CaptureProgress) => void,
): Promise<{ label: string; dataUrl: string }[]> {
  const savedHash = window.location.hash;
  const results: { label: string; dataUrl: string }[] = [];

  for (let i = 0; i < PAGES.length; i++) {
    const page = PAGES[i];
    onProgress({ current: i + 1, total: PAGES.length, label: page.label });

    // Navigate
    window.location.hash = `#${page.path}`;
    await waitFor(500);
    await waitForDataLoad();
    await waitFor(1500); // Extra wait for charts to render

    const main = getMainContent();
    if (!main) continue;

    try {
      const dataUrl = await toJpeg(main, {
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

  // Navigate back to original page
  window.location.hash = savedHash || '#/';
  return results;
}

export async function buildPdf(captures: { label: string; dataUrl: string }[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // A4 landscape dimensions in points
  const W = 841.89;
  const H = 595.28;

  // Cover page
  const cover = doc.addPage([W, H]);
  cover.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(0.043, 0.043, 0.043) });
  cover.drawText('Konto', { x: 60, y: H - 120, size: 48, font: fontBold, color: rgb(0.83, 0.64, 0.07) });
  cover.drawText('Rapport visuel', { x: 60, y: H - 170, size: 24, font, color: rgb(1, 1, 1) });
  const now = new Date();
  cover.drawText(now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }), {
    x: 60, y: H - 210, size: 14, font, color: rgb(0.5, 0.5, 0.5),
  });
  cover.drawText(`${captures.length} pages`, {
    x: 60, y: H - 235, size: 12, font, color: rgb(0.4, 0.4, 0.4),
  });

  // Content pages
  for (const cap of captures) {
    const page = doc.addPage([W, H]);
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(0.043, 0.043, 0.043) });

    // Label
    page.drawText(cap.label, { x: 20, y: H - 24, size: 11, font, color: rgb(0.53, 0.53, 0.53) });

    // Embed image
    const imgBytes = await fetch(cap.dataUrl).then(r => r.arrayBuffer());
    const img = await doc.embedJpg(imgBytes);
    const imgDims = img.scale(1);

    // Scale to fit within page with margins
    const margin = 20;
    const labelHeight = 30;
    const availW = W - margin * 2;
    const availH = H - margin - labelHeight;
    const scale = Math.min(availW / imgDims.width, availH / imgDims.height);
    const drawW = imgDims.width * scale;
    const drawH = imgDims.height * scale;

    page.drawImage(img, {
      x: margin,
      y: H - labelHeight - drawH,
      width: drawW,
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
