import { describe, it, expect } from 'vitest';

const API = process.env.TEST_API_BASE || 'http://localhost:3004';

describe('GET /api/properties/:assetId/arbitrage', () => {
  it('rejects a non-numeric asset id', async () => {
    const res = await fetch(`${API}/api/properties/not-a-number/arbitrage`);
    expect(res.status).toBe(400);
  });

  it('404s on an asset that does not exist', async () => {
    const res = await fetch(`${API}/api/properties/99999999/arbitrage`);
    expect(res.status).toBe(404);
  });

  it('returns the inputs the sell-or-hold page needs, for every property', async () => {
    const assetsRes = await fetch(`${API}/api/assets?type=real_estate`);
    expect(assetsRes.status).toBe(200);
    const assets = await assetsRes.json();
    if (!Array.isArray(assets) || assets.length === 0) return;   // nothing seeded here

    for (const asset of assets) {
      const res = await fetch(`${API}/api/properties/${asset.id}/arbitrage`);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.property.id).toBe(asset.id);
      expect(typeof body.property.value).toBe('number');
      expect(typeof body.property.is_primary_residence).toBe('boolean');

      // The two editable cells always come pre-filled, never undefined.
      for (const key of ['annual_rent', 'annual_cost', 'selling_costs']) {
        expect(typeof body.defaults[key]).toBe('number');
        expect(Number.isFinite(body.defaults[key])).toBe(true);
      }
      expect(body.defaults.annual_cost).toBe(body.recorded.annual_charges);

      // A loan is either absent or carries what the projection needs.
      if (body.loan) {
        expect(body.loan.balance).toBeGreaterThanOrEqual(0);   // stored negative, served positive
        expect(typeof body.loan.incomplete).toBe('boolean');
      } else {
        expect(body.warnings).toContain('no_loan_linked');
      }

      expect(Array.isArray(body.warnings)).toBe(true);
    }
  });

  it('keeps the asset_id on the ROI payload so the cards can link here', async () => {
    const res = await fetch(`${API}/api/properties/roi?months=12`);
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const p of body.properties || []) {
      expect(p).toHaveProperty('asset_id');
    }
  });
});
