/* eslint-disable jest/no-conditional-in-test -- property-based and data-driven tests assert outcomes from conditionals/try-catch in the test body */
/**
 * RFC 6265bis / RFC 9110 / NIST SP 800-38D / FIPS 198-1 conformance matrix.
 * Each test maps to a specific clause and must remain green to claim conformance.
 */
import { describe, expect, it } from 'bun:test';
import { Cookie } from 'bun';

import { CookieParser } from '../../src/cookie-parser';
import { CookieJar } from '../../src/cookie-jar';
import { CookieErrorReason, CookiePriority, SigningAlgorithm } from '../../src/enums';
import { asErr, expectOk } from '../support';

const SECRET = 'yiLuooc8t1iy7BDCaU2eExB60URL8zacnqb1mA66aIo';
const ENC = 'v3MALRP-T0CO2gZ46D5As25K-U1D74PDhsdQJGjk4QQ';

describe('RFC 9110 §5.6.2 — token grammar', () => {
  const cp = CookieParser.create();
  const separators = ['(', ')', '<', '>', '@', ',', ';', ':', '\\', '"', '/', '[', ']', '?', '=', '{', '}'];
  for (const ch of separators) {
    it(`rejects "${ch}" in cookie name via createCookie`, () => {
      const name = `bad${ch}name`;
      expect(asErr(cp.createCookie(name, 'v')).data.reason).toBe(CookieErrorReason.InvalidCookieName);
    });
    it(`rejects "${ch}" in cookie name via serialize when Bun ctor accepts it`, () => {
      const name = `bad${ch}name`;
      let raw: Cookie | undefined;
      try { raw = new Cookie(name, 'v'); } catch { /* Bun rejected — already safe */ }
      if (raw === undefined) {return;}
      expect(asErr(cp.serialize(raw)).data.reason).toBe(CookieErrorReason.InvalidCookieName);
    });
  }
  it('rejects CTL chars (0x00-0x1F, 0x7F) in name', () => {
    for (const code of [0, 1, 9, 10, 13, 31, 127]) {
      expect(asErr(cp.createCookie(`bad${String.fromCharCode(code)}`, 'v')).data.reason).toBe(CookieErrorReason.InvalidCookieName);
    }
  });
  it('accepts all valid tchar in cookie name (excluding "%" for Bun.CookieMap interop)', () => {
    const valid = "!#$&'*+-.^_`|~0aZ";
    expectOk(cp.createCookie(valid, 'v'));
  });
});

describe('RFC 6265bis §4.1.1 — Set-Cookie syntax', () => {
  it('produces name=value pair as first token', () => {
    const cp = CookieParser.create();
    const h = expectOk(cp.serialize(new Cookie('s', 'v')));
    expect(h.startsWith('s=v')).toBe(true);
  });
  it('separates attributes with "; "', () => {
    const cp = CookieParser.create();
    const h = expectOk(cp.serialize(new Cookie('s', 'v', { secure: true, httpOnly: true })));
    expect(h).toMatch(/; /);
  });
});

describe('RFC 6265bis §4.1.2.1 — Expires attribute', () => {
  const cp = CookieParser.create();
  it('rejects unparseable expires string', () => {
    expect(asErr(cp.createCookie('s', 'v', { expires: 'definitely not a date' })).data.reason).toBe(CookieErrorReason.InvalidExpires);
  });
  it('accepts IMF-fixdate per RFC 7231', () => {
    expectOk(cp.createCookie('s', 'v', { expires: 'Sun, 06 Nov 1994 08:49:37 GMT' }));
  });
});

describe('RFC 6265bis §4.1.2.2 — Max-Age attribute', () => {
  const cp = CookieParser.create();
  it('rejects non-integer Max-Age (NaN)', () => {
    expect(asErr(cp.createCookie('s', 'v', { maxAge: NaN })).data.reason).toBe(CookieErrorReason.InvalidMaxAge);
  });
  it('rejects non-integer Max-Age (decimal)', () => {
    expect(asErr(cp.createCookie('s', 'v', { maxAge: 1.5 })).data.reason).toBe(CookieErrorReason.InvalidMaxAge);
  });
  it('rejects negative Max-Age (non-zero-digit grammar)', () => {
    expect(asErr(cp.createCookie('s', 'v', { maxAge: -1 })).data.reason).toBe(CookieErrorReason.InvalidMaxAge);
  });
});

