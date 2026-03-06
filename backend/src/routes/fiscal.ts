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
  let text = '';
  
  try {
    const fileBuffer = await file.arrayBuffer();
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse(new Uint8Array(fileBuffer));
    const result = await parser.getText();
    text = result.text || '';
  } catch (e: any) {
    console.error('PDF parse error:', e.message);
    return {
      revenuBrutGlobal: null,
      revenuImposable: null,
      partsFiscales: null,
      tauxMarginal: null,
      tauxMoyen: null,
      breakdown: null
    };
  }

  // French avis d'imposition patterns - more flexible matching
  // Revenu brut global - try multiple patterns
  let revenuBrutGlobal: number | null = null;
  const brutPatterns = [
    /revenu\s*brut\s*global[\s\S]{0,50}?(\d{1,3}\s\d{3})/i,
    /Revenu\s*brut\s*global[\s\S]{0,50}?(\d{1,3}\s\d{3})/i,
    /\b(\d{1,3}\s\d{3})\b.*revenu.*brut.*global/i
  ];
  for (const p of brutPatterns) {
    const m = text.match(p);
    if (m) {
      revenuBrutGlobal = parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
      break;
    }
  }

  // Revenu imposable
  let revenuImposable: number | null = null;
  const imposablePatterns = [
    /revenu\s*imposable[\s\S]{0,50}?(\d{1,3}\s\d{3})/i,
    /Revenu\s*imposable[\s\S]{0,50}?(\d{1,3}\s\d{3})/i
  ];
  for (const p of imposablePatterns) {
    const m = text.match(p);
    if (m) {
      revenuImposable = parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
      break;
    }
  }

  // Parts fiscales
  let partsFiscales: number | null = null;
  const partsMatch = text.match(/Nombre\s+de\s+parts[\s\S]{0,30}?(\d+[.,]?\d*)/i);
  if (partsMatch) {
    partsFiscales = parseFloat(partsMatch[1].replace(',', '.'));
  }

  // Taux marginal d'imposition (TMI)
  let tauxMarginal: number | null = null;
  const tmiMatch = text.match(/taux\s+marginal.*?(\d+)\s*%/im);
  if (tmiMatch) {
    tauxMarginal = parseFloat(tmiMatch[1]);
  }

  // Taux moyen d'imposition
  let tauxMoyen: number | null = null;
  const tmmMatch = text.match(/taux\s+moyen.*?(\d+[.,]?\d*)\s*%/im);
  if (tmmMatch) {
    tauxMoyen = parseFloat(tmmMatch[1].replace(',', '.'));
  }

  // Breakdown - Salaires (salaires nets)
  let salaries: number | null = null;
  const salPatterns = [
    /salaires?[,\s\S]{0,30}?(\d{1,3}\s\d{3})/i,
    /Salaires[\s\S]{0,50}?(\d{1,3}\s\d{3})/i
  ];
  for (const p of salPatterns) {
    const m = text.match(p);
    if (m) {
      salaries = parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
      break;
    }
  }

  // Breakdown - LMNP (Loueur Meublé Non Professionnel)
  let lmnp: number | null = null;
  const lmnpPatterns = [
    /locations?\s*meublées?\s*non?\s*professionnelles?[\s\S]{0,30}?(\d{1,3}\s\d{3})/i,
    /lmnp[\s\S]{0,30}?(\d{1,3}\s\d{3})/i
  ];
  for (const p of lmnpPatterns) {
    const m = text.match(p);
    if (m) {
      lmnp = parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
      break;
    }
  }

  // Breakdown - Dividendes
  let dividendes: number | null = null;
  const divMatch = text.match(/dividendes?[^\d]*?([\d\s]+[.,]\d{0,2})/i);
  if (divMatch) {
    dividendes = parseFloat(divMatch[1].replace(/\s/g, '').replace(',', '.'));
  }

  // Breakdown - Revenus fonciers
  let revenusFonciers: number | null = null;
  const fonMatch = text.match(/revenus?\s+fonciers?[^\d]*?([\d\s]+[.,]\d{0,2})/i);
  if (fonMatch) {
    revenusFonciers = parseFloat(fonMatch[1].replace(/\s/g, '').replace(',', '.'));
  }

  const breakdown = (salaries || lmnp || dividendes || revenusFonciers) ? {
    salaries,
    lmnp,
    dividendes,
    revenusFonciers
  } : null;

  return {
    revenuBrutGlobal,
    revenuImposable,
    partsFiscales,
    tauxMarginal,
    tauxMoyen,
    breakdown
  };
}

export default router;
