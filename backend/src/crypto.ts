/**
 * AES-256-GCM encryption utilities for sensitive DB columns.
 * Encrypted format: base64(IV[12] || AuthTag[16] || Ciphertext)
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;   // 96-bit IV (recommended for GCM)
const TAG_LEN = 16;  // 128-bit auth tag

/**
 * Returns the 32-byte encryption key from DB_ENCRYPTION_KEY env var.
 * Throws if not set or wrong length.
 */
function getKey(): Buffer {
  const hex = process.env.DB_ENCRYPTION_KEY;
  if (!hex) throw new Error('DB_ENCRYPTION_KEY is not set');
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) throw new Error('DB_ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
  return key;
}

/**
 * Encrypt a plaintext string.
 * Returns a base64-encoded blob: IV || AuthTag || Ciphertext.
 * Returns null for null/undefined input.
 */
export function encrypt(plaintext: string | null | undefined): string | null {
  if (plaintext == null) return null;
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Concatenate: iv (12) + tag (16) + ciphertext
  const blob = Buffer.concat([iv, tag, ciphertext]);
  return blob.toString('base64');
}

/**
 * Decrypt a base64-encoded blob produced by encrypt().
 * Returns null/undefined as-is.
 * Returns the original value if it doesn't look encrypted (plaintext fallback
 * for graceful migration — rows not yet encrypted will still be readable).
 */
export function decrypt(ciphertext: string | null | undefined): string | null {
  if (ciphertext == null) return null;
  let blob: Buffer;
  try {
    blob = Buffer.from(ciphertext, 'base64');
  } catch {
    return ciphertext; // not base64 — plaintext fallback
  }
  // Need at least IV + TAG bytes to be a valid encrypted blob
  if (blob.length <= IV_LEN + TAG_LEN) {
    return ciphertext; // plaintext fallback (unencrypted legacy row)
  }
  try {
    const key = getKey();
    const iv = blob.subarray(0, IV_LEN);
    const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const data = blob.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(data) + decipher.final('utf8');
  } catch {
    // Auth tag mismatch or wrong key — return ciphertext as-is (plaintext fallback)
    return ciphertext;
  }
}
