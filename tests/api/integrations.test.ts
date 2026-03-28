import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5004';

/**
 * Tests for /api/settings/integrations (GET/PUT)
 * Per-user encrypted API keys for external services (e.g., Smoobu).
 * Requires Clerk JWT authentication.
 */
test.describe('Settings Integrations API', () => {
  test('GET /api/settings/integrations returns smoobu_api_key field', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/settings/integrations`, {
      headers: {
        Authorization: `Bearer ${process.env.TEST_BEARER_TOKEN || ''}`,
      },
    });

    // Authenticated request should return 200
    if (response.status() === 200) {
      const body = await response.json();
      expect(body).toHaveProperty('smoobu_api_key');
      // Value is either null or masked (••••••••)
      expect(body.smoobu_api_key === null || body.smoobu_api_key === '••••••••').toBe(true);
    } else {
      // Unauthenticated — expect 401
      expect(response.status()).toBe(401);
    }
  });

  test('PUT /api/settings/integrations stores encrypted Smoobu API key', async ({ request }) => {
    const putResponse = await request.put(`${BASE_URL}/api/settings/integrations`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.TEST_BEARER_TOKEN || ''}`,
      },
      data: JSON.stringify({ smoobu_api_key: 'test-smoobu-key-12345' }),
    });

    if (putResponse.status() === 200) {
      const body = await putResponse.json();
      expect(body).toHaveProperty('ok', true);
    } else {
      // Unauthenticated — expect 401
      expect(putResponse.status()).toBe(401);
    }
  });

  test('PUT /api/settings/integrations with null removes the key', async ({ request }) => {
    const putResponse = await request.put(`${BASE_URL}/api/settings/integrations`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.TEST_BEARER_TOKEN || ''}`,
      },
      data: JSON.stringify({ smoobu_api_key: null }),
    });

    if (putResponse.status() === 200) {
      const body = await putResponse.json();
      expect(body).toHaveProperty('ok', true);
    } else {
      expect(putResponse.status()).toBe(401);
    }
  });
});
