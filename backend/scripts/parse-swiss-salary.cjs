const fs = require('fs');
const { getDocument } = require('pdfjs-dist/legacy/build/pdf.js');

async function parseSwissSalary(pdfPath) {
  const data = fs.readFileSync(pdfPath);
  const pdf = await getDocument({ data: new Uint8Array(data) }).promise;
  
  let year = null;
  let employer = null;
  let grossBruttolohn = null;
  let netNettolohn = null;
  let period = null;
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const items = tc.items;
    const byY = {};
    
    items.forEach(item => {
      const y = Math.round(item.transform[5]);
      if (!byY[y]) byY[y] = [];
      byY[y].push(item.str);
    });
    
    // Extract text for pattern matching
    const allText = items.map(x => x.str).join(' ');
    
    // Find year (2025, 2024, etc)
    const yearMatch = allText.match(/\b(202[0-9])\b/);
    if (yearMatch && !year) year = parseInt(yearMatch[1]);
    
    // Find employer name (typically after "Kreuzplatz" or "Alpenquai" etc - company address lines)
    const employerMatch = allText.match(/(?:Kreuzplatz|Alpenquai|Ampstek|CONNECT44|strasse|strasse)\s+(\d+)/i);
    // Extract company name from address - look for lines with company name
    Object.entries(byY).forEach(([y, arr]) => {
      const text = arr.join(' ');
      if (text.match(/Ampstek|CONNECT44|AG|GmbH/i) && !employer) {
        const match = text.match(/([A-Za-z0-9\s]+?)(?:\s+Kreuzplatz|Alpenquai|strasse|Birchlen)/i);
        if (match) employer = match[1].trim();
      }
    });
    
    // Find period (01.01.2025 - 31.05.2025 or 01.06.2025 - 31.12.2025)
    const periodMatch = allText.match(/(\d{2}\.\d{2}\.\d{4})\s*[-–]\s*(\d{2}\.\d{2}\.\d{4})/);
    if (periodMatch) {
      period = `${periodMatch[1]} - ${periodMatch[2]}`;
    }
    
    // Find salary numbers (5-digit with apostrophe: XX'XXX or without)
    // Group by Y position to find the row
    const candidates = [];
    Object.entries(byY).forEach(([y, arr]) => {
      const text = arr.join(' ');
      // Match salary numbers: 59'377, 105'463, 96'539 (with Unicode right single quote U+2019)
      // Could be 5 or 6 digits
      const nums = text.match(/(\d{2,3}[\u2019']\d{3}|\d{5,6})/g);
      if (nums) {
        nums.forEach(n => {
          const clean = n.replace(/[\u2019']/g, '');
          if (parseInt(clean) > 10000) { // Only salary-like amounts
            candidates.push({ y: parseInt(y), value: parseInt(clean), orig: n });
          }
        });
      }
    });
    
    // Sort by Y (top to bottom in PDF coords)
    candidates.sort((a, b) => b.y - a.y);
    
    if (candidates.length >= 2) {
      // Usually: first is gross (highest), second is net (lower)
      // But sometimes AHV is in between
      // Let's take the highest as gross, lowest as net (ignoring AHV)
      const values = candidates.map(c => c.value);
      grossBruttolohn = Math.max(...values);
      netNettolohn = Math.min(...values.filter(v => v > 30000)); // Filter out AHV
    } else if (candidates.length === 1) {
      if (!grossBruttolohn) grossBruttolohn = candidates[0].value;
    }
  }
  
  // Extract employer from first page header too
  if (!employer) {
    const page = await pdf.getPage(1);
    const tc = await page.getTextContent();
    const text = tc.items.map(x => x.str).join(' ');
    const match = text.match(/(Ampstek Switzerland GmbH|CONNECT44 AG|[A-Z][a-zA-Z\s]+(?:AG|GmbH))/);
    if (match) employer = match[1];
  }
  
  return {
    year,
    employer,
    period,
    grossCHF: grossBruttolohn,
    netCHF: netNettolohn,
    currency: 'CHF'
  };
}

// CLI
const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: node parse-swiss-salary.cjs <pdf-file>');
  process.exit(1);
}

parseSwissSalary(pdfPath).then(result => {
  console.log(JSON.stringify(result, null, 2));
}).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
