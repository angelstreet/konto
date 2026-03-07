// Parser for French "Tableau d'Amortissement" (loan amortization schedule)
// Extracts: credit number, bank, original amount, current balance, interest rate, dates, payments

const fs = require('fs');
const { getDocument } = require('pdfjs-dist/legacy/build/pdf.js');

async function getText(pdf, pageNum) {
  try {
    const page = await pdf.getPage(pageNum);
    const tc = await page.getTextContent();
    return tc.items.map(i => i.str).join(' ');
  } catch { return ''; }
}

async function parseLoanPDF(filePath) {
  const data = fs.readFileSync(filePath);
  const pdf = await getDocument({ data: new Uint8Array(data) }).promise;

  let allText = '';
  let scheduleText = ''; // all pages for installment counting
  for (let i = 1; i <= pdf.numPages; i++) {
    const pageText = await getText(pdf, i);
    scheduleText += ' ' + pageText;
    if (i <= 3) allText += ' ' + pageText;
  }

  // Extract credit number (n° 10096 18323 00047789202)
  const creditMatch = allText.match(/cr[é]dit\s*n[°]?\s*(\d+\s+\d+\s+\d+)/i) 
    || allText.match(/n[°]?\s*(\d{2,}\s+\d{2,}\s+\d+)/);
  const creditNumber = creditMatch ? creditMatch[1].replace(/\s+/g, ' ').trim() : null;

  // Extract bank name (CIC, Lyonnaise de Banque, etc.)
  const bankMatch = allText.match(/(CIC|Lyonnaise de Banque|Banque Populaire|Credit Agricole|Societe Generale|BNP|Paribas|LCL|Boursorama|Fortuneo)/i);
  const bank = bankMatch ? bankMatch[1] : null;

  // Extract original amount - look for 455000 after "Crédit"
  let originalAmount = null;
  const creditIdx = allText.indexOf('Crédit');
  if (creditIdx >= 0) {
    // Look for 6-digit number > 100000 (avoid 000xxx from credit number)
    const after = allText.slice(creditIdx, creditIdx + 150);
    const match = after.match(/(\d{6})/);
    if (match) {
      const val = parseInt(match[1]);
      if (val > 100000) originalAmount = val;
    }
  }
  // Fallback: look for large 6-digit anywhere in first 3000 chars
  if (!originalAmount) {
    const first = allText.slice(0, 3000);
    const nums = first.match(/\b(\d{6})\b/g);
    if (nums) {
      const valid = nums.map(n => parseInt(n)).filter(n => n > 100000 && n < 1000000);
      if (valid.length) originalAmount = valid[0];
    }
  }

  // Extract current balance (Encours (hors incidents) : 438576,86 EUR)
  const balanceMatch = allText.match(/Encours[^\d]*([\d\s]+,\d{2})\s+EUR/i);
  let currentBalance = null;
  if (balanceMatch) {
    currentBalance = parseFloat(balanceMatch[1].replace(/\s/g, '').replace(',', '.'));
  }

  // Extract interest rate (Taux fixe actuel : 2,60 %)
  const rateMatch = allText.match(/Taux\s+fixe\s+actuel[^\d]*([\d]+,?\d*)\s*%/i);
  let interestRate = null;
  if (rateMatch) {
    interestRate = parseFloat(rateMatch[1].replace(',', '.'));
  }

  // Extract start date (first event: 29/03/2023)
  const firstDateMatch = allText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  let startDate = null;
  if (firstDateMatch) {
    startDate = `${firstDateMatch[3]}-${firstDateMatch[2]}-${firstDateMatch[1]}`;
  }

  // Extract monthly payment - find "2121,49" pattern (the total payment)
  const payments = allText.match(/[12]\d{3},\d{2}/g);
  let monthlyPayment = null;
  if (payments) {
    // Filter for values around 2000-3000
    const valid = payments.map(p => parseFloat(p.replace(',', '.'))).filter(v => v > 1500 && v < 3000);
    monthlyPayment = valid[0]; // First occurrence
  }

  // Extract insurance — in each row: "... Capital  Intérêts  Assurance  TotalÉchéance"
  // Pattern: small value (30-150) immediately before the monthly total payment
  let insuranceMonthly = null;
  if (monthlyPayment) {
    const totalStr = monthlyPayment.toFixed(2).replace('.', ',');
    // Find all occurrences of "XX,XX <totalPayment>" where XX,XX is insurance
    const insRe = new RegExp(`(\\d{2,3},\\d{2})\\s+${totalStr.replace('.', '\\.')}`, 'g');
    const insMatches = [...allText.matchAll(insRe)];
    if (insMatches.length > 0) {
      const val = parseFloat(insMatches[0][1].replace(',', '.'));
      if (val > 10 && val < 200) insuranceMonthly = val;
    }
  }
  // Fallback: look for a consistent small decimal appearing multiple times before a ~2000€ payment
  if (!insuranceMonthly) {
    const smallDecimals = allText.match(/\b(\d{2},\d{2})\b/g);
    if (smallDecimals) {
      const freq = {};
      for (const v of smallDecimals) { freq[v] = (freq[v] || 0) + 1; }
      const candidates = Object.entries(freq)
        .filter(([v, c]) => c >= 3 && parseFloat(v.replace(',', '.')) > 10 && parseFloat(v.replace(',', '.')) < 200)
        .sort((a, b) => b[1] - a[1]);
      if (candidates.length) insuranceMonthly = parseFloat(candidates[0][0].replace(',', '.'));
    }
  }

  // Count installments paid — count "Échéance" rows in "Récapitulatif des évènements passés"
  // The past section ends at "Échéances à venir" marker
  let installmentsPaid = null;
  const pastSection = scheduleText.split(/[EÉ]ch[eé]ances?\s+[àa]\s+venir/i)[0];
  if (pastSection) {
    // Count rows with a date + "Échéance" (not "Impayé", "Remboursement", "accessoire", "singulier")
    const paidRows = pastSection.match(/\d{2}\/\d{2}\/\d{4}\s+[EÉ]ch[eé]ance\b(?!\s+accessoire)(?!\s+singulier)/gi);
    if (paidRows) installmentsPaid = paidRows.length;
  }

  // Extract end date - look for last payment date in schedule (format: DD/MM/YYYY)
  // End date — last Échéance date in the "Échéances à venir" section
  const futureSection = scheduleText.split(/[EÉ]ch[eé]ances?\s+[àa]\s+venir/i)[1] || scheduleText;
  const futureDates = futureSection.match(/\d{2}\/\d{2}\/\d{4}/g);
  let endDate = null;
  if (futureDates && futureDates.length > 0) {
    const startYear = startDate ? parseInt(startDate.slice(0, 4)) : 2020;
    const maxYear = startYear + 30;
    const valid = futureDates
      .map(d => { const m = d.match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? { iso: `${m[3]}-${m[2]}-${m[1]}`, year: parseInt(m[3]) } : null; })
      .filter(d => d && d.year >= startYear && d.year <= maxYear);
    if (valid.length) endDate = valid[valid.length - 1].iso;
  }

  console.log(JSON.stringify({
    creditNumber,
    bank,
    originalAmount,
    currentBalance,
    interestRate,
    startDate,
    endDate,
    monthlyPayment,
    insuranceMonthly,
    installmentsPaid,
  }));
}

const filePath = process.argv[2];
if (filePath && fs.existsSync(filePath)) {
  parseLoanPDF(filePath).catch(e => { console.error(e.message); process.exit(1); });
}
