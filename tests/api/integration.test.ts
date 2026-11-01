import { describe, it, expect } from 'vitest';

// Was written against @playwright/test, which is not a dependency and has no
// config here, so this file could not even be collected. Rewritten in the same
// vitest + fetch style as the rest of tests/api.
const API = process.env.TEST_API_BASE || 'http://localhost:3004';

describe('GET /api/integration/status', () => {
  it('returns the shape ClawBox discovers the app with', async () => {
    // Returns 200 even unauthenticated, with authenticated: false.
    const res = await fetch(`${API}/api/integration/status`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty('app_id', 'konto');
    for (const field of [
      'authenticated', 'auth_mode', 'exists', 'local_user_id',
      'clerk_user_id', 'onboarded', 'available_features', 'summary',
    ]) {
      expect(body).toHaveProperty(field);
    }

    for (const field of [
      'has_bank_connections', 'has_accounts', 'has_loans', 'has_assets', 'counts',
    ]) {
      expect(body.summary).toHaveProperty(field);
    }

    for (const field of ['bank_connections', 'accounts', 'loans', 'assets']) {
      expect(body.summary.counts).toHaveProperty(field);
      expect(typeof body.summary.counts[field]).toBe('number');
    }
  });
});
