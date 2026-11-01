import { describe, it, expect } from 'vitest';

/**
 * /api/settings/integrations (GET/PUT) — per-user encrypted API keys for
 * external services (e.g. Smoobu). Needs Clerk auth, so each test accepts
 * either the authenticated result or a 401.
 *
 * Was written against @playwright/test, which is not a dependency and has no
 * config here, so this file could not even be collected. Rewritten in the same
 * vitest + fetch style as the rest of tests/api.
 */
const API = process.env.TEST_API_BASE || 'http://localhost:3004';
const AUTH = { Authorization: `Bearer ${process.env.TEST_BEARER_TOKEN || ''}` };

describe('GET /api/settings/integrations', () => {
  it('returns a masked smoobu_api_key, or 401', async () => {
    const res = await fetch(`${API}/api/settings/integrations`, { headers: AUTH });
    if (res.status === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('smoobu_api_key');
      // Never the plaintext key: either absent or masked.
      expect(body.smoobu_api_key === null || body.smoobu_api_key === '••••••••').toBe(true);
    } else {
      expect(res.status).toBe(401);
    }
  });
});

describe('PUT /api/settings/integrations', () => {
  it('stores an encrypted Smoobu API key, or 401', async () => {
    const res = await fetch(`${API}/api/settings/integrations`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...AUTH },
      body: JSON.stringify({ smoobu_api_key: 'test-smoobu-key-12345' }),
    });
    if (res.status === 200) {
      expect(await res.json()).toHaveProperty('ok', true);
    } else {
      expect(res.status).toBe(401);
    }
  });

  it('removes the key when given null, or 401', async () => {
    const res = await fetch(`${API}/api/settings/integrations`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...AUTH },
      body: JSON.stringify({ smoobu_api_key: null }),
    });
    if (res.status === 200) {
      expect(await res.json()).toHaveProperty('ok', true);
    } else {
      expect(res.status).toBe(401);
    }
  });
});
