export type ComparableSale = {
  price: number;
  surface: number;
  pricePerM2: number;
  date: string;
  type: string;
  lat: number;
  lon: number;
  distance: number;
};

export type PropertyEstimationResult = {
  estimation: {
    pricePerM2: number;
    estimatedValue: number;
    range: { low: number; high: number };
    pricePerM2Range: { low: number; median: number; high: number; mean: number };
  };
  comparables: Array<{ price: number; surface: number; pricePerM2: number; date: string; type: string; distance: number }>;
  meta: {
    totalSales: number;
    sameTypeSales: number;
    comparablesUsed: number;
    years: string[];
    propertyType: string;
    surface: number;
  };
};

export async function estimatePropertyPrice(params: {
  citycode: string;
  lat: number;
  lon: number;
  surface: number;
  propertyType?: string;
}): Promise<PropertyEstimationResult | null> {
  const { citycode, lat, lon, surface } = params;
  const propertyType = params.propertyType || 'Appartement';
  const dept = citycode.substring(0, 2);
  const years = ['2024', '2023', '2022'];

  const allSales: ComparableSale[] = [];

  for (const year of years) {
    try {
      const res = await fetch(`https://files.data.gouv.fr/geo-dvf/latest/csv/${year}/communes/${dept}/${citycode}.csv`);
      if (!res.ok) continue;

      const csv = await res.text();
      const lines = csv.split('\n');
      if (lines.length < 2) continue;

      const header = lines[0].split(',');
      const idx = {
        nature: header.indexOf('nature_mutation'),
        valeur: header.indexOf('valeur_fonciere'),
        type_local: header.indexOf('type_local'),
        surface: header.indexOf('surface_reelle_bati'),
        date: header.indexOf('date_mutation'),
        lat: header.indexOf('latitude'),
        lon: header.indexOf('longitude'),
      };

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols[idx.nature] !== 'Vente') continue;

        const type = cols[idx.type_local];
        if (type !== 'Appartement' && type !== 'Maison') continue;

        const price = parseFloat(cols[idx.valeur]);
        const surf = parseFloat(cols[idx.surface]);
        if (!price || !surf || surf < 9) continue;

        const sLat = parseFloat(cols[idx.lat]);
        const sLon = parseFloat(cols[idx.lon]);
        const dist = lat && lon && sLat && sLon
          ? Math.sqrt(
              Math.pow((sLat - lat) * 111000, 2) +
              Math.pow((sLon - lon) * 111000 * Math.cos((lat * Math.PI) / 180), 2)
            )
          : 99999;

        allSales.push({
          price,
          surface: surf,
          pricePerM2: price / surf,
          date: cols[idx.date],
          type,
          lat: sLat,
          lon: sLon,
          distance: Math.round(dist),
        });
      }
    } catch {
      // Ignore per-year failures and continue with available years
    }
  }

  if (allSales.length === 0) return null;

  const sameType = allSales.filter((s) => s.type === propertyType);
  const dataset = sameType.length >= 5 ? sameType : allSales;
  dataset.sort((a, b) => a.distance - b.distance);

  const comparables = dataset.slice(0, 50);
  const prices = comparables.map((s) => s.pricePerM2).sort((a, b) => a - b);

  const median = prices[Math.floor(prices.length / 2)];
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const low = prices[Math.floor(prices.length * 0.25)];
  const high = prices[Math.floor(prices.length * 0.75)];

  return {
    estimation: {
      pricePerM2: Math.round(median),
      estimatedValue: Math.round(median * surface),
      range: { low: Math.round(low * surface), high: Math.round(high * surface) },
      pricePerM2Range: {
        low: Math.round(low),
        median: Math.round(median),
        high: Math.round(high),
        mean: Math.round(mean),
      },
    },
    comparables: comparables.slice(0, 10).map((s) => ({
      price: s.price,
      surface: s.surface,
      pricePerM2: Math.round(s.pricePerM2),
      date: s.date,
      type: s.type,
      distance: s.distance,
    })),
    meta: {
      totalSales: allSales.length,
      sameTypeSales: sameType.length,
      comparablesUsed: comparables.length,
      years,
      propertyType,
      surface,
    },
  };
}
