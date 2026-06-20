import { describe, expect, it } from 'bun:test';

import { SigningAlgorithm } from './enums';
import {
  bufferFromB64Url,
  bufferToB64Url,
  constantTimeEqual,
  deriveHmacKeyBytesSync,
  deriveKid,
  hkdfExpand,
  hkdfExtract,
} from './cookie-crypto';

const hex = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(Uint8Array.fromHex(s));
const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

describe('HKDF (RFC 5869) known-answer vectors', () => {
  // RFC 5869 Appendix A.1 — Basic test case with SHA-256.
  it('A.1: Extract then Expand reproduces the published PRK and OKM (SHA-256)', () => {
    const ikm = hex('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b');
    const salt = hex('000102030405060708090a0b0c');
    const info = hex('f0f1f2f3f4f5f6f7f8f9');
    const prk = hkdfExtract(ikm, salt, SigningAlgorithm.Sha256);
    expect(toHex(prk)).toBe('077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5');
    const okm = hkdfExpand(prk, info, 42, SigningAlgorithm.Sha256);
    expect(toHex(okm)).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    );
  });

  // RFC 5869 Appendix A.3 — Test with zero-length salt/info (SHA-256).
  it('A.3: handles a zero-length salt and info (SHA-256)', () => {
    const ikm = hex('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b');
    const prk = hkdfExtract(ikm, new Uint8Array(0), SigningAlgorithm.Sha256);
    expect(toHex(prk)).toBe('19ef24a32c717b167f33a91d6f648bdf96596776afdb6377ac434c1c293ccb04');
    const okm = hkdfExpand(prk, new Uint8Array(0), 42, SigningAlgorithm.Sha256);
    expect(toHex(okm)).toBe(
      '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8',
    );
  });
});

describe('deriveHmacKeyBytesSync (sync HKDF) equals the platform WebCrypto HKDF', () => {
  const salt = new TextEncoder().encode('a-fixed-salt-value');
  const HKDF_INFO_HMAC = new TextEncoder().encode('@zipbul/cookie hmac v2');

  // [our SigningAlgorithm, the equivalent WebCrypto subtle hash name for the crypto.subtle comparison]
  for (const [algorithm, subtleHash] of [
    [SigningAlgorithm.Sha256, 'SHA-256'],
    [SigningAlgorithm.Sha384, 'SHA-384'],
    [SigningAlgorithm.Sha512, 'SHA-512'],
  ] as const) {
    it(`is byte-identical to crypto.subtle HKDF for ${subtleHash}`, async () => {
      const secret = 'super-secret-value-Δ';
      const sync = deriveHmacKeyBytesSync(secret, algorithm, salt);

      const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: subtleHash, salt, info: HKDF_INFO_HMAC }, baseKey, 256);

      expect(toHex(sync)).toBe(toHex(new Uint8Array(bits)));
    });
  }
});

describe('deriveKid', () => {
  it('is the deterministic first 4 bytes of SHA-256(keyBytes)', async () => {
    const keyBytes = hex('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff');
    const kid1 = await deriveKid(keyBytes);
    const kid2 = await deriveKid(keyBytes);
    expect(kid1.length).toBe(4);
    expect(toHex(kid1)).toBe(toHex(kid2));
    const full = new Uint8Array(await crypto.subtle.digest('SHA-256', keyBytes));
    expect(toHex(kid1)).toBe(toHex(full.subarray(0, 4)));
  });

  it('differs for different key bytes', async () => {
    const a = await deriveKid(hex('00'.repeat(32)));
    const b = await deriveKid(hex('01'.repeat(32)));
    expect(toHex(a)).not.toBe(toHex(b));
  });
});

describe('constantTimeEqual', () => {
  it('returns true for equal byte arrays', () => {
    expect(constantTimeEqual(hex('deadbeef'), hex('deadbeef'))).toBe(true);
  });
  it('returns false for arrays differing in one byte', () => {
    expect(constantTimeEqual(hex('deadbeef'), hex('deadbeff'))).toBe(false);
  });
  it('returns false for arrays of different length', () => {
    expect(constantTimeEqual(hex('deadbeef'), hex('deadbe'))).toBe(false);
  });
});

describe('base64url helpers', () => {
  it('round-trips arbitrary bytes (unpadded base64url)', () => {
    const bytes = hex('00ff10203040aabbccddeeff7f');
    const encoded = bufferToB64Url(bytes);
    expect(encoded).not.toContain('=');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(toHex(bufferFromB64Url(encoded))).toBe(toHex(bytes));
  });

  it('strict-decodes: throws on non-alphabet input', () => {
    expect(() => bufferFromB64Url('not valid base64url !!!')).toThrow();
  });
});
