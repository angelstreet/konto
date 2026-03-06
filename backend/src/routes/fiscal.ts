import { Hono } from 'hono';
import db from '../db.js';
import { getUserId } from '../shared.js';

const router = new Hono();

// ========== FISCAL DATA ==========

// Get fiscal data for user (latest year by default)
router.get('/api/fiscal', async (c) => {
  const userId = await getUserId(c);
  const year = c.req.query('year');

  let sql = 'SELECT * FROM fiscal_data WHERE user_id = ?';
  const args: any[] = [userId];

  if (year) {
    sql += ' AND year = ?';
    args.push(parseInt(year));
  }

  sql += ' ORDER BY year DESC';

  const result = await db.execute({ sql, args });
  return c.json({ fiscalData: result.rows });
});

// Add or update fiscal data (manual entry)
router.post('/api/fiscal', async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json();

  const {
    year,
    revenuBrutGlobal,
    revenuImposable,
    partsFiscales,
    tauxMarginal,
    tauxMoyen,
    breakdown
  } = body;

  // Provide defaults for missing values
  const partsWithDefault = partsFiscales ?? 1;
  
  if (!year) {
    return c.json({ error: 'year is required' }, 400);
  }

  const breakdownSalaries = breakdown?.salaries ?? null;
  const breakdownLmnp = breakdown?.lmnp ?? null;
  const breakdownDividendes = breakdown?.dividendes ?? null;
  const breakdownRevenusFonciers = breakdown?.revenusFonciers ?? null;

  await db.execute({
    sql: `INSERT INTO fiscal_data (user_id, year, revenu_brut_global, revenu_imposable, parts_fiscales, taux_marginal, taux_moyen, breakdown_salaries, breakdown_lmnp, breakdown_dividendes, breakdown_revenus_fonciers, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(user_id, year) DO UPDATE SET
            revenu_brut_global = excluded.revenu_brut_global,
            revenu_imposable = excluded.revenu_imposable,
            parts_fiscales = excluded.parts_fiscales,
            taux_marginal = excluded.taux_marginal,
            taux_moyen = excluded.taux_moyen,
            breakdown_salaries = excluded.breakdown_salaries,
            breakdown_lmnp = excluded.breakdown_lmnp,
            breakdown_dividendes = excluded.breakdown_dividendes,
            breakdown_revenus_fonciers = excluded.breakdown_revenus_fonciers,
            updated_at = datetime('now')`,
    args: [userId, year, revenuBrutGlobal ?? null, revenuImposable ?? null, partsWithDefault, tauxMarginal ?? null, tauxMoyen ?? null, breakdownSalaries, breakdownLmnp, breakdownDividendes, breakdownRevenusFonciers]
  });

  // Fetch the updated record
  const result = await db.execute({
    sql: 'SELECT * FROM fiscal_data WHERE user_id = ? AND year = ?',
    args: [userId, year]
  });

  return c.json({ fiscalData: result.rows[0] });
});

// Upload and parse avis d'imposition PDF
router.post('/api/fiscal/upload', async (c) => {
  const userId = await getUserId(c);
  const formData = await c.req.formData();
  const file = formData.get('file') as File;
  const year = parseInt(formData.get('year') as string);

  if (!file || !year) {
    return c.json({ error: 'file and year are required' }, 400);
  }

  // Parse PDF and extract fiscal data
  const extracted = await extractFiscalFromPDF(file);

  // Store only the numbers - no PDF retention
  const {
    revenuBrutGlobal,
    revenuImposable,
    partsFiscales,
    tauxMarginal,
    tauxMoyen,
    breakdown
  } = extracted;

  const breakdownSalaries = breakdown?.salaries ?? null;
  const breakdownLmnp = breakdown?.lmnp ?? null;
  const breakdownDividendes = breakdown?.dividendes ?? null;
  const breakdownRevenusFonciers = breakdown?.revenusFonciers ?? null;

  await db.execute({
    sql: `INSERT INTO fiscal_data (user_id, year, revenu_brut_global, revenu_imposable, parts_fiscales, taux_marginal, taux_moyen, breakdown_salaries, breakdown_lmnp, breakdown_dividendes, breakdown_revenus_fonciers, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(user_id, year) DO UPDATE SET
            revenu_brut_global = excluded.revenu_brut_global,
            revenu_imposable = excluded.revenu_imposable,
            parts_fiscales = excluded.parts_fiscales,
            taux_marginal = excluded.taux_marginal,
            taux_moyen = excluded.taux_moyen,
            breakdown_salaries = excluded.breakdown_salaries,
            breakdown_lmnp = excluded.breakdown_lmnp,
            breakdown_dividendes = excluded.breakdown_dividendes,
            breakdown_revenus_fonciers = excluded.breakdown_revenus_fonciers,
            updated_at = datetime('now')`,
    args: [userId, year, revenuBrutGlobal ?? null, revenuImposable ?? null, partsFiscales ?? 1, tauxMarginal ?? null, tauxMoyen ?? null, breakdownSalaries, breakdownLmnp, breakdownDividendes, breakdownRevenusFonciers]
  });

  // Fetch the stored record
  const result = await db.execute({
    sql: 'SELECT * FROM fiscal_data WHERE user_id = ? AND year = ?',
    args: [userId, year]
  });

  // PDF is NOT stored - already discarded after parsing
  return c.json({ fiscalData: result.rows[0] });
});

// Delete fiscal data
router.delete('/api/fiscal/:year', async (c) => {
  const userId = await getUserId(c);
  const year = parseInt(c.req.param('year'));

  if (!year) {
    return c.json({ error: 'year is required' }, 400);
  }

  await db.execute({
    sql: 'DELETE FROM fiscal_data WHERE user_id = ? AND year = ?',
    args: [userId, year]
  });

  return c.json({ success: true });
});

