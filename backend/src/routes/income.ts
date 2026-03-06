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

  return await new Promise<Response>((resolve) => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'parse-swiss-salary.cjs');
    const child = spawn('node', [scriptPath, tmpPath], { cwd: process.cwd() });
    
    let stdout = '';
    let stderr = '';
    let responded = false;

    const finish = (status: number, body: any) => {
      if (responded) return;
      responded = true;
      resolve(c.json(body, status as any));
    };

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    
    child.on('close', (code) => {
      // Cleanup temp file
      try { fs.unlinkSync(tmpPath); } catch {}
      
      if (code !== 0) {
        finish(500, { error: 'Failed to parse PDF', details: stderr });
        return;
      }
      
      try {
        // Extract JSON from output (skip warnings, find first {)
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          finish(500, { error: 'No parse result', output: stdout });
          return;
        }
        const result = JSON.parse(jsonMatch[0]);
        
        if (!result.grossCHF || !result.netCHF) {
          finish(400, {
            error: 'Could not extract salary data. Make sure this is a Swiss Lohnausweis (Form 11).',
            partial: result 
          });
          return;
        }
        
        finish(200, { success: true, data: result });
      } catch (err: any) {
        finish(500, { error: 'Failed to parse result', details: err.message, output: stdout });
      }
    });
  });
});

export default income;
