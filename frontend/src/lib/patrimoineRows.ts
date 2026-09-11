// Shared row model for the Synthèse patrimoine breakdown (donut + detailed table).
// Flattens the /api/dashboard payload into one line per holding so the donut,
// the legend and the table all agree on names, colours and percentages.

export const TYPE_COLORS: Record<string, string> = {
  checking: '#9ca3af',
  savings: '#3b82f6',
  investment: '#a855f7',
  crypto: '#f59e0b',
  loan: '#f97316',
  real_estate: '#22c55e',
  vehicle: '#eab308',
  valuable: '#ec4899',
  other: '#6b7280',
};

export const TYPE_LABELS: Record<string, string> = {
  checking: 'Comptes courants',
  savings: 'Épargne',
  investment: 'Investissements',
  crypto: 'Crypto',
  loan: 'Emprunts',
  real_estate: 'Immobilier',
  vehicle: 'Véhicules',
  valuable: 'Objets de valeur',
  other: 'Autres',
};

const PROPERTY_USAGE_LABELS: Record<string, string> = {
  principal: 'Résidence principale',
  rented_long: 'Bien locatif',
  rented_short: 'Location saisonnière',
  vacant: 'Bien vacant',
};

export const DEFAULT_COLOR = '#6b7280';

/** Sentinel colour key meaning "assign a distinct palette colour by position". */
export const AUTO_COLOR = '__auto__';

/** Distinct hues for per-holding slices, ordered to avoid adjacent collisions. */
const PALETTE = [
  '#7aa2f7', '#f7a8c4', '#8fb8f0', '#b39ddb', '#e59a87',
  '#c98b6b', '#e8c48a', '#9ed3a7', '#4db6a0', '#c1666b',
];

export type Side = 'actif' | 'passif';
export type GroupBy = 'asset' | 'type' | 'institution';

export interface PatrimoineRow {
  id: string;
  /** Matches holding_snapshots.holding_key, or null for synthetic rows. */
  holdingKey: string | null;
  name: string;
  subtitle: string | null;
  typeKey: string;
  typeLabel: string;
  institution: string | null;
  /** Always in EUR; the display-currency conversion happens at render time. */
  value: number;
  nativeValue: number | null;
  nativeCurrency: string | null;
  gain: number | null;
  gainPercent: number | null;
  side: Side;
}

interface DashAccount {
  id: number;
  name: string;
  balance: number;
  type: string;
  subtype: string | null;
  currency: string;
  bankName?: string | null;
  nativeBalance?: number | null;
  nativeCurrency?: string | null;
  gain?: number | null;
  gainPercent?: number | null;
}

interface DashAsset {
  id: number;
  type: string;
  name: string;
  currentValue: number;
  loanBalance: number;
  address?: string | null;
  propertyUsage?: string | null;
  acquisitionCost?: number | null;
  gain?: number | null;
  gainPercent?: number | null;
}

export interface BuildOptions {
  accountsByType: Record<string, DashAccount[]>;
  assets: DashAsset[];
  /** Net folds each asset's linked loan into its own value, as the rest of the page does. */
  showNet: boolean;
  hideCrypto: boolean;
}

