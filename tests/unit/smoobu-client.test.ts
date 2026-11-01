import { describe, expect, test } from 'vitest';
import { parseSmoobuCredentials, serializeSmoobuCredentials, signSmoobuRequest } from '../../backend/src/smoobu-client.js';

// Example values from Smoobu's HMAC docs; expected signatures cross-checked with the openssl recipe there.
const creds = { keyId: 'usr_live_abc123', secret: 'your_api_secret' };
const ts = '2026-04-01T12:00:00Z';
const nonce = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

describe('Smoobu HMAC signing', () => {
  test('GET signs the sorted query string', () => {
    const h = signSmoobuRequest(creds, 'GET', '/api/reservations?to=2026-04-10&from=2026-04-01', '', ts, nonce);
    expect(h['X-Signature']).toBe('Bu2/61pneyRyjQejH7PoCJC2P8iRm3NnC9R6CGFOQho=');
    expect(h['X-API-Key']).toBe(creds.keyId);
  });

  test('POST signs the body hash', () => {
    const h = signSmoobuRequest(creds, 'POST', '/api/reservations', '{"arrival":"2026-11-01"}', ts, nonce);
    expect(h['X-Signature']).toBe('/P3dpE5fJ2qlpQy3e4vaOj2TDfgGb4X++S+C5tvx5dQ=');
  });

  test('stored value round-trips; legacy plain keys stay readable', () => {
    expect(parseSmoobuCredentials(serializeSmoobuCredentials(creds))).toEqual(creds);
    expect(parseSmoobuCredentials('legacy-key')).toEqual({ keyId: 'legacy-key' });
  });
});
