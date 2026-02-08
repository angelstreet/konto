import { describe, it, expect } from 'vitest';

const API = 'http://localhost:3004';

describe('Companies CRUD', () => {
  let createdId: number;

  it('GET /api/companies — lists companies', async () => {
    const res = await fetch(`${API}/api/companies`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('POST /api/companies — creates a company', async () => {
    const res = await fetch(`${API}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '__test_company__',
        siren: '999999999',
        legal_form: 'SAS',
        address: '1 rue du test',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.name).toBe('__test_company__');
    createdId = body.id;
  });

  it('PATCH /api/companies/:id — updates the company', async () => {
    const res = await fetch(`${API}/api/companies/${createdId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '__test_company_updated__' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('__test_company_updated__');
  });

  it('PATCH /api/companies/:id — empty body returns 400', async () => {
    const res = await fetch(`${API}/api/companies/${createdId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('POST /api/companies/:id/unlink-all — unlinks accounts', async () => {
    const res = await fetch(`${API}/api/companies/${createdId}/unlink-all`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('DELETE /api/companies/:id — deletes the company', async () => {
    const res = await fetch(`${API}/api/companies/${createdId}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('GET /api/companies — deleted company is gone', async () => {
    const res = await fetch(`${API}/api/companies`);
    const body = await res.json();
    const found = body.find((c: any) => c.id === createdId);
    expect(found).toBeUndefined();
  });
});
