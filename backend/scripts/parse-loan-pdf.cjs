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
  for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
    allText += ' ' + await getText(pdf, i);
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

  // Extract insurance - look for "57," or "59," pattern in the payment rows
  const insuranceMatch = allText.match(/\s(\d{2},\d{2})\s+(?:EUR|Echéance)/i);
  let insuranceMonthly = null;
  if (insuranceMatch) {
    const vals = allText.match(/(\d{2},\d{2})\s+(?:EUR|Echéance)/g);
    if (vals) {
      const ins = vals.map(v => parseFloat(v.replace(/[^\d,]/g, '').replace(',', '.'))).filter(v => v > 30 && v < 100);
      insuranceMonthly = ins[0];
    }
  }

  // Extract end date - look for last payment date in schedule (format: DD/MM/YYYY)
  const dates = allText.match(/(\d{2})\/(\d{2})\/(\d{4})/g);
  let endDate = null;
  if (dates && dates.length > 1) {
    // Get last date from schedule
    const lastDate = dates[dates.length - 1];
    const ld = lastDate.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (ld) {
      endDate = `${ld[3]}-${ld[2]}-${ld[1]}`;
    }
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
  }));
}

const filePath = process.argv[2];
if (filePath && fs.existsSync(filePath)) {
  parseLoanPDF(filePath).catch(e => { console.error(e.message); process.exit(1); });
}
