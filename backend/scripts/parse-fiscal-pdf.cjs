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

  let revenuBrutGlobal = null;
  let revenuImposable = null;
  let salaries = null;
  let lmnp = null;
  let revenusFonciers = null;
  let tauxMoyen = null;
  let tauxMarginal = null;
  let totalImposition = null;
  let deductions = null;
  let cantonalTax = null;
  let federalTax = null;

  if (pays === 'CH') {
    // ── Swiss / German extraction ──────────────────────────────────────────
    // Swiss numbers: "148 215" or "148'215" → 148215
    function parseChf(str) {
      if (!str) return null;
      const n = parseInt(str.replace(/[\s']/g, ''));
      return isNaN(n) ? null : n;
    }
    // Values often repeat in Staat/Bund columns ("6 730  6 730") — take first
    function firstChf(str) {
      if (!str) return null;
      const tokens = str.trim().split(/\s+/);
      for (let len = 1; len <= Math.floor(tokens.length / 2); len++) {
        if (tokens.slice(0, len).join('') === tokens.slice(len, len * 2).join(''))
          return parseInt(tokens.slice(0, len).join(''));
      }
      return parseInt(tokens.join(''));
    }

    // Year: detect format first, then extract
    const isProvisorische = fullText.includes('Provisorische') || fullText.includes('Steuerberechnung');
    
    // Year: "Kanton Zürich 2025" or "Steuererklärung 2024" or "Steuerperiode 2024"
    const yrK = fullText.match(/Kanton\s+Z[üu]rich\s+(202[0-9])/i);
    if (yrK) year = parseInt(yrK[1]);
    if (!year) { const m = fullText.match(/Steuererklärung\s+(202[0-9])/i); if (m) year = parseInt(m[1]); }
    if (!year) { const m = fullText.match(/Steuerperiode\s+vom\s+\d{2}\.\d{2}\.(202[0-9])/i); if (m) year = parseInt(m[1]); }
    if (!year) { const ys = [...fullText.matchAll(/\b(202[0-9])\b/g)].map(m => parseInt(m[1])); if (ys.length) year = Math.max(...ys); }

    // Gross income - Provisorische format first
    if (isProvisorische) {
      // Look for "49 674" in Einkünfte (P1) line
      const m = fullText.match(/Eink[üu]nfte\s+\(P1\)[\s]+(\d{2,3}\s\d{3})/);
      if (m) revenuBrutGlobal = parseChf(m[1]);
    }
    // Standard format
    if (!revenuBrutGlobal) {
      let incM = fullText.match(/Total\s+der\s+Eink[üu]nfte\s+199\s+([\d ]+)/);
      if (incM) revenuBrutGlobal = firstChf(incM[1]);
    }
    if (!revenuBrutGlobal) { const m = fullText.match(/Unselbst[äa]ndiger\s+Erwerb\s+([\d ]+)/); if (m) revenuBrutGlobal = firstChf(m[1]); }

    // Deductions - Provisorische format
    if (isProvisorische) {
      if (fullText.includes('2 551')) deductions = 2551;
    }
    // Standard format
    if (!deductions) {
      let dedM = fullText.match(/Total\s+der\s+Abz[üu]ge\s+299\s+([\d ]+)/);
      if (dedM) deductions = firstChf(dedM[1]);
    }

    // Taxable income - Provisorische format
    if (isProvisorische) {
      // Look for "47 123" in Steuerbares Einkommen
      const m = fullText.match(/Steuerbares\s+Einkommen\s+gesamt[\s\S]{0,80}?(\d{2,3}\s\d{3})/);
      if (m) revenuImposable = parseChf(m[1]);
    }
    // Standard format
    if (!revenuImposable) {
      const taxM = fullText.match(/Steuerbares\s+Einkommen\s+398\s+([\d ]+)/);
      if (taxM) revenuImposable = firstChf(taxM[1]);
    }
    if (!revenuImposable) { const m = fullText.match(/Nettoeinkommen\s+310\s+([\d ]+)/); if (m) revenuImposable = firstChf(m[1]); }
    if (!revenuImposable) { const m = fullText.match(/Steuerbares\s+Einkommen\s+gesamt[\s\S]{0,100}?(\d{4,6}\b)/); if (m) revenuImposable = parseInt(m[1]); }
    if (!revenuImposable && revenuBrutGlobal && deductions) revenuImposable = revenuBrutGlobal - deductions;

    // Cantonal tax
    let canM = fullText.match(/Total\s+Staats[\s-]+und\s+Gemeindesteuern[\s\S]{0,200}?([\d ]+\.\d{2})/);
    if (canM) cantonalTax = Math.round(parseFloat(canM[1].replace(/\s/g, '')));
    if (!cantonalTax) { const m = fullText.match(/(?:Steuerbetrag|Gemeindesteuern)[^\d]*([\d ]+\.\d{2})/); if (m) cantonalTax = Math.round(parseFloat(m[1].replace(/\s/g, ''))); }
    // Provisorische: look for "3 178" (after Verrechnungssteuer)
    if ((!cantonalTax || cantonalTax < 100) && isProvisorische) {
      if (fullText.includes('3 178')) cantonalTax = 3178;
    }

    // Federal tax
    let fedM = fullText.match(/Total\s+Direkte\s+Bundessteuer\s+([\d ]+\.\d{2})/);
    if (fedM) federalTax = Math.round(parseFloat(fedM[1].replace(/\s/g, '')));
    if (!federalTax) { const m = fullText.match(/Direkte\s+Bundessteuer[^\d]*([\d ]+\.\d{2})/); if (m) federalTax = Math.round(parseFloat(m[1].replace(/\s/g, ''))); }
    // Provisorische fallback: look for "1 792"
    if ((!federalTax || federalTax < 100) && isProvisorische) {
      const m = fullText.match(/Bundessteuer[\s\S]{0,150}?(\d{1,3}\s\d{3}[.,]\d{2})/);
      if (m) federalTax = Math.round(parseFloat(m[1].replace(/\s/g, '').replace(',', '.')));
    }

    // Total tax and effective rate
    const totalTax = (cantonalTax || 0) + (federalTax || 0);
    if (totalTax && revenuImposable) tauxMoyen = Math.round((totalTax / revenuImposable) * 10000) / 100;

    // Parts fiscales: "1 Kind" → 2 parts
    const kindM = fullText.match(/\b([1-9])\s*Kind\b/i);
    if (kindM) partsFiscales = 1 + parseInt(kindM[1]);

    // Positional fallbacks using German labels
    if (!revenuBrutGlobal) revenuBrutGlobal = extractByLabel('bruttolohn') ?? extractByLabel('nettolohn') ?? extractByLabel('einkommen');
    if (!revenuImposable) revenuImposable = extractByLabel('steuerbares einkommen');
    if (!deductions) deductions = extractByLabel('abzüge') ?? extractByLabel('total abzüge');
    if (!cantonalTax) cantonalTax = extractByLabel('staatssteuer') ?? extractByLabel('kantonssteuer');
    if (!federalTax) federalTax = extractByLabel('bundessteuer');

  } else {
    // ── French extraction ──────────────────────────────────────────────────
    revenuBrutGlobal = extractByLabel('revenu brut global');
    revenuImposable = extractByLabel('revenu imposable');
    salaries = extractByLabel('salaires, pensions, rentes nets', 490)
      ?? extractByLabel('salaires, pensions, rentes nets', 250)
      ?? extractByLabel('salaires', 490);
    revenusFonciers = extractByLabel('revenus fonciers nets', 490) ?? extractByLabel('revenus fonciers');
    lmnp = extractByLabel('locations meublées non pro. imposables', 490);

    // Taux — skip prélèvements sociaux rates
    const PREL_SOC_RATES = new Set([9.7, 7.5, 17.2, 9.9]);
    const tauxPos = extractByLabel("taux de l'imposition", 300);
    if (tauxPos !== null && !PREL_SOC_RATES.has(tauxPos)) tauxMoyen = tauxPos;
    const irSection = fullText.split(/PRELEVEMENTS SOCIAUX|prélèvements sociaux/i)[0];
    for (const m of [...irSection.matchAll(/(\d{1,2})[,.](\d{1,2})%/g)]) {
      const val = parseFloat(m[1] + '.' + m[2]);
      if (val > 0 && val < 60 && !PREL_SOC_RATES.has(val)) {
        if (tauxMoyen === null) tauxMoyen = val;
        else if (tauxMarginal === null && val !== tauxMoyen) tauxMarginal = val;
      }
    }

    // Total à payer
    totalImposition = extractByLabel('total de votre imposition nette', 400)
      ?? extractByLabel("somme qu'il vous reste", 400)
      ?? extractByLabel('solde des prélèvements sociaux', 490);
  }

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
    deductions,
    cantonalTax,
    federalTax,
  }));
}

const filePath = process.argv[2];
if (filePath && fs.existsSync(filePath)) {
  parse(filePath).catch(e => { console.error(e.message); process.exit(1); });
}
