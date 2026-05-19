import crypto from 'crypto';

/**
 * Compute SHA-256 hash of a JSON object.
 * The object is deterministically stringified before hashing.
 */
export function sha256Json(data: Record<string, unknown>): string {
  // Sort keys deterministically so the same object always produces the same hash
  const stable = JSON.stringify(data, Object.keys(data).sort());
  return crypto.createHash('sha256').update(stable, 'utf8').digest('hex');
}

/**
 * Compute SHA-256 hash of a raw string
 */
export function sha256String(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Verify a hash against a known value (constant-time comparison)
 */
export function verifyHash(input: string, expectedHash: string): boolean {
  const inputHash = sha256String(input);
  // timingSafeEqual prevents timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(inputHash, 'hex'),
      Buffer.from(expectedHash, 'hex'),
    );
  } catch {
    return false;
  }
}