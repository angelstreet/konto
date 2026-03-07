import { Hono } from 'hono';
import db from '../db.js';
import { getUserId } from '../shared.js';

const router = new Hono();

// ========== FISCAL DATA ==========

// Get all fiscal data for user, ordered by year desc then country
router.get('/api/fiscal', async (c) => {
  const userId = await getUserId(c);
  const result = await db.execute({
    sql: 'SELECT * FROM fiscal_data WHERE user_id = ? ORDER BY year DESC, fiscal_residency ASC',
    args: [userId],
  });
  return c.json({ fiscalData: result.rows });
});

// Add or update fiscal data (manual entry) — keyed by (year, fiscal_residency)
router.post('/api/fiscal', async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json();

  const { year, fiscalResidency = 'FR', revenuBrutGlobal, revenuImposable, partsFiscales, tauxMarginal, tauxMoyen, breakdown, deductions, cantonalTax, federalTax, totalImposition } = body;

  if (!year) return c.json({ error: 'year is required' }, 400);

  const country = fiscalResidency || 'FR';
  const parts = partsFiscales ?? 1;
  const breakdownSalaries = breakdown?.salaries ?? null;
  const breakdownLmnp = breakdown?.lmnp ?? null;
  const breakdownDividendes = breakdown?.dividendes ?? null;
  const breakdownRevenusFonciers = breakdown?.revenusFonciers ?? null;

  await db.execute({
    sql: `INSERT INTO fiscal_data
            (user_id, year, fiscal_residency, revenu_brut_global, revenu_imposable, parts_fiscales, taux_marginal, taux_moyen, breakdown_salaries, breakdown_lmnp, breakdown_dividendes, breakdown_revenus_fonciers, deductions, cantonal_tax, federal_tax, total_imposition, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(user_id, year, fiscal_residency) DO UPDATE SET
            revenu_brut_global = excluded.revenu_brut_global,
            revenu_imposable = excluded.revenu_imposable,
            parts_fiscales = excluded.parts_fiscales,
            taux_marginal = excluded.taux_marginal,
            taux_moyen = excluded.taux_moyen,
            breakdown_salaries = excluded.breakdown_salaries,
            breakdown_lmnp = excluded.breakdown_lmnp,
            breakdown_dividendes = excluded.breakdown_dividendes,
            breakdown_revenus_fonciers = excluded.breakdown_revenus_fonciers,
            deductions = excluded.deductions,
            cantonal_tax = excluded.cantonal_tax,
            federal_tax = excluded.federal_tax,
            total_imposition = excluded.total_imposition,
            updated_at = datetime('now')`,
    args: [userId, year, country, revenuBrutGlobal ?? null, revenuImposable ?? null, parts, tauxMarginal ?? null, tauxMoyen ?? null, breakdownSalaries, breakdownLmnp, breakdownDividendes, breakdownRevenusFonciers, deductions ?? null, cantonalTax ?? null, federalTax ?? null, totalImposition ?? null],
  });

  const result = await db.execute({
    sql: 'SELECT * FROM fiscal_data WHERE user_id = ? AND year = ? AND fiscal_residency = ?',
    args: [userId, year, country],
  });
  return c.json({ fiscalData: result.rows[0] });
});

