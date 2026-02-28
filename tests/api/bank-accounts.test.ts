import { describe, it, expect } from 'vitest';

const API = 'http://localhost:3004';

describe('GET /api/bank/accounts', () => {
  it('returns an array of bank accounts', async () => {
    const res = await fetch(`${API}/api/bank/accounts`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('PATCH /api/bank/accounts/:id', () => {
  it('returns 400 when body is empty', async () => {
    const res = await fetch(`${API}/api/bank/accounts/1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});