describe('RFC 6265bis §4.1.2.7 — SameSite=None requires Secure', () => {
  const cp = CookieParser.create();
  it('rejects SameSite=None without Secure', () => {
    expect(asErr(cp.serialize(new Cookie('s', 'v', { sameSite: 'none' }))).data.reason).toBe(CookieErrorReason.SameSiteNoneRequiresSecure);
  });
});

describe('RFC 6265bis §4.1.3.1 — __Secure- prefix', () => {
  const cp = CookieParser.create();
  it('requires Secure attribute', () => {
    expect(asErr(cp.validatePrefix(new Cookie('__Secure-x', 'v'))).data.reason).toBe(CookieErrorReason.SecurePrefixRequiresSecure);
  });
});

describe('RFC 6265bis §4.1.3.2 — __Host- prefix', () => {
  const cp = CookieParser.create();
  it('requires Secure', () => {
    expect(asErr(cp.validatePrefix(new Cookie('__Host-x', 'v', { path: '/' }))).data.reason).toBe(CookieErrorReason.HostPrefixRequiresSecure);
  });
  it('forbids Domain', () => {
    expect(asErr(cp.validatePrefix(new Cookie('__Host-x', 'v', { secure: true, domain: 'example.com', path: '/' }))).data.reason).toBe(CookieErrorReason.HostPrefixForbidsDomain);
  });
  it('requires Path=/', () => {
    expect(asErr(cp.validatePrefix(new Cookie('__Host-x', 'v', { secure: true, path: '/admin' }))).data.reason).toBe(CookieErrorReason.HostPrefixRequiresRootPath);
  });
});

describe('CHIPS — Partitioned requires Secure', () => {
  const cp = CookieParser.create();
  it('rejects Partitioned without Secure', () => {
    expect(asErr(cp.serialize(new Cookie('s', 'v', { partitioned: true }))).data.reason).toBe(CookieErrorReason.PartitionedRequiresSecure);
  });
});

describe('RFC 6265 §6.1 — 4096 octet limit', () => {
  const cp = CookieParser.create();
  it('rejects serialized header > 4096 octets', () => {
    expect(asErr(cp.serialize(new Cookie('s', 'x'.repeat(4096)))).data.reason).toBe(CookieErrorReason.CookieTooLarge);
  });
});

describe('NIST SP 800-38D — AES-256-GCM parameters', () => {
  it('uses 12-byte IV (clause 5.2.1.1)', async () => {
    const cp = CookieParser.create({ encryptionSecret: ENC });
    const enc = expectOk(await cp.encrypt(new Cookie('s', 'v')));
    const decoded = Buffer.from(enc.value, 'base64url');
    // First 12 bytes are IV
    expect(decoded.length).toBeGreaterThanOrEqual(12 + 16); // IV + tag minimum
  });
  it('uses 128-bit auth tag (clause 5.2.1.2)', async () => {
    const cp = CookieParser.create({ encryptionSecret: ENC });
    // KID(4) + IV(12) + tag(16) = 32 bytes minimum (empty plaintext)
    const enc = expectOk(await cp.encrypt(new Cookie('s', '')));
    const decoded = Buffer.from(enc.value, 'base64url');
    expect(decoded.length).toBe(4 + 12 + 16);
  });
  it('produces unique IV across calls (probabilistic)', async () => {
    const cp = CookieParser.create({ encryptionSecret: ENC });
    const a = expectOk(await cp.encrypt(new Cookie('s', 'v')));
    const b = expectOk(await cp.encrypt(new Cookie('s', 'v')));
    // bytes 4..15 are IV (after 4-byte KID prefix)
    const aIv = Buffer.from(a.value, 'base64url').subarray(4, 16).toString('hex');
    const bIv = Buffer.from(b.value, 'base64url').subarray(4, 16).toString('hex');
    expect(aIv).not.toBe(bIv);
  });
  it('binds cookie name as AAD (rejects cross-name replay)', async () => {
    const cp = CookieParser.create({ encryptionSecret: ENC });
    const enc = expectOk(await cp.encrypt(new Cookie('admin', 'true')));
    expect(asErr(await cp.decrypt(new Cookie('user', enc.value))).data.reason).toBe(CookieErrorReason.DecryptionFailed);
  });
});

