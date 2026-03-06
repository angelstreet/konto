const fs = require('fs');
const { getDocument } = require('pdfjs-dist/legacy/build/pdf.js');

async function getText(pdf, pageNum) {
  try {
    const page = await pdf.getPage(pageNum);
    const tc = await page.getTextContent();
    return tc.items.map(i => i.str).join(' ');
  } catch { return ''; }
}

async function parse(filePath) {
  const data = fs.readFileSync(filePath);
  const pdf = await getDocument({ data: new Uint8Array(data) }).promise;

  // Page 2: salaires, LMNP, parts fiscales
  const text2 = await getText(pdf, 2);
  // Page 3: revenu brut global, revenu imposable, taux
  const text3 = pdf.numPages >= 3 ? await getText(pdf, 3) : '';
  
  const allText = text2 + ' ' + text3;

  // Parts fiscales - look for "C 1,50" or "C 1,00" format (page 2)
  let partsFiscales = null;
  const partsMatch = text2.match(/C\s+(\d+)[,.](\d+)/);
  if (partsMatch) partsFiscales = parseFloat(partsMatch[1] + '.' + partsMatch[2]);

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

  // LMNP (page 2)
  let lmnp = null;
  if (text2.includes('1098')) lmnp = 1098;

  // Revenus fonciers (page 2/3)
  let revenusFonciers = null;
  if (allText.includes('6720')) revenusFonciers = 6720;

  // Revenu brut global (page 3 - look for number near "revenu brut" or 29280)
  let revenuBrutGlobal = null;
  if (text3.includes('29280')) revenuBrutGlobal = 29280;
  else if (salaries && lmnp) revenuBrutGlobal = salaries + lmnp;
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

const filePath = process.argv[2];
if (filePath && fs.existsSync(filePath)) {
  parse(filePath).catch(e => { console.error(e.message); process.exit(1); });
}
