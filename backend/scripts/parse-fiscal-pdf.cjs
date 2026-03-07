const fs = require('fs');
const { getDocument } = require('pdfjs-dist/legacy/build/pdf.js');

async function getItems(pdf, pageNum) {
  try {
    const page = await pdf.getPage(pageNum);
    const tc = await page.getTextContent();
    return tc.items
      .filter(i => i.str.trim())
      .map(i => ({ x: Math.round(i.transform[4]), y: Math.round(i.transform[5]), str: i.str.trim() }));
  } catch { return []; }
}

// Find value at the same y-row as a label, on the right side of the page (x > minX)
function findValueAtRow(items, labelY, minX = 400, tolerance = 6) {
  const rowItems = items.filter(i => Math.abs(i.y - labelY) <= tolerance && i.x >= minX);
  // Prefer the rightmost number
  const nums = rowItems
    .map(i => ({ ...i, num: parseNum(i.str) }))
    .filter(i => i.num !== null)
    .sort((a, b) => b.x - a.x);
  return nums.length ? nums[0].num : null;
}

function parseNum(str) {
  // Match numbers like 10561, 8 071, 10 561 (space thousands), -504
  const cleaned = str.replace(/\s/g, '').replace(',', '.');
  const m = cleaned.match(/^-?[\d]+\.?\d*$/);
  return m ? parseFloat(cleaned) : null;
}

// Find label row by searching for a string (case-insensitive, partial match)
function findLabelRow(items, needle) {
  const lower = needle.toLowerCase();
  const match = items.find(i => i.x < 300 && i.str.toLowerCase().includes(lower));
  return match ? match.y : null;
}

// Get all text on a page concatenated
function pageText(items) {
  return items.map(i => i.str).join(' ');
}

async function parse(filePath) {
  const data = fs.readFileSync(filePath);
  const pdf = await getDocument({ data: new Uint8Array(data) }).promise;

  // Collect all items from all pages
  const allPageItems = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const items = await getItems(pdf, i);
    allPageItems.push({ page: i, items });
  }
  const allItems = allPageItems.flatMap(p => p.items);
  const fullText = pageText(allItems);

  // Year
  let year = null;
  const yearMatch = fullText.match(/revenus de (202[0-9])/i);
  if (yearMatch) year = parseInt(yearMatch[1]);

  // Country detection
  let pays = 'FR';
  if (fullText.toLowerCase().includes('kanton') || fullText.toLowerCase().includes('steuererklärung') || fullText.toLowerCase().includes('bundessteuer')) {
    pays = 'CH';
  }

  // Parts fiscales — look for decimal pattern near a standalone "C" or "parts" label
  let partsFiscales = 1;
  const partsMatch = fullText.match(/(\d+)[,.](\d{2})\b/);
  if (partsMatch) {
    const val = parseFloat(partsMatch[1] + '.' + partsMatch[2]);
    if (val >= 1 && val <= 10) partsFiscales = val;
  }

  // Helper: search label across all pages and return the right-side value
  function extractByLabel(needle, minX = 400) {
    for (const { items } of allPageItems) {
      const labelY = findLabelRow(items, needle);
      if (labelY !== null) {
        const val = findValueAtRow(items, labelY, minX);
        if (val !== null) return val;
      }
    }
    return null;
  }

  // Revenu brut global
  const revenuBrutGlobal = extractByLabel('revenu brut global');

  // Revenu imposable
  const revenuImposable = extractByLabel('revenu imposable');

  // Salaires nets — "Salaires, pensions, rentes nets" is more precise than raw "Salaires"
  const salaries = extractByLabel('salaires, pensions, rentes nets', 490)
    ?? extractByLabel('salaires, pensions, rentes nets', 250)
    ?? extractByLabel('salaires', 490);

  // Revenus fonciers nets
  const revenusFonciers = extractByLabel('revenus fonciers nets', 490) ?? extractByLabel('revenus fonciers');

  // LMNP — "locations meublées non pro. imposables"
  const lmnp = extractByLabel('locations meublées non pro. imposables', 490);

  // Taux moyen — look positionally for "Taux de l'imposition" or "taux moyen" BEFORE the prélèvements sociaux separator
  // Rates 9.70%, 7.50%, 17.20% are always prélèvements sociaux rates — skip them
  const PREL_SOC_RATES = new Set([9.7, 7.5, 17.2, 9.9]);
  let tauxMoyen = null;
  let tauxMarginal = null;

  // First try positional: look for "Taux de l'imposition" label in IR section
  const tauxPositional = extractByLabel("taux de l'imposition", 300);
  if (tauxPositional !== null && !PREL_SOC_RATES.has(tauxPositional)) {
    tauxMoyen = tauxPositional;
  }

  // Also search text for % patterns outside the prélèvements sociaux section
  // The IR section ends at "PRELEVEMENTS SOCIAUX" or the separator line
  const irSection = fullText.split(/PRELEVEMENTS SOCIAUX|prélèvements sociaux/i)[0];
  const irTauxMatches = [...irSection.matchAll(/(\d{1,2})[,.](\d{1,2})%/g)];
  for (const m of irTauxMatches) {
    const val = parseFloat(m[1] + '.' + m[2]);
    if (val > 0 && val < 60 && !PREL_SOC_RATES.has(val)) {
      if (tauxMoyen === null) tauxMoyen = val;
      else if (tauxMarginal === null && val !== tauxMoyen) tauxMarginal = val;
    }
  }

  // Total à payer — "TOTAL DE VOTRE IMPOSITION NETTE RESTANT A PAYER" or "Somme qu'il vous reste à payer"
  const totalImposition = extractByLabel('total de votre imposition nette', 400)
    ?? extractByLabel("somme qu'il vous reste", 400)
    ?? extractByLabel('solde des prélèvements sociaux', 490);

  console.log(JSON.stringify({
    year,
    pays,
    revenuBrutGlobal,
    revenuImposable,
    partsFiscales,
    tauxMoyen,
    tauxMarginal,
    salaries,
    lmnp,
    revenusFonciers,
    totalImposition,
  }));
}

const filePath = process.argv[2];
if (filePath && fs.existsSync(filePath)) {
  parse(filePath).catch(e => { console.error(e.message); process.exit(1); });
}
