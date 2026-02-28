export interface CategoryResult {
  category: string;
  icon: string;
  color: string;
}

const RULES: Array<{ pattern: RegExp; category: string; icon: string; color: string }> = [
  // Assurance
  { pattern: /AXA|MAIF|ALLIANZ|MACIF|MMA|ASSURANCE|MUTUELLE|APRIL|AVIVA|GENERALI|GROUPAMA|CNP/, category: 'assurance', icon: '🛡️', color: '#3b82f6' },
  // Telecom
  { pattern: /BOUYGUES|SFR|FREE|ORANGE|TELECOM|NUMERICABLE|BYTEL/, category: 'telecom', icon: '📱', color: '#a855f7' },
  // Auto
  { pattern: /AUTOMOBILE|DIAC|HERTZ|SIXT|AUTOLIB|CARGLASS|EUROPCAR|RENAULT|PEUGEOT|TOYOTA|LEASEPLAN|ARVAL/, category: 'auto', icon: '🚗', color: '#f97316' },
  // Impôts
  { pattern: /DIRECTION GENERALE|IMPOTS|DGFIP|TRESOR PUBLIC|AMENDES|AMENDE|IMPÔT|PREL\.OBL\.|PREL\.SOC\./, category: 'impôts', icon: '🏛️', color: '#ef4444' },
  // Énergie
  { pattern: /EDF|ENGIE|VEOLIA|GAZ|ELECTRICITE|TOTALENERGIES|DIRECT ENERGIE|EKWATEUR|EAU DE/, category: 'énergie', icon: '⚡', color: '#eab308' },
  // Logement / prêt immobilier
  { pattern: /LOYER|PENSION|KEYLIA|FONCIA|HABITATION|ECH PRET|PRET IMM|CREDIT FONCIER|NEXITY|ORPI|SELOGER|PLV PARTIEL ECH/, category: 'logement', icon: '🏠', color: '#22c55e' },
  // Alimentation
  { pattern: /CARREFOUR|LECLERC|LIDL|AUCHAN|MONOPRIX|INTERMARCHE|CASINO|FRANPRIX|PICARD|NATURALIA|BIOCOOP|MATCH|CORA|SYSTEME U|SUPER U/, category: 'alimentation', icon: '🛒', color: '#84cc16' },
  // Shopping (card payments = catch-all for CB, then specific merchants)
  { pattern: /AMAZON|FNAC|CDISCOUNT|DARTY|BOULANGER|LA REDOUTE|ZALANDO|ASOS|SHEIN|IKEA|DECATHLON|PAIEMENT CB/, category: 'shopping', icon: '🛍️', color: '#ec4899' },
  // Transport
  { pattern: /SNCF|RATP|UBER|BOLT|TIER|TRANSDEV|KEOLIS|FLIXBUS|OUIGO|BLABLACAR|LIME|BIRD|CITYSCOOT|KAPTEN/, category: 'transport', icon: '🚆', color: '#14b8a6' },
  // Loisirs
  { pattern: /NETFLIX|SPOTIFY|DISNEY|CANAL|DEEZER|AMAZON PRIME|YOUTUBE|STEAM|PLAYSTATION|XBOX|FNAC SPECTACLES/, category: 'loisirs', icon: '🎬', color: '#6366f1' },
  // Investissement — stock/ETF purchases, assurance-vie rebalancing
  { pattern: /ACHAT.*BOURSE|BOURSE.*TITRES|ARBITRAGE|EQUILIBRAGE/, category: 'investissement', icon: '📈', color: '#0ea5e9' },
  // Immobilier — concierge, syndic, property management
  { pattern: /CONCIERGERIE|SYNDIC|GESTIONNAIRE|AGENCE IMMO/, category: 'immobilier', icon: '🏘️', color: '#059669' },
  // Juridique — bailiff, legal
  { pattern: /HUISSIER|AVOCAT|NOTAIRE|TRIBUNAL/, category: 'juridique', icon: '⚖️', color: '#dc2626' },
  // Services — recurring invoices (FACT SGT etc.)
  { pattern: /FACT SGT|FACTURE/, category: 'services', icon: '📄', color: '#8b5cf6' },
  // Virement — broad
  { pattern: /VIR SEPA|VIR INST|VIREMENT|\bVIR\b|VIR |VIR\/|COMPTE COURANT|VIR C\/C/, category: 'virement', icon: '💸', color: '#6b7280' },
  // Frais bancaires
  { pattern: /COTISATION|TENUE DE COMPTE|COMMISSION D'INTERVENTION|FRAIS CONVENTION|FRAIS PAIE CB|F COTIS|FRAIS GESTION|FRAIS DE TENUE|FRAIS DOSSIER/, category: 'frais bancaires', icon: '🏦', color: '#78716c' },
  // Retrait
  { pattern: /RETRAIT DAB|RETRAIT/, category: 'retrait', icon: '💵', color: '#a3a3a3' },
];

const PRLV_SEPA: CategoryResult = { category: 'prélèvement', icon: '📋', color: '#6b7280' };
const UNCATEGORIZED: CategoryResult = { category: 'autre', icon: '❓', color: '#9ca3af' };

export function categorizeTransaction(label: string): CategoryResult {
  const upper = (label || '').toUpperCase();
  for (const rule of RULES) {
    if (rule.pattern.test(upper)) {
      return { category: rule.category, icon: rule.icon, color: rule.color };
    }
  }
  // Broad PRLV catch-all (covers PRLV FAC, PRLV OBL, etc.)
  if (/PRLV/.test(upper)) return PRLV_SEPA;
  return UNCATEGORIZED;
}
