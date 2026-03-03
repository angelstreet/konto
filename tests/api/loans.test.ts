import { describe, it, expect } from 'vitest';

const API = process.env.TEST_API_BASE || 'http://localhost:3004';

describe('GET /api/loans', () => {
  it('returns loans overview payload', async () => {
    const res = await fetch(`${API}/api/loans`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('date');
    expect(body).toHaveProperty('total_outstanding');
    expect(body).toHaveProperty('summary');
    expect(body).toHaveProperty('distribution');
    expect(body).toHaveProperty('timeline');
    expect(body).toHaveProperty('loans');
    expect(Array.isArray(body.loans)).toBe(true);
  });
});

describe('GET /api/loans/export.csv', () => {
  it('returns csv content', async () => {
    const res = await fetch(`${API}/api/loans/export.csv`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.includes('loan_id,name')).toBe(true);
  });
});

