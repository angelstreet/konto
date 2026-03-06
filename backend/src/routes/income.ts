import { Hono } from 'hono';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

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
  fs.writeFileSync(tmpPath, buffer);

  return new Promise((resolve) => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'parse-swiss-salary.cjs');
    const child = spawn('node', [scriptPath, tmpPath], { cwd: process.cwd() });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    
    child.on('close', (code) => {
      // Cleanup temp file
      try { fs.unlinkSync(tmpPath); } catch {}
      
      if (code !== 0) {
        resolve(c.json({ error: 'Failed to parse PDF', details: stderr }, 500));
        return;
      }
      
      try {
        // Extract JSON from output (skip warnings, find first {)
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          resolve(c.json({ error: 'No parse result', output: stdout }, 500));
          return;
        }
        const result = JSON.parse(jsonMatch[0]);
        
        if (!result.grossCHF || !result.netCHF) {
          resolve(c.json({ 
            error: 'Could not extract salary data. Make sure this is a Swiss Lohnausweis (Form 11).',
            partial: result 
          }, 400));
          return;
        }
        
        resolve(c.json({ success: true, data: result }));
      } catch (err: any) {
        resolve(c.json({ error: 'Failed to parse result', details: err.message, output: stdout }, 500));
      }
    });
  });
});

export default income;