/** One row per account and per asset, split into actif / passif. */
export function buildPatrimoineRows({
  accountsByType, assets, showNet, hideCrypto,
}: BuildOptions): PatrimoineRow[] {
  const rows: PatrimoineRow[] = [];

  for (const [type, list] of Object.entries(accountsByType || {})) {
    for (const a of list || []) {
      const isCrypto = a.subtype === 'crypto';
      if (isCrypto && hideCrypto) continue;

      // Loans are the passif side; their balances are stored negative.
      const isLoan = type === 'loan';
      const typeKey = isCrypto ? 'crypto' : type;
      // Already in EUR from /api/dashboard; formatCurrency converts once at render.
      const value = a.balance;
      if (value === 0) continue;

      const native = a.nativeBalance ?? null;
      const nativeCurrency = a.nativeCurrency ?? null;
      // Only worth showing a second line when it differs from what we already display.
      const showNative = native != null && nativeCurrency != null && nativeCurrency !== 'EUR';

      rows.push({
        id: `account-${a.id}`,
        holdingKey: `account:${a.id}`,
        name: a.name,
        subtitle: a.bankName || TYPE_LABELS[typeKey] || null,
        typeKey,
        typeLabel: TYPE_LABELS[typeKey] || typeKey,
        institution: a.bankName || null,
        value: isLoan ? Math.abs(value) : value,
        nativeValue: showNative ? native : null,
        nativeCurrency: showNative ? nativeCurrency : null,
        gain: a.gain ?? null,
        gainPercent: a.gainPercent ?? null,
        side: isLoan ? 'passif' : 'actif',
      });
    }
  }

  for (const asset of assets || []) {
    // loanBalance is negative; in net mode it reduces the asset's own value.
    const value = showNet ? asset.currentValue + asset.loanBalance : asset.currentValue;
    const typeKey = asset.type || 'other';
    if (value !== 0) {
      rows.push({
        id: `asset-${asset.id}`,
        holdingKey: `asset:${asset.id}`,
        name: asset.address || asset.name,
        subtitle: asset.propertyUsage
          ? PROPERTY_USAGE_LABELS[asset.propertyUsage] || null
          : TYPE_LABELS[typeKey] || null,
        typeKey,
        typeLabel: TYPE_LABELS[typeKey] || typeKey,
        institution: null,
        value,
        nativeValue: null,
        nativeCurrency: null,
        gain: asset.gain ?? null,
        gainPercent: asset.gainPercent ?? null,
        side: value < 0 ? 'passif' : 'actif',
      });
    }

    // In brut mode the linked loan stands on its own as a passif line.
    if (!showNet && asset.loanBalance) {
      rows.push({
        id: `asset-loan-${asset.id}`,
        holdingKey: null,
        name: `Emprunt — ${asset.address || asset.name}`,
        subtitle: TYPE_LABELS.loan,
        typeKey: 'loan',
        typeLabel: TYPE_LABELS.loan,
        institution: null,
        value: Math.abs(asset.loanBalance),
        nativeValue: null,
        nativeCurrency: null,
        gain: null,
        gainPercent: null,
        side: 'passif',
      });
    }
  }

  return rows;
}

export interface GroupedSlice {
  key: string;
  label: string;
  value: number;
  colorKey: string;
  /** Rows folded into this slice, for the "Par actif" drill-down. */
  rows: PatrimoineRow[];
}

/** Collapse rows into donut slices according to the selected grouping. */
export function groupRows(rows: PatrimoineRow[], groupBy: GroupBy): GroupedSlice[] {
  if (groupBy === 'asset') {
    // Per-holding view: every slice gets its own colour rather than its type's,
    // so neighbouring properties stay distinguishable.
    return rows
      .map(r => ({ key: r.id, label: r.name, value: r.value, colorKey: AUTO_COLOR, rows: [r] }))
      .sort((a, b) => b.value - a.value);
  }

  const buckets = new Map<string, GroupedSlice>();
  for (const r of rows) {
    const key = groupBy === 'type' ? r.typeKey : (r.institution || 'other');
    const label = groupBy === 'type' ? r.typeLabel : (r.institution || 'Non rattaché');
    const existing = buckets.get(key);
    if (existing) {
      existing.value += r.value;
      existing.rows.push(r);
    } else {
      buckets.set(key, { key, label, value: r.value, colorKey: groupBy === 'type' ? r.typeKey : key, rows: [r] });
    }
  }
  return [...buckets.values()].sort((a, b) => b.value - a.value);
}

/**
 * Keep the chart readable: show the biggest slices individually and fold the
 * long tail into a single "Autre" slice, as in the reference design.
 */
export function withOtherBucket(slices: GroupedSlice[], maxSlices: number): GroupedSlice[] {
  if (slices.length <= maxSlices) return slices;
  const head = slices.slice(0, maxSlices - 1);
  const tail = slices.slice(maxSlices - 1);
  const rest = tail.reduce((s, x) => s + x.value, 0);
  if (rest <= 0) return head;
  return [
    ...head,
    { key: '__other__', label: 'Autre', value: rest, colorKey: 'other', rows: tail.flatMap(t => t.rows) },
  ];
}

/** Colour for a slice: its type colour when grouped, else a distinct palette hue. */
export function sliceColor(colorKey: string, index: number): string {
  if (colorKey !== AUTO_COLOR && TYPE_COLORS[colorKey]) return TYPE_COLORS[colorKey];
  return PALETTE[index % PALETTE.length] || DEFAULT_COLOR;
}
