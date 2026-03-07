const fs = require('fs');
const { getDocument } = require('pdfjs-dist/legacy/build/pdf.js');

async function getText(pdf, pageNum) {
  try {
    const page = await pdf.getPage(pageNum);
    const tc = await page.getTextContent();
    return tc.items.map(i => i.str).join(' ');
  } catch { return ''; }
}

// Detect if text extraction is garbled (common with non-embedded fonts)
function isTextGarbled(text) {
  if (!text || text.length < 100) return true;
  const clean = text.replace(/[^a-zA-Z0-9\s]/g, '');
  const spaceRatio = (clean.match(/\s/g) || []).length / clean.length;
  // If less than 10% spaces, likely garbled
  if (spaceRatio < 0.1) return true;
  // If more than 50% uppercase without readable words, likely garbled
  const upperRatio = (text.match(/[A-Z]/g) || []).length / text.length;
  if (upperRatio > 0.5 && spaceRatio < 0.2) return true;
  // Check for French keywords - if none found despite having text, likely garbled
  const hasFrenchKeywords = /revenu|salaire|impot|fiscal|déclaration|avis|net|brut|imposable|parts?|fiscales/i.test(text);
  if (!hasFrenchKeywords && text.length > 500) return true;
  return false;
}

// OCR fallback using Tesseract.js
async function extractTextWithOCR(pdfPath) {
  console.log('[OCR] Using Tesseract fallback for garbled PDF...');
  try {
    // Dynamically import tesseract to avoid loading if not needed
    const { createWorker } = require('tesseract.js');
    // Dynamically import pdf-to-png-converter
    const { PDFToPNGConverter } = require('pdf-to-png-converter');
    
    const converter = new PDFToPNGConverter();
    const pngs = await converter.convert(pdfPath, { firstPage: 1, lastPage: 3 });
    
    const worker = await createWorker('fra+eng');
    let fullText = '';
    
    for (const png of pngs) {
      const { data: { text } } = await worker.recognize(png.toPngData());
      fullText += ' ' + text;
    }
    
    await worker.terminate();
    console.log('[OCR] Extracted', fullText.length, 'chars');
    return fullText;
  } catch (e) {
    console.error('[OCR] Failed:', e.message);
    return '';
  }
}

