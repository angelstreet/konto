import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5004';

test.describe('Integration Status API', () => {
  test('GET /api/integration/status returns correct structure', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/integration/status`);
    
    // Should return 200 (even if not authenticated, returns authenticated: false)
    expect(response.status()).toBe(200);
    
    const body = await response.json();
    
    // Check top-level fields
    expect(body).toHaveProperty('app_id', 'konto');
    expect(body).toHaveProperty('authenticated');
    expect(body).toHaveProperty('auth_mode');
    expect(body).toHaveProperty('exists');
    expect(body).toHaveProperty('local_user_id');
    expect(body).toHaveProperty('clerk_user_id');
    expect(body).toHaveProperty('onboarded');
    expect(body).toHaveProperty('available_features');
    expect(body).toHaveProperty('summary');
    
    // Summary should have counts
    expect(body.summary).toHaveProperty('has_bank_connections');
    expect(body.summary).toHaveProperty('has_accounts');
    expect(body.summary).toHaveProperty('has_loans');
    expect(body.summary).toHaveProperty('has_assets');
    expect(body.summary).toHaveProperty('counts');
    expect(body.summary.counts).toHaveProperty('bank_connections');
    expect(body.summary.counts).toHaveProperty('accounts');
    expect(body.summary.counts).toHaveProperty('loans');
    expect(body.summary.counts).toHaveProperty('assets');
  });
});
