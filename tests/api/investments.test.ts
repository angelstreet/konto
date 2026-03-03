import { describe, it, expect } from 'vitest';

const API = process.env.TEST_API_BASE || 'http://localhost:3004';

describe('GET /api/investments', () => {
  it('returns 200 and valid payload shape', async () => {
    const res = await fetch(`${API}/api/investments`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('investments');
    expect(Array.isArray(body.investments)).toBe(true);
  });

  it('supports company filter query', async () => {
    const res = await fetch(`${API}/api/investments?company_id=1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('investments');
    expect(Array.isArray(body.investments)).toBe(true);
  });
});