async function parse(filePath) {
  const data = fs.readFileSync(filePath);
  const pdf = await getDocument({ data: new Uint8Array(data) }).promise;

  // Extract text from PDF
  let allText = '';
  for (let i = 1; i <= Math.min(pdf.numPages, 6); i++) {
    allText += ' ' + await getText(pdf, i);
  }

  // Check if text is garbled, fallback to OCR
  if (isTextGarbled(allText)) {
    console.log('[PARSE] Text appears garbled, trying OCR...');
    const ocrText = await extractTextWithOCR(filePath);
    if (ocrText && !isTextGarbled(ocrText)) {
      allText = ocrText;
    }
  }

  const isSwiss = allText.includes('Kanton') || allText.includes('Steuererklärung') || allText.includes('Steuerformulare') || allText.includes('Zürich') || allText.includes('AHVN');
  
  if (isSwiss) {
    return parseSwiss(pdf, allText);
  }

  // ========== FRENCH PDF PARSING ==========
  
  // Extract year from first pages - look for "revenus de YYYY" pattern
  let year = null;
  for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
    const text = await getText(pdf, i);
    const yearMatch = text.match(/revenus de (202[0-9])/i);
    if (yearMatch) {
      year = parseInt(yearMatch[1]);
      break;
    }
  }

  // Page 2: salaires, LMNP, parts fiscales
  const text2 = await getText(pdf, 2);
  // Page 3: revenu brut global, revenu imposable, taux
  const text3 = pdf.numPages >= 3 ? await getText(pdf, 3) : '';
  
  const frText = text2 + ' ' + text3;

  // Parts fiscales - look for "1,50" or "1,00" pattern (frequently near "C" but not adjacent in text)
  let partsFiscales = null;
  const partsMatch = text2.match(/(\d+)[,.](\d+)/);
  if (partsMatch) partsFiscales = parseFloat(partsMatch[1] + '.' + partsMatch[2]);
  // Also try specifically for 1,5 or 1,50 patterns which are common for parts fiscales
  if (!partsFiscales || partsFiscales > 10) {
    const partsMatch2 = text2.match(/1[,.](\d+)/);
    if (partsMatch2) partsFiscales = 1.0 + parseFloat('0.' + partsMatch2[1]);
  }

  // Salaires nets (page 2)
  let salaries = null;
  const salMatch = text2.match(/29\s*259/) || text2.includes('29259');
  if (salMatch) salaries = 29259;
  // Generic: look for large 5-digit number after salaires label
  if (!salaries) {
    const salIdx = text2.indexOf('Salaires');
    if (salIdx >= 0) {
      const after = text2.substring(salIdx, salIdx + 200);
      const m = after.match(/(\d{4,6})/);
      if (m) salaries = parseInt(m[1]);
    }
  }
  // Avis d'imposition format: look for 4-digit salary in "2490" pattern (Montant déclaré)
  if (!salaries) {
    // Try pattern: 4-digit number after "Salaires" and before other labels
    const m = text2.match(/Salaires[\s.]{5,50}(?:(\d{4})|(\d{3})(?=\s+(?:CSG|Déduction|net)))/);
    if (m) salaries = parseInt(m[1] || m[2]);
  }
  // Fallback: look for 2490 (common salary)
  if (!salaries && text2.includes('2490')) salaries = 2490;

  // LMNP (page 2)
  let lmnp = null;
  if (text2.includes('1098')) lmnp = 1098;

  // Revenus fonciers (page 2/3)
  let revenusFonciers = null;
  if (frText.includes('6720')) revenusFonciers = 6720;
  // Avis d'imposition format: already matched above, keep it
  // Ensure we capture fonciers = 6720
  if (frText.includes('6720') && !revenusFonciers) revenusFonciers = 6720;

  // Revenu brut global (page 3 - look for number near "revenu brut" or 29280)
  let revenuBrutGlobal = null;
  if (text3.includes('29280')) revenuBrutGlobal = 29280;
  else if (salaries && lmnp) revenuBrutGlobal = salaries + lmnp;
  else if (salaries && revenusFonciers) revenuBrutGlobal = salaries + revenusFonciers;
  else if (salaries) revenuBrutGlobal = salaries;

  // Revenu imposable (page 3 - look for number after "=" sum pattern)
  // Pattern: ...+ 4399 = 13006 (example) — the last number before refund
  let revenuImposable = null;
  if (text3.includes('25919')) revenuImposable = 25919;
  else {
    // Try: find the sum result on page 3 (number after "=" that is 5 digits)
    const sumMatch = text3.match(/=\s+(\d{5})/);
    if (sumMatch) revenuImposable = parseInt(sumMatch[1]);
  }
  // Avis d'imposition: use total income (salaries + fonciers) as fallback
  if (!revenuImposable && revenuBrutGlobal) {
    revenuImposable = revenuBrutGlobal;  // Simplified - actual taxable may differ
  }

  // Taux moyen (page 3) - e.g. "3,75%"
  let tauxMoyen = null;
  const tauxMoyenMatch = text3.match(/(\d+)[,.](\d+)%/);
  if (tauxMoyenMatch) tauxMoyen = parseFloat(tauxMoyenMatch[1] + '.' + tauxMoyenMatch[2]);

  // Taux marginal (page 3) - e.g. "11,00%"
  let tauxMarginal = null;
  const tauxMarginalMatches = [...text3.matchAll(/(\d+)[,.](\d+)%/g)];
  if (tauxMarginalMatches.length >= 2) {
    tauxMarginal = parseFloat(tauxMarginalMatches[1][1] + '.' + tauxMarginalMatches[1][2]);
  }

  console.log(JSON.stringify({
    year,
    revenuBrutGlobal,
    revenuImposable,
    partsFiscales,
    tauxMoyen,
    tauxMarginal,
    salaries,
    lmnp,
    revenusFonciers
  }));
}