// Upload and parse avis d'imposition PDF
router.post('/api/fiscal/upload', async (c) => {
  const userId = await getUserId(c);
  const formData = await c.req.formData();
  const file = formData.get('file') as File;
  const formYear = parseInt(formData.get('year') as string);
  const formCountry = (formData.get('country') as string) || 'FR';

  if (!file) return c.json({ error: 'file is required' }, 400);

  const extracted = await extractFiscalFromPDF(file);
  const year = extracted.year || formYear || new Date().getFullYear() - 1;
  // Use detected country if available, else form-supplied, else FR
  const country = extracted.country || formCountry || 'FR';

  const { revenuBrutGlobal, revenuImposable, partsFiscales, tauxMarginal, tauxMoyen, breakdown, deductions, cantonalTax, federalTax, totalImposition } = extracted;
  const breakdownSalaries = breakdown?.salaries ?? null;
  const breakdownLmnp = breakdown?.lmnp ?? null;
  const breakdownDividendes = breakdown?.dividendes ?? null;
  const breakdownRevenusFonciers = breakdown?.revenusFonciers ?? null;

  await db.execute({
    sql: `INSERT INTO fiscal_data
            (user_id, year, fiscal_residency, revenu_brut_global, revenu_imposable, parts_fiscales, taux_marginal, taux_moyen, breakdown_salaries, breakdown_lmnp, breakdown_dividendes, breakdown_revenus_fonciers, deductions, cantonal_tax, federal_tax, total_imposition, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(user_id, year, fiscal_residency) DO UPDATE SET
            revenu_brut_global = excluded.revenu_brut_global,
            revenu_imposable = excluded.revenu_imposable,
            parts_fiscales = excluded.parts_fiscales,
            taux_marginal = excluded.taux_marginal,
            taux_moyen = excluded.taux_moyen,
            breakdown_salaries = excluded.breakdown_salaries,
            breakdown_lmnp = excluded.breakdown_lmnp,
            breakdown_dividendes = excluded.breakdown_dividendes,
            breakdown_revenus_fonciers = excluded.breakdown_revenus_fonciers,
            deductions = excluded.deductions,
            cantonal_tax = excluded.cantonal_tax,
            federal_tax = excluded.federal_tax,
            total_imposition = excluded.total_imposition,
            updated_at = datetime('now')`,
    args: [userId, year, country, revenuBrutGlobal ?? null, revenuImposable ?? null, partsFiscales ?? 1, tauxMarginal ?? null, tauxMoyen ?? null, breakdownSalaries, breakdownLmnp, breakdownDividendes, breakdownRevenusFonciers, deductions ?? null, cantonalTax ?? null, federalTax ?? null, totalImposition ?? null],
  });

  const result = await db.execute({
    sql: 'SELECT * FROM fiscal_data WHERE user_id = ? AND year = ? AND fiscal_residency = ?',
    args: [userId, year, country],
  });
  return c.json({ fiscalData: result.rows[0] });
});

// Update fiscal data by id
router.patch('/api/fiscal/:id', async (c) => {
  const userId = await getUserId(c);
  const id = parseInt(c.req.param('id'));
  const body = await c.req.json();

  if (!id) return c.json({ error: 'id is required' }, 400);

  const fields: string[] = [];
  const values: any[] = [];

  const updatable: Record<string, string> = {
    revenuBrutGlobal: 'revenu_brut_global',
    revenuImposable: 'revenu_imposable',
    partsFiscales: 'parts_fiscales',
    tauxMarginal: 'taux_marginal',
    tauxMoyen: 'taux_moyen',
  };

  for (const [key, col] of Object.entries(updatable)) {
    if (body[key] !== undefined) {
      fields.push(`${col} = ?`);
      values.push(body[key]);
    }
  }

  if (fields.length === 0) return c.json({ error: 'No fields to update' }, 400);

  fields.push("updated_at = datetime('now')");
  values.push(userId, id);

  await db.execute({
    sql: `UPDATE fiscal_data SET ${fields.join(', ')} WHERE user_id = ? AND id = ?`,
    args: values,
  });

  const result = await db.execute({
    sql: 'SELECT * FROM fiscal_data WHERE user_id = ? AND id = ?',
    args: [userId, id],
  });
  return c.json({ fiscalData: result.rows[0] });
});

// Delete fiscal data by id
router.delete('/api/fiscal/:id', async (c) => {
  const userId = await getUserId(c);
  const id = parseInt(c.req.param('id'));

  if (!id) return c.json({ error: 'id is required' }, 400);

  await db.execute({
    sql: 'DELETE FROM fiscal_data WHERE user_id = ? AND id = ?',
    args: [userId, id],
  });
  return c.json({ success: true });
});

// ========== ELIGIBILITY CHECKS ==========

