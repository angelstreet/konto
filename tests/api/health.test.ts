import { describe, it, expect } from 'vitest';

const API = 'http://localhost:3004';

describe('GET /api/health', () => {
  it('returns status ok', async () => {
    const res = await fetch(`${API}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('returns a valid ISO timestamp', async () => {
    const res = await fetch(`${API}/api/health`);
    const body = await res.json();
    expect(body.timestamp).toBeDefined();
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });
});