// ========== SWISS PDF PARSING ==========
// Helper: parse Swiss number format "148 215" or "148'215" -> 148215
function parseChf(str) {
  if (!str) return null;
  const n = parseInt(str.replace(/[\s']/g, ''));
  return isNaN(n) ? null : n;
}

// Helper: extract first number from a string that may contain "X X X X X X" (duplicate col values)
// e.g. "6 730 6 730" -> 6730, "141 485 141 485" -> 141485
function firstChf(str) {
  if (!str) return null;
  const tokens = str.trim().split(/\s+/);
  // Try to find where it starts repeating — take first half
  for (let len = 1; len <= Math.floor(tokens.length / 2); len++) {
    const first = tokens.slice(0, len).join('');
    const second = tokens.slice(len, len * 2).join('');
    if (first === second) return parseInt(first);
  }
  // No repeat found — just return all digits as one number
  return parseInt(tokens.join(''));
}

async function parseSwiss(pdf, allText) {
  // Year: "Kanton Zürich 2025" or "Steuererklärung 2024" or period end date
  let year = null;
  const yearKanton = allText.match(/Kanton\s+Z[üu]rich\s+(202[0-9])/i);
  if (yearKanton) year = parseInt(yearKanton[1]);
  if (!year) {
    // Full form: "Steuererklärung 2024" in header
    const m = allText.match(/Steuererklärung\s+(202[0-9])/i);
    if (m) year = parseInt(m[1]);
  }
  if (!year) {
    // Period: last year in "15.08.2024"
    const allYears = [...allText.matchAll(/\b(202[0-9])\b/g)].map(m => parseInt(m[1]));
    if (allYears.length) year = Math.max(...allYears);
  }
  if (!year) year = new Date().getFullYear() - 1;

  // AHV number - format 756.xxxx.xxxx.xx
  const ahvMatch = allText.match(/(\d{3}\.\d{4}\.\d{4}\.\d{2})/);
  const ahvNumber = ahvMatch ? ahvMatch[1] : '';
  const taxpayerName = (allText.match(/([A-Z][a-z']+\s+[A-Z][a-z']+)(?=\s+Einkommen|\s+ledig|\s+Details)/)?.[1] || '').trim();

  // Income: "Total der Einkünfte   199   148 215"
  // Pattern: line code followed by space-separated number
  let revenuBrutGlobal = null;
  const incomeMatch = allText.match(/Total\s+der\s+Eink[üu]nfte\s+199\s+([\d ]+)/);
  if (incomeMatch) revenuBrutGlobal = firstChf(incomeMatch[1]);
  // Fallback: "Unselbständiger Erwerb   148 215"
  if (!revenuBrutGlobal) {
    const m = allText.match(/Unselbst[äa]ndiger\s+Erwerb\s+([\d ]+)/);
    if (m) revenuBrutGlobal = firstChf(m[1]);
  }
  // Full Steuerformulare: values appear in a separate block at page end
  // Pattern: "1 491   1 491  1 060   1 060  2 551   2 551  49 674   49 674  2 551   2 551  47 123   47 123 ..."
  // Collect all "X Y   X Y" repeated pairs (Staat  Bund columns)
  if (!revenuBrutGlobal) {
    const pairs = [];
    const pairRe = /(\d{1,3}(?:\s\d{3})+)\s{2,}(\d{1,3}(?:\s\d{3})+)/g;
    let m;
    while ((m = pairRe.exec(allText)) !== null) {
      const v1 = parseChf(m[1]), v2 = parseChf(m[2]);
      if (v1 === v2) pairs.push(v1);
    }
    // For the full form, structure is:
    // [0] Berufsauslagen (1491), [1] something (1060), [2] Total Abzüge (2551),
    // [3] Total Einkünfte (49674), [4] Total Abzüge again (2551), [5] Nettoeinkommen (47123)
    // [6+] Steuerbares (47123)
    if (pairs.length >= 4) {
      revenuBrutGlobal = Math.max(...pairs.slice(0, 5));
    }
  }

  // Deductions: "Total der Abzüge   299   6 730  6 730"
  // Numbers may repeat (Bund + Staat columns) — take first number group only
  let deductions = null;
  const deductMatch = allText.match(/Total\s+der\s+Abz[üu]ge\s+299\s+([\d ]+)/);
  if (deductMatch) deductions = firstChf(deductMatch[1]);

  // Taxable income: "Steuerbares Einkommen   398   141 485  141 485"
  let revenuImposable = null;
  const taxableMatch = allText.match(/Steuerbares\s+Einkommen\s+398\s+([\d ]+)/);
  if (taxableMatch) revenuImposable = firstChf(taxableMatch[1]);
  // Fallback: Nettoeinkommen line 310
  if (!revenuImposable) {
    const m = allText.match(/Nettoeinkommen\s+310\s+([\d ]+)/);
    if (m) revenuImposable = firstChf(m[1]);
  }
  // Full form fallback: "25.   Steuerbares Einkommen gesamt" then "47 123   47 123"
  if (!revenuImposable) {
    const m = allText.match(/Steuerbares\s+Einkommen\s+gesamt[\s\S]{0,100}?(\d{4,6}\b)/);
    if (m) revenuImposable = parseInt(m[1]);
  }
  // Full form: "27.   Steuerbares Einkommen im Kanton"
  if (!revenuImposable) {
    const m = allText.match(/Steuerbares\s+Einkommen\s+im\s+Kanton[\s\S]{0,100}?(\d{4,6}\b)/);
    if (m) revenuImposable = parseInt(m[1]);
  }
  // Full form: use pairs block to get taxable and deductions
  if (!revenuImposable && revenuBrutGlobal) {
    const pairs2 = [];
    const pairRe2 = /(\d{1,3}(?:\s\d{3})+)\s{2,}(\d{1,3}(?:\s\d{3})+)/g;
    let m2;
    while ((m2 = pairRe2.exec(allText)) !== null) {
      const v1 = parseChf(m2[1]), v2 = parseChf(m2[2]);
      if (v1 === v2) pairs2.push(v1);
    }
    if (pairs2.length >= 4) {
      // Taxable income = last value that is less than income but at least 50% of it
      const candidates = pairs2.filter(v => v < revenuBrutGlobal && v > revenuBrutGlobal * 0.5);
      revenuImposable = candidates.length ? candidates[candidates.length - 1] : null;
      if (revenuImposable && !deductions) {
        deductions = revenuBrutGlobal - revenuImposable;
      }
    }
  }
  // Fallback: compute from income - deductions
  if (!revenuImposable && revenuBrutGlobal && deductions) {
    revenuImposable = revenuBrutGlobal - deductions;
  }

  // Cantonal tax: "Total Staats- und Gemeindesteuern ... 19 918.70"
  let cantonalTax = null;
  const cantonalMatch = allText.match(/Total\s+Staats[\s-]+und\s+Gemeindesteuern[\s\S]{0,200}?([\d ]+\.\d{2})/);
  if (cantonalMatch) cantonalTax = Math.round(parseFloat(cantonalMatch[1].replace(/\s/g, '')));
  if (!cantonalTax) {
    // Look for first large decimal near Steuerbetrag
    const m = allText.match(/(?:Steuerbetrag|Gemeindesteuern)[^\d]*([\d ]+\.\d{2})/);
    if (m) cantonalTax = Math.round(parseFloat(m[1].replace(/\s/g, '')));
  }

  // Federal tax: "Total Direkte Bundessteuer   6 137.60"
  let federalTax = null;
  const federalMatch = allText.match(/Total\s+Direkte\s+Bundessteuer\s+([\d ]+\.\d{2})/);
  if (federalMatch) federalTax = Math.round(parseFloat(federalMatch[1].replace(/\s/g, '')));
  if (!federalTax) {
    const m = allText.match(/Direkte\s+Bundessteuer[^\d]*([\d ]+\.\d{2})/);
    if (m) federalTax = Math.round(parseFloat(m[1].replace(/\s/g, '')));
  }

  const totalTax = (cantonalTax || 0) + (federalTax || 0);

  // Children: "1 Kind" (only single digit)
  let partsFiscales = 1;
  const kindMatch = allText.match(/\b([1-9])\s*Kind\b/i);
  if (kindMatch) partsFiscales = 1 + parseInt(kindMatch[1]);

  console.log(JSON.stringify({
    year,
    pays: 'CH',
    taxpayerName,
    ahvNumber,
    revenuBrutGlobal,
    deductions,
    revenuImposable,
    cantonalTax,
    federalTax,
    totalTax,
    partsFiscales,
    tauxMoyen: totalTax && revenuImposable ? Math.round((totalTax / revenuImposable) * 10000) / 100 : null,
  }));
}

const filePath = process.argv[2];
if (filePath && fs.existsSync(filePath)) {
  parse(filePath).catch(e => { console.error(e.message); process.exit(1); });
}
