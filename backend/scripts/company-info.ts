/**
 * Fetch detailed company info from free sources.
 * Usage: Called by backend API endpoint /api/companies/info/:siren
 * 
 * Sources:
 * 1. recherche-entreprises.api.gouv.fr (free, no key) — SIREN, SIRET, NAF, address, legal form code
 * 2. societe.com scraping — capital social, TVA number, RCS
 */

export interface CompanyInfo {
  siren: string;
  siret: string;
  name: string;
  legal_form: string;
  legal_form_code: string;
  capital_social: number | null;
  address: string;
  postal_code: string;
  city: string;
  naf_code: string;
  naf_label: string;
  date_creation: string;
  tva_number: string | null;
  rcs: string | null;
  category: string;
}

// Map nature_juridique codes to labels
const LEGAL_FORMS: Record<string, string> = {
  '1000': 'Entrepreneur individuel',
  '5410': 'SARL',
  '5485': 'SARL unipersonnelle (EURL)',
  '5498': 'SARL',
  '5499': 'SAS',
  '5710': 'SAS',
  '5720': 'SASU',
  '6540': 'SCI',
  '6541': 'SCI de construction-vente',
  '6543': 'SCI d\'attribution',
};

function legalFormLabel(code: string): string {
  return LEGAL_FORMS[code] || `Code ${code}`;
}

// Calculate French TVA number from SIREN
function computeTVA(siren: string): string {
  const sirenNum = parseInt(siren, 10);
  const key = (12 + 3 * (sirenNum % 97)) % 97;
  return `FR${String(key).padStart(2, '0')}${siren}`;
}

export async function fetchCompanyInfo(siren: string): Promise<CompanyInfo | null> {
  // 1. Fetch from gouv.fr
  const gouvRes = await fetch(
    `https://recherche-entreprises.api.gouv.fr/search?q=${siren}&page=1&per_page=1`
  );
  const gouvData = await gouvRes.json() as any;
  const company = gouvData.results?.[0];
  if (!company || company.siren !== siren) return null;

  const siege = company.siege || {};

  // 2. Try to get capital social from societe.com
  let capitalSocial: number | null = null;
  let rcs: string | null = null;
  try {
    const slug = (company.nom_complet || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const url = `https://www.societe.com/societe/${slug}-${siren}.html`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
    });
    const html = await res.text();
    
    // Extract capital social
    const capitalMatch = html.match(/Capital\s*(?:social)?\s*[\s\S]*?(\d[\d\s,.]+)\s*€/i);
    if (capitalMatch) {
      capitalSocial = parseFloat(capitalMatch[1].replace(/\s/g, '').replace(',', '.'));
    }
    
    // Extract RCS
    const rcsMatch = html.match(/R\.?C\.?S\.?\s+([\w\s-]+?)(?:\s*<|$)/i);
    if (rcsMatch) {
      rcs = rcsMatch[1].trim();
    }
  } catch {
    // societe.com scraping failed, continue without capital
  }

  return {
    siren: company.siren,
    siret: siege.siret || '',
    name: company.nom_complet || '',
    legal_form: legalFormLabel(String(company.nature_juridique || '')),
    legal_form_code: String(company.nature_juridique || ''),
    capital_social: capitalSocial,
    address: siege.adresse || siege.geo_adresse || '',
    postal_code: siege.code_postal || '',
    city: siege.libelle_commune || '',
    naf_code: company.activite_principale || '',
    naf_label: company.libelle_activite_principale || '',
    date_creation: company.date_creation || siege.date_creation || '',
    tva_number: computeTVA(siren),
    rcs: rcs || `${siren} R.C.S. ${siege.libelle_commune || ''}`,
    category: company.categorie_entreprise || '',
  };
}
