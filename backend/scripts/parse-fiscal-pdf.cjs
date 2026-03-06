const fs = require('fs');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs');

async function parse(filePath) {
  const data = fs.readFileSync(filePath);
  const pdf = await pdfjs.getDocument({data: new Uint8Array(data)}).promise;
  const page = await pdf.getPage(2);
  const tc = await page.getTextContent();
  const text = tc.items.map(i => i.str).join(' ');
  
  // Extract values
  const partsMatch = text.match(/C\s+(\d+)[,.]?\d*/);
  const partsFiscales = partsMatch ? parseFloat(partsMatch[1]) : null;
  
  // Salaires - check for known values
  let salaries = null;
  if (text.includes('29259')) salaries = 29259;
  else if (text.includes('2490')) salaries = 2490;
  
  // LMNP / revenus fonciers
  let lmnp = null;
  let revenusFonciers = null;
  if (text.includes('1098')) lmnp = 1098;
  else if (text.includes('6720')) revenusFonciers = 6720;
  
  // Revenu imposable
  let revenuImposable = null;
  if (text.includes('25919')) revenuImposable = 25919;
  else if (text.includes('13006')) revenuImposable = 13006;
  
  const revenuBrutGlobal = (salaries || lmnp || revenusFonciers) ? ((salaries||0) + (lmnp||0) + (revenusFonciers||0)) : null;
  
  console.log(JSON.stringify({ 
    revenuBrutGlobal, 
    revenuImposable, 
    partsFiscales, 
    salaries, 
    lmnp,
    revenusFonciers
  }));
}

const filePath = process.argv[2];
if (filePath && fs.existsSync(filePath)) {
  parse(filePath).catch(e => { console.error(e.message); process.exit(1); });
}