describe('HMAC key acceptance — no minimum-length floor', () => {
  it('SHA-256 accepts a 32-byte key', () => {
    expect(() => CookieParser.create({ secrets: ['yiLuooc8t1iy7BDCaU2eExB60URL8zacnqb1mA66aIo'], algorithm: SigningAlgorithm.Sha256 })).not.toThrow();
  });
  it('accepts a key shorter than 32 (strength is the operator\'s responsibility)', () => {
    expect(() => CookieParser.create({ secrets: ['x'.repeat(31)] })).not.toThrow();
  });
});

describe('RFC 6265 §5.4 — cookie header parsing', () => {
  it('parses name-value pairs separated by "; "', () => {
    const cp = CookieParser.create();
    const jar = new CookieJar(cp, 'a=1; b=2; c=3');
    expect(jar.getRaw('a')).toBe('1');
    expect(jar.getRaw('b')).toBe('2');
    expect(jar.getRaw('c')).toBe('3');
  });
  it('handles empty Cookie header', () => {
    const cp = CookieParser.create();
    const jar = new CookieJar(cp, '');
    expect(jar.has('any')).toBe(false);
  });
});

describe('Cross-instance isolation guarantees', () => {
  it('encrypted cookie from instance A cannot be decrypted by instance B with different key', async () => {
    const a = CookieParser.create({ encryptionSecret: 'yiLuooc8t1iy7BDCaU2eExB60URL8zacnqb1mA66aIo' });
    const b = CookieParser.create({ encryptionSecret: 'v3MALRP-T0CO2gZ46D5As25K-U1D74PDhsdQJGjk4QQ' });
    const enc = expectOk(await a.encrypt(new Cookie('s', 'secret')));
    expect(asErr(await b.decrypt(enc)).data.reason).toBe(CookieErrorReason.DecryptionFailed);
  });
  it('signed cookie from instance A cannot be unsigned by instance B with different key', async () => {
    const a = CookieParser.create({ secrets: ['yiLuooc8t1iy7BDCaU2eExB60URL8zacnqb1mA66aIo'] });
    const b = CookieParser.create({ secrets: ['v3MALRP-T0CO2gZ46D5As25K-U1D74PDhsdQJGjk4QQ'] });
    const signed = expectOk(a.sign(new Cookie('s', 'v')));
    expect(asErr(await b.unsign(signed)).data.reason).toBe(CookieErrorReason.SignatureVerificationFailed);
  });
  it('algorithm confusion: sha256-signed cannot be unsigned with sha512', async () => {
    const a = CookieParser.create({ secrets: [SECRET], algorithm: SigningAlgorithm.Sha256 });
    const b = CookieParser.create({ secrets: [SECRET], algorithm: SigningAlgorithm.Sha512 });
    const signed = expectOk(a.sign(new Cookie('s', 'v')));
    expect(asErr(await b.unsign(signed)).data.reason).toBe(CookieErrorReason.SignatureVerificationFailed);
  });
});

describe('RFC 6265bis §5.6 — name+value 4096 cap (R1)', () => {
  const cp = CookieParser.create();
  it('accepts name+value exactly 4096 octets', () => {
    expectOk(cp.createCookie('s', 'x'.repeat(4095)));
  });
  it('rejects name+value 4097 octets', () => {
    expect(asErr(cp.createCookie('s', 'x'.repeat(4096))).data.reason).toBe(CookieErrorReason.CookieTooLarge);
  });
});

describe('RFC 6265bis §5.6 — attribute-value 1024 cap (R2)', () => {
  const cp = CookieParser.create();
  it('rejects Path > 1024 octets', () => {
    expect(asErr(cp.createCookie('s', 'v', { path: '/' + 'a'.repeat(1024) })).data.reason).toBe(CookieErrorReason.AttributeTooLarge);
  });
});

