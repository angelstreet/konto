import { Hono } from 'hono';
import { parseSwissSalaryPdf } from '../scripts/parse-swiss-salary';

const income = new Hono();

// Upload Swiss salary certificate (Lohnausweis) - returns parsed data for confirmation
income.post('/parse-swiss', async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  
  if (!file || !(file instanceof File)) {
    return c.json({ error: 'No file uploaded' }, 400);
  }

  // Write temp file
  const tmpPath = `/tmp/swiss-salary-${Date.now()}.pdf`;
  const buffer = Buffer.from(await file.arrayBuffer());
  require('fs').writeFileSync(tmpPath, buffer);

  try {
    const result = await parseSwissSalaryPdf(tmpPath);
    
    // Cleanup temp file
    require('fs').unlinkSync(tmpPath);

    if (!result.grossCHF || !result.netCHF) {
      return c.json({ 
        error: 'Could not extract salary data. Make sure this is a Swiss Lohnausweis (Form 11).',
        partial: result 
      }, 400);
    }

    return c.json({ success: true, data: result });
  } catch (err: any) {
    try { require('fs').unlinkSync(tmpPath); } catch {}
    return c.json({ error: err.message }, 500);
  }
});

export default income;
