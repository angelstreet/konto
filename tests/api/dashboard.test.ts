import { describe, it, expect } from 'vitest';

const API = 'http://localhost:5004';

describe('GET /api/users', () => {
  it('returns an array with at least the default user', async () => {
    const res = await fetch(`${API}/api/users`);
    expect(res.status).toBe(200);
    const users = await res.json();
    expect(Array.isArray(users)).toBe(true);
    expect(users.length).toBeGreaterThanOrEqual(1);
    expect(users[0]).toHaveProperty('email');
  });
});

describe('GET /api/dashboard', () => {
  it('returns dashboard shape with expected fields', async () => {
    const res = await fetch(`${API}/api/dashboard`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('financial');
    expect(body).toHaveProperty('patrimoine');
    expect(body).toHaveProperty('totals');
    expect(body).toHaveProperty('accountCount');
    expect(body).toHaveProperty('companyCount');
    expect(typeof body.financial.brutBalance).toBe('number');
    expect(typeof body.financial.netBalance).toBe('number');
    expect(body.financial).toHaveProperty('accountsByType');
    expect(typeof body.patrimoine.brutValue).toBe('number');
    expect(typeof body.patrimoine.netValue).toBe('number');
    expect(typeof body.totals.brut).toBe('number');
    expect(typeof body.totals.net).toBe('number');
  });
});
