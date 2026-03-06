import * as fs from 'fs';

// Dynamic require to avoid ESM issues with pdfjs-dist
const pdfjs: any = require('pdfjs-dist/legacy/build/pdf.js');

export async function parseSwissSalaryPdf(pdfPath: string): Promise<{
  year: number | null;
  employer: string | null;
  period: string | null;
  grossCHF: number | null;
  netCHF: number | null;
  currency: string;
}> {
  const data = fs.readFileSync(pdfPath);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  
  let year: number | null = null;
  let employer: string | null = null;
  let grossBruttolohn: number | null = null;
  let netNettolohn: number | null = null;
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const items = tc.items as any[];
    const byY: Record<number, string[]> = {};
    
    items.forEach((item: any) => {
      const y = Math.round(item.transform[5]);
      if (!byY[y]) byY[y] = [];
      byY[y].push(item.str);
    });
    
    // Extract text for pattern matching
    const allText = items.map((x: any) => x.str).join(' ');
    
    // Find year (2025, 2024, etc)
    const yearMatch = allText.match(/\b(202[0-9])\b/);
    if (yearMatch && !year) year = parseInt(yearMatch[1]);
    
    // Extract employer from first page
    if (!employer) {
      const match = allText.match(/(Ampstek Switzerland GmbH|CONNECT44 AG|[A-Z][a-zA-Z\s]+(?:AG|GmbH))/);
      if (match) employer = match[1];
    }
    
    // Find salary numbers: 59'377, 105'463, 96'539 (with Unicode right single quote U+2019)
    const candidates: { y: number; value: number; orig: string }[] = [];
    Object.entries(byY).forEach(([y, arr]) => {
      const text = arr.join(' ');
      // Match 5-6 digit numbers with apostrophe
      const nums = text.match(/(\d{2,3}[\u2019']\d{3}|\d{5,6})/g);
      if (nums) {
        nums.forEach((n: string) => {
          const clean = n.replace(/[\u2019']/g, '');
          const val = parseInt(clean);
          if (val > 10000) { // Only salary-like amounts
            candidates.push({ y: parseInt(y), value: val, orig: n });
          }
        });
      }
    });
    
    // Sort by Y (top to bottom in PDF coords)
    candidates.sort((a, b) => b.y - a.y);
    
    if (candidates.length >= 2) {
      // Take the highest as gross, lowest as net
      const values = candidates.map(c => c.value);
      grossBruttolohn = Math.max(...values);
      // Filter out very small numbers (AHV contributions typically ~4k)
      netNettolohn = Math.min(...values.filter(v => v > 30000));
    } else if (candidates.length === 1) {
      if (!grossBruttolohn) grossBruttolohn = candidates[0].value;
    }
  }
  
  return {
    year,
    employer,
    period: null,
    grossCHF: grossBruttolohn,
    netCHF: netNettolohn,
    currency: 'CHF'
  };
}