// ========== ELIGIBILITY CHECKS ==========

router.get('/api/fiscal/eligibilities', async (c) => {
  const userId = await getUserId(c);

  // Get latest fiscal data
  const result = await db.execute({
    sql: 'SELECT * FROM fiscal_data WHERE user_id = ? ORDER BY year DESC LIMIT 1',
    args: [userId]
  });

  if (result.rows.length === 0) {
    return c.json({ eligibilities: [], message: 'No fiscal data available' });
  }

  const fiscal = result.rows[0] as any;
  const revenuImposable = fiscal.revenu_imposable || 0;
  const partsFiscales = fiscal.parts_fiscales || 1;

  // Calculate revenue per part (for eligibility thresholds)
  const revenuParPart = partsFiscales > 0 ? revenuImposable / partsFiscales : revenuImposable;

  const eligibilities: any[] = [];

  // Prime d'activité (activity bonus) - income threshold
  // For 2024: ~€2,300/month per part for single person, varies by composition
  // Simplified: check if revenu imposable per part is below threshold
  const primeActiviteThreshold = 28000; // ~€2,333/month x 12
  if (revenuParPart < primeActiviteThreshold) {
    // Estimate: up to ~€1,000/month depending on composition
    const estimated = Math.max(0, Math.min(1000, (primeActiviteThreshold - revenuParPart) / 30));
    eligibilities.push({
      name: 'Prime d\'activité',
      description: 'Bonus for low-to-medium income workers',
      eligible: true,
      estimatedAmount: Math.round(estimated),
      frequency: 'monthly',
      conditions: 'Working, income below threshold, French resident'
    });
  }

  // MaPrimeRénov - home renovation grant
  // Income-based, depends on household composition
  // For 2024: income brackets vary by zone
  const maprimerenovThreshold = 30000; // Simplified threshold
  if (revenuParPart < maprimerenovThreshold) {
    eligibilities.push({
      name: 'MaPrimeRénov',
      description: 'Government grant for home energy renovation',
      eligible: true,
      estimatedAmount: null, // Highly variable - depends on work type
      frequency: 'one-time',
      conditions: 'Owner-occupied residence, energy work by certified professional'
    });
  }

  // APL (Aide Personnalisée au Logement) - housing allowance
  // Income-based, depends on rent and location
  const aplThreshold = 35000;
  if (revenuParPart < aplThreshold && revenuImposable > 0) {
    eligibilities.push({
      name: 'APL',
      description: 'Personalized housing allowance',
      eligible: true,
      estimatedAmount: null, // Depends on rent, zone, family composition
      frequency: 'monthly',
      conditions: 'Tenant in France, rent below ceiling, income below threshold'
    });
  }

  return c.json({ eligibilities, fiscalYear: fiscal.year });
});

// ========== PDF PARSING HELPER ==========

async function extractFiscalFromPDF(file: File): Promise<{
  revenuBrutGlobal: number | null;
  revenuImposable: number | null;
  partsFiscales: number | null;
  tauxMarginal: number | null;
  tauxMoyen: number | null;
  breakdown: {
    salaries: number | null;
    lmnp: number | null;
    dividendes: number | null;
    revenusFonciers: number | null;
  } | null;
}> {
  console.log('extractFiscalFromPDF called');
  // Save uploaded file to temp location
  const tmpDir = '/tmp';
  const extId = Math.random().toString(36).substring(7);
  const tmpPath = `${tmpDir}/fiscal_${extId}.pdf`;
  
  const fileBuffer = await file.arrayBuffer();
  const fs = await import('fs');
  fs.writeFileSync(tmpPath, Buffer.from(fileBuffer));
  
  // Parse using external script (runs in regular Node, not Cloudflare context)
  const { spawn } = await import('child_process');
  
  return new Promise((resolve) => {
    console.log('About to spawn child process for PDF parsing');
    const child = spawn('node', [
      '/home/jndoye/shared/projects/konto/backend/scripts/parse-fiscal-pdf.cjs',
      tmpPath
    ]);
    
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      // Clean up temp file
      try { fs.unlinkSync(tmpPath); } catch {}
      
      console.log('PDF parse result:', code, stdout, stderr);
      
      if (code !== 0 || !stdout.trim()) {
        resolve({
          revenuBrutGlobal: null,
          revenuImposable: null,
          partsFiscales: null,
          tauxMarginal: null,
          tauxMoyen: null,
          breakdown: null
        });
        return;
      }
      
      try {
        // Warnings go to stdout too — extract only the JSON line
        const jsonLine = stdout.trim().split('\n').find(l => l.trim().startsWith('{'));
        if (!jsonLine) throw new Error('No JSON in output');
        const parsed = JSON.parse(jsonLine);
        console.log('Parsed fiscal data:', JSON.stringify(parsed));
        const result = {
          revenuBrutGlobal: parsed.revenuBrutGlobal,
          revenuImposable: parsed.revenuImposable,
          partsFiscales: parsed.partsFiscales,
          tauxMarginal: parsed.tauxMarginal,
          tauxMoyen: parsed.tauxMoyen,
          breakdown: (parsed.salaries || parsed.lmnp || parsed.revenusFonciers) ? {
            salaries: parsed.salaries,
            lmnp: parsed.lmnp,
            dividendes: null,
            revenusFonciers: parsed.revenusFonciers
          } : null
        };
        console.log('Returning result:', JSON.stringify(result));
        resolve(result);
      } catch {
        resolve({
          revenuBrutGlobal: null,
          revenuImposable: null,
          partsFiscales: null,
          tauxMarginal: null,
          tauxMoyen: null,
          breakdown: null
        });
      }
    });
  });
}

export default router;