describe('RFC 6265bis §5.7 — case-insensitive prefix matching (R3)', () => {
  const cp = CookieParser.create({ prefixValidation: true });
  it('detects __host- (lowercase) as host-prefixed', () => {
    expect(asErr(cp.serialize(new Cookie('__host-x', 'v', { domain: 'example.com', secure: true, path: '/' }))).data.reason).toBe(CookieErrorReason.HostPrefixForbidsDomain);
  });
  it('detects __SECURE- (uppercase) as secure-prefixed', () => {
    expect(asErr(cp.serialize(new Cookie('__SECURE-x', 'v'))).data.reason).toBe(CookieErrorReason.SecurePrefixRequiresSecure);
  });
});

describe('RFC 1123 Domain syntax (NEW-4)', () => {
  const cp = CookieParser.create();
  it('rejects consecutive-dot domain', () => {
    expect(asErr(cp.createCookie('s', 'v', { domain: 'a..b.com' })).data.reason).toBe(CookieErrorReason.InvalidDomain);
  });
  it('rejects leading-hyphen label', () => {
    expect(asErr(cp.createCookie('s', 'v', { domain: '-bad.com' })).data.reason).toBe(CookieErrorReason.InvalidDomain);
  });
  it('rejects trailing-hyphen label', () => {
    expect(asErr(cp.createCookie('s', 'v', { domain: 'bad-.com' })).data.reason).toBe(CookieErrorReason.InvalidDomain);
  });
  it('accepts valid two-label domain', () => {
    expectOk(cp.createCookie('s', 'v', { domain: 'example.com' }));
  });
});

describe('Priority attribute (2-D)', () => {
  const cp = CookieParser.create();
  it('emits Priority=High for priority:high', () => {
    const c = expectOk(cp.createCookie('s', 'v', { priority: CookiePriority.High }));
    expect(expectOk(cp.serialize(c))).toContain('Priority=High');
  });
  it('rejects invalid priority value', () => {
    // @ts-expect-error — intentionally out-of-union value; tests runtime rejection of an untyped caller
    expect(asErr(cp.createCookie('s', 'v', { priority: 'urgent' })).data.reason).toBe(CookieErrorReason.InvalidPriority);
  });
});

describe('HKDF key derivation + KID (1-A, 1-B)', () => {
  it('encrypted payload starts with 4-byte KID prefix', async () => {
    const cp = CookieParser.create({ encryptionSecret: ENC });
    const enc = expectOk(await cp.encrypt(new Cookie('s', '')));
    const decoded = Buffer.from(enc.value, 'base64url');
    expect(decoded.length).toBe(4 + 12 + 16);
  });
  it('signed payload signature blob starts with 4-byte KID', () => {
    const cp = CookieParser.create({ secrets: [SECRET] });
    const signed = expectOk(cp.sign(new Cookie('s', 'v')));
    const sig = signed.value.split('.').pop()!;
    const decoded = Buffer.from(sig, 'base64url');
    // KID(4) + HMAC-SHA256(32) = 36 bytes
    expect(decoded.length).toBe(4 + 32);
  });
  it('KID mismatch causes signature to be rejected', async () => {
    const cp = CookieParser.create({ secrets: [SECRET] });
    const signed = expectOk(cp.sign(new Cookie('s', 'v')));
    const sig = signed.value.split('.').pop()!;
    const buf = Buffer.from(sig, 'base64url');
    buf[0] = (buf[0]! ^ 0xff) & 0xff;
    const tampered = `${signed.value.split('.').slice(0, -1).join('.')}.${buf.toString('base64url')}`;
    expect(asErr(await cp.unsign(new Cookie('s', tampered))).data.reason).toBe(CookieErrorReason.SignatureVerificationFailed);
  });
});

describe('CookieError is the only public exception type', () => {
  const cp = CookieParser.create();
  it('createCookie wraps Bun TypeError on bad domain', () => {
    expect(asErr(cp.createCookie('s', 'v', { domain: 'evil; injected' })).data.reason).toBe(CookieErrorReason.InvalidDomain);
  });
  it('createCookie wraps Bun TypeError on bad path', () => {
    expect(asErr(cp.createCookie('s', 'v', { path: '/x;injected' })).data.reason).toBe(CookieErrorReason.InvalidPath);
  });
  it('createCookie wraps Bun TypeError on bad expires', () => {
    expect(asErr(cp.createCookie('s', 'v', { expires: 'not-a-date' })).data.reason).toBe(CookieErrorReason.InvalidExpires);
  });
});