router.get('/api/fiscal/eligibilities', async (c) => {
  const userId = await getUserId(c);
  const idParam = c.req.query('id');

  let fiscal: any;
  if (idParam) {
    const result = await db.execute({
      sql: 'SELECT * FROM fiscal_data WHERE user_id = ? AND id = ?',
      args: [userId, parseInt(idParam)],
    });
    fiscal = result.rows[0];
  } else {
    const result = await db.execute({
      sql: 'SELECT * FROM fiscal_data WHERE user_id = ? ORDER BY year DESC LIMIT 1',
      args: [userId],
    });
    fiscal = result.rows[0];
  }

  if (!fiscal) return c.json({ eligibilities: [], message: 'No fiscal data available' });

  const revenuImposable = fiscal.revenu_imposable || 0;
  const partsFiscales = fiscal.parts_fiscales || 1;
  const revenuParPart = partsFiscales > 0 ? revenuImposable / partsFiscales : revenuImposable;
  const eligibilities: any[] = [];

  const primeActiviteThreshold = 28000;
  if (revenuParPart < primeActiviteThreshold) {
    const estimated = Math.max(0, Math.min(1000, (primeActiviteThreshold - revenuParPart) / 30));
    eligibilities.push({ name: "Prime d'activité", description: 'Bonus for low-to-medium income workers', eligible: true, estimatedAmount: Math.round(estimated), frequency: 'monthly', conditions: 'Working, income below threshold, French resident' });
  }

  if (revenuParPart < 30000) {
    eligibilities.push({ name: 'MaPrimeRénov', description: 'Government grant for home energy renovation', eligible: true, estimatedAmount: null, frequency: 'one-time', conditions: 'Owner-occupied residence, energy work by certified professional' });
  }

  if (revenuParPart < 35000 && revenuImposable > 0) {
    eligibilities.push({ name: 'APL', description: 'Personalized housing allowance', eligible: true, estimatedAmount: null, frequency: 'monthly', conditions: 'Tenant in France, rent below ceiling, income below threshold' });
  }

  return c.json({ eligibilities, fiscalYear: fiscal.year });
});

// ========== PDF PARSING HELPER ==========

async function extractFiscalFromPDF(file: File): Promise<{
  year: number | null;
  country: string | null;
  revenuBrutGlobal: number | null;
  revenuImposable: number | null;
  partsFiscales: number | null;
  tauxMarginal: number | null;
  tauxMoyen: number | null;
  breakdown: { salaries: number | null; lmnp: number | null; dividendes: number | null; revenusFonciers: number | null } | null;
  deductions: number | null;
  cantonalTax: number | null;
  federalTax: number | null;
  totalImposition: number | null;
}> {
  const tmpDir = '/tmp';
  const extId = Math.random().toString(36).substring(7);
  const tmpPath = `${tmpDir}/fiscal_${extId}.pdf`;

  const fileBuffer = await file.arrayBuffer();
  const fs = await import('fs');
  fs.writeFileSync(tmpPath, Buffer.from(fileBuffer));

  const { spawn } = await import('child_process');

  return new Promise((resolve) => {
    const child = spawn('node', ['/home/jndoye/shared/projects/konto/backend/scripts/parse-fiscal-pdf.cjs', tmpPath]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      try { fs.unlinkSync(tmpPath); } catch {}
      console.log('PDF parse result:', code, stdout, stderr);

      const nullResult = { year: null, country: null, revenuBrutGlobal: null, revenuImposable: null, partsFiscales: null, tauxMarginal: null, tauxMoyen: null, breakdown: null, deductions: null, cantonalTax: null, federalTax: null, totalImposition: null };

      if (code !== 0 || !stdout.trim()) {
        resolve(nullResult);
        return;
      }

      try {
        const jsonLine = stdout.trim().split('\n').find(l => l.trim().startsWith('{'));
        if (!jsonLine) throw new Error('No JSON in output');
        const parsed = JSON.parse(jsonLine);
        // Detect country from PDF content (CH keywords = Switzerland, else FR)
        const rawText = (stdout + stderr).toLowerCase();
        const detectedCountry = rawText.includes('lohnausweis') || rawText.includes('impôt à la source') || rawText.includes('salaire brut chf') ? 'CH' : 'FR';
        resolve({
          year: parsed.year || null,
          country: detectedCountry,
          revenuBrutGlobal: parsed.revenuBrutGlobal ?? null,
          revenuImposable: parsed.revenuImposable ?? null,
          partsFiscales: parsed.partsFiscales ?? null,
          tauxMarginal: parsed.tauxMarginal ?? null,
          tauxMoyen: parsed.tauxMoyen ?? null,
          breakdown: (parsed.salaries || parsed.lmnp || parsed.revenusFonciers) ? {
            salaries: parsed.salaries ?? null,
            lmnp: parsed.lmnp ?? null,
            dividendes: null,
            revenusFonciers: parsed.revenusFonciers ?? null,
          } : null,
          deductions: parsed.deductions ?? null,
          cantonalTax: parsed.cantonalTax ?? null,
          federalTax: parsed.federalTax ?? null,
          totalImposition: parsed.totalImposition ?? null,
        });
      } catch {
        resolve(nullResult);
      }
    });
  });
}

export default router;
