// Cryptographic primitives for the cookie codec: HKDF key derivation (RFC 5869), KID derivation,
// strict base64url, and constant-time comparison. Kept in a dedicated, cookie-agnostic module so the
// highest-risk layer can be unit-tested in isolation (against RFC 5869 vectors) and so CookieParser is
// left to its codec/validation role. Nothing here knows about cookies, headers, or Bun.Cookie.

import { SigningAlgorithm } from './enums';
import { KID_LENGTH } from './constants';

const utf8 = new TextEncoder();
const HKDF_INFO_HMAC = utf8.encode('@zipbul/cookie hmac v2');
const HKDF_INFO_AES = utf8.encode('@zipbul/cookie aes-gcm v2');

// Digest byte length per signing algorithm, for the sync HKDF Expand loop. `satisfies` keeps it
// exhaustive over SigningAlgorithm (a 4th algorithm fails to compile until listed). The enum's VALUE is
// the Bun.CryptoHasher name ('sha256' etc.), so the algorithm is passed straight to Bun.CryptoHasher —
// no separate hash-name table is needed.
const HASH_LEN_BY_ALGO = {
  [SigningAlgorithm.Sha256]: 32,
  [SigningAlgorithm.Sha384]: 48,
  [SigningAlgorithm.Sha512]: 64,
} as const satisfies Record<SigningAlgorithm, number>;

export async function deriveAesKey(secret: string, salt: Uint8Array<ArrayBuffer>): Promise<{ key: CryptoKey; kid: Uint8Array }> {
  const ikm = utf8.encode(secret);
  const baseKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: HKDF_INFO_AES },
    baseKey,
    256,
  );
  const keyBytes = new Uint8Array(bits);
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt'],
  );
  const kid = await deriveKid(keyBytes);
  return { key, kid };
}

export async function deriveKid(keyBytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const h = await crypto.subtle.digest('SHA-256', keyBytes);
  return new Uint8Array(h, 0, KID_LENGTH);
}

export function deriveHmacKeyBytesSync(secret: string, algorithm: SigningAlgorithm, salt: Uint8Array): Uint8Array {
  // Sync HKDF (Extract then Expand) producing the 32-byte HMAC key, byte-identical to a WebCrypto HKDF
  // deriveBits over the same secret/salt/info — so a value signed sync verifies the same either way.
  const prk = hkdfExtract(secret, salt, algorithm);
  return hkdfExpand(prk, HKDF_INFO_HMAC, 32, algorithm);
}

export function hkdfExtract(ikm: string | Uint8Array, salt: Uint8Array, algorithm: SigningAlgorithm): Uint8Array {
  const h = new Bun.CryptoHasher(algorithm, salt);
  h.update(typeof ikm === 'string' ? utf8.encode(ikm) : ikm);
  return new Uint8Array(h.digest());
}

export function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number, algorithm: SigningAlgorithm): Uint8Array {
  const hashLen = HASH_LEN_BY_ALGO[algorithm];
  const N = Math.ceil(length / hashLen);
  const out = new Uint8Array(N * hashLen);
  let prev = new Uint8Array(0);
  for (let i = 1; i <= N; i++) {
    const h = new Bun.CryptoHasher(algorithm, prk);
    h.update(prev);
    h.update(info);
    h.update(new Uint8Array([i]));
    prev = new Uint8Array(h.digest());
    out.set(prev, (i - 1) * hashLen);
  }
  return out.subarray(0, length);
}

export function bufferFromB64Url(s: string): Uint8Array<ArrayBuffer> {
  // Bun-native, STRICT base64url decode: throws SyntaxError on non-alphabet input, so the callers'
  // try/catch actually rejects a forged/garbage signature or ciphertext at the boundary (Buffer.from is
  // lenient and silently produces junk bytes). Default lastChunkHandling accepts our unpadded output.
  return Uint8Array.fromBase64(s, { alphabet: 'base64url' });
}

export function bufferToB64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {return false;}
  let diff = 0;
  for (let i = 0; i < a.length; i++) {diff |= a[i]! ^ b[i]!;}
  return diff === 0;
}
