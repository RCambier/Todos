const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Generates a crypto-random, URL-safe task ID: 12 base62 characters
 * (~71 bits of entropy — plenty to never collide in a single sheet).
 * Relies on the Web Crypto API, available globally in browsers and Node 20+.
 */
export function generateId(length = 12): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let id = "";
  for (let i = 0; i < length; i++) {
    // Uint8Array values are 0-255; 256 is not a multiple of 62, so this has
    // a tiny modulo bias. Acceptable for an ID that only needs to be
    // collision-resistant, not cryptographically uniform.
    id += BASE62_ALPHABET[bytes[i]! % BASE62_ALPHABET.length];
  }
  return id;
}
