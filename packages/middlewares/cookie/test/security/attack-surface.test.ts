/**
 * Attack-surface reproduction suite. Each test enumerates a known cookie-attack
 * vector and asserts that the library produces a CookieError or otherwise refuses.
 */
import { describe, expect, it } from 'bun:test';
import { Cookie } from 'bun';

import { CookieParser } from '../../src/cookie-parser';
import { CookieJar } from '../../src/cookie-jar';
import { CookieErrorReason, SigningAlgorithm } from '../../src/enums';
import type { CookieAttributes } from '../../src/interfaces';
import { asCookieError, asErr, expectOk } from '../support';

const SECRET = 'yiLuooc8t1iy7BDCaU2eExB60URL8zacnqb1mA66aIo';
const ENC = 'v3MALRP-T0CO2gZ46D5As25K-U1D74PDhsdQJGjk4QQ';

describe('Attack: header injection via attribute values', () => {
  const cp = CookieParser.create();
  it('rejects "; injected" in domain', () => {
    expect(asErr(cp.createCookie('s', 'v', { domain: 'evil.com; injected=1' })).data.reason).toBe(CookieErrorReason.InvalidDomain);
  });
  it('rejects CRLF in domain', () => {
    expect(asErr(cp.createCookie('s', 'v', { domain: 'a\r\nSet-Cookie: x=1' })).data.reason).toBe(CookieErrorReason.InvalidDomain);
  });
  it('rejects "; injected" in path', () => {
    expect(asErr(cp.createCookie('s', 'v', { path: '/x; injected' })).data.reason).toBe(CookieErrorReason.InvalidPath);
  });
  it('rejects CRLF in path', () => {
    expect(asErr(cp.createCookie('s', 'v', { path: '/x\r\nSet-Cookie: x=1' })).data.reason).toBe(CookieErrorReason.InvalidPath);
  });
  it('percent-encodes ";" in cookie value (no escape from name=value)', () => {
    const h = expectOk(cp.serialize(new Cookie('s', 'v;injected=1')));
    expect(h).not.toContain('v;injected');
    expect(h).toContain('%3B');
  });
  it('percent-encodes CR/LF/NUL in cookie value (no raw control bytes reach the header)', () => {
    const h = expectOk(cp.serialize(new Cookie('s', 'a\r\nb\x00c')));
    expect(h).toContain('%0D%0A');
    expect(h).toContain('%00');
    expect(h).not.toContain('\r');
    expect(h).not.toContain('\n');
    expect(h).not.toContain('\x00');
  });
});

describe('Attack: cross-name signature replay (C1 fix)', () => {
  it('signature for cookie A is invalid for cookie B', async () => {
    const cp = CookieParser.create({ secrets: [SECRET] });
    const signed = expectOk(cp.sign(new Cookie('admin', 'true')));
    expect(asErr(await cp.unsign(new Cookie('user', signed.value))).data.reason).toBe(CookieErrorReason.SignatureVerificationFailed);
  });
});

describe('Attack: cross-name ciphertext replay (C2 fix)', () => {
  it('ciphertext for cookie A is invalid for cookie B', async () => {
    const cp = CookieParser.create({ encryptionSecret: ENC });
    const enc = expectOk(await cp.encrypt(new Cookie('admin', 'true')));
    expect(asErr(await cp.decrypt(new Cookie('user', enc.value))).data.reason).toBe(CookieErrorReason.DecryptionFailed);
  });
});

describe('Attack: algorithm confusion', () => {
  it('SHA-256 signature does not validate as SHA-384', async () => {
    const a = CookieParser.create({ secrets: [SECRET], algorithm: SigningAlgorithm.Sha256 });
    const b = CookieParser.create({ secrets: [SECRET], algorithm: SigningAlgorithm.Sha384 });
    const signed = expectOk(a.sign(new Cookie('s', 'v')));
    expect(asErr(await b.unsign(signed)).data.reason).toBe(CookieErrorReason.SignatureVerificationFailed);
  });
  it('SHA-512 signature does not validate as SHA-256', async () => {
    const a = CookieParser.create({ secrets: [SECRET], algorithm: SigningAlgorithm.Sha512 });
    const b = CookieParser.create({ secrets: [SECRET], algorithm: SigningAlgorithm.Sha256 });
    const signed = expectOk(a.sign(new Cookie('s', 'v')));
    expect(asErr(await b.unsign(signed)).data.reason).toBe(CookieErrorReason.SignatureVerificationFailed);
  });
});

describe('Attack: ciphertext truncation', () => {
  it('rejects ciphertext shorter than IV+tag minimum', async () => {
    const cp = CookieParser.create({ encryptionSecret: ENC });
    expect(asErr(await cp.decrypt(new Cookie('s', Buffer.from(new Uint8Array(20)).toString('base64url')))).data.reason).toBe(CookieErrorReason.InvalidCiphertext);
  });
  it('rejects ciphertext with corrupted tag', async () => {
    const cp = CookieParser.create({ encryptionSecret: ENC });
    const enc = expectOk(await cp.encrypt(new Cookie('s', 'v')));
    const buf = Buffer.from(enc.value, 'base64url');
    buf[buf.length - 1] = (buf[buf.length - 1]! ^ 0xff) & 0xff;
    expect(asErr(await cp.decrypt(new Cookie('s', buf.toString('base64url')))).data.reason).toBe(CookieErrorReason.DecryptionFailed);
  });
  it('rejects ciphertext with corrupted IV', async () => {
    const cp = CookieParser.create({ encryptionSecret: ENC });
    const enc = expectOk(await cp.encrypt(new Cookie('s', 'v')));
    const buf = Buffer.from(enc.value, 'base64url');
    // IV occupies bytes 4..15 (after 4-byte KID prefix)
    buf[4] = (buf[4]! ^ 0xff) & 0xff;
    expect(asErr(await cp.decrypt(new Cookie('s', buf.toString('base64url')))).data.reason).toBe(CookieErrorReason.DecryptionFailed);
  });
});

describe('Attack: signature malformation', () => {
  const cp = CookieParser.create({ secrets: [SECRET] });
  it('rejects value without dot separator', async () => {
    expect(asErr(await cp.unsign(new Cookie('s', 'nodot'))).data.reason).toBe(CookieErrorReason.InvalidSignature);
  });
  it('rejects value with empty signature', async () => {
    expect(asErr(await cp.unsign(new Cookie('s', 'value.'))).data.reason).toBe(CookieErrorReason.SignatureVerificationFailed);
  });
  it('rejects value with garbage signature', async () => {
    expect(asErr(await cp.unsign(new Cookie('s', 'value.NotABase64UrlString!!!'))).data.reason).toBe(CookieErrorReason.SignatureVerificationFailed);
  });
});

describe('Attack: prototype pollution via cookie names', () => {
  it('Map.set with __proto__ does not pollute Object.prototype', () => {
    const cp = CookieParser.create();
    const jar = new CookieJar(cp, '__proto__=evil; constructor=evil; toString=evil');
    expect(jar.getRaw('__proto__')).toBe('evil');
    // verify Object.prototype is untouched
    expect('evil' in {}).toBe(false);
    expect(Object.getPrototypeOf({})).not.toBe('evil');
  });
  it('out-jar set with __proto__ does not pollute', async () => {
    const cp = CookieParser.create();
    const out = new CookieJar(cp, '');
    out.set('__proto__', 'evil');
    const headers = await out.getSetCookieHeaders();
    expect(headers[0]).toContain('__proto__=evil');
    expect('evil' in {}).toBe(false);
  });
});

describe('Attack: secret-less encrypt/sign attempts', () => {
  const cp = CookieParser.create();
  it('sign() throws SigningNotConfigured', () => {
    expect(asErr(cp.sign(new Cookie('s', 'v'))).data.reason).toBe(CookieErrorReason.SigningNotConfigured);
  });
  it('unsign() throws SigningNotConfigured', async () => {
    expect(asErr(await cp.unsign(new Cookie('s', 'v.sig'))).data.reason).toBe(CookieErrorReason.SigningNotConfigured);
  });
  it('encrypt() throws EncryptionNotConfigured', async () => {
    expect(asErr(await cp.encrypt(new Cookie('s', 'v'))).data.reason).toBe(CookieErrorReason.EncryptionNotConfigured);
  });
  it('decrypt() throws EncryptionNotConfigured', async () => {
    expect(asErr(await cp.decrypt(new Cookie('s', 'cipher'))).data.reason).toBe(CookieErrorReason.EncryptionNotConfigured);
  });
});

describe('Attack: blank/empty secrets', () => {
  it('rejects a blank signing secret', () => {
    let caught: unknown;
    try { CookieParser.create({ secrets: ['  '] }); } catch (e) { caught = e; }
    expect(asCookieError(caught).reason).toBe(CookieErrorReason.InvalidSecret);
  });
  it('rejects a blank encryption secret', () => {
    let caught: unknown;
    try { CookieParser.create({ encryptionSecret: '  ' }); } catch (e) { caught = e; }
    expect(asCookieError(caught).reason).toBe(CookieErrorReason.InvalidEncryptionSecret);
  });
  it('rejects empty secrets array', () => {
    let caught: unknown;
    try { CookieParser.create({ secrets: [] }); } catch (e) { caught = e; }
    expect(asCookieError(caught).reason).toBe(CookieErrorReason.EmptySecrets);
  });
  it('rejects whitespace-only secret', () => {
    let caught: unknown;
    try { CookieParser.create({ secrets: ['                                  '.padEnd(40)] }); } catch (e) { caught = e; }
    expect(asCookieError(caught).reason).toBe(CookieErrorReason.InvalidSecret);
  });
});

describe('Attack: oversized payloads', () => {
  it('rejects serialized cookie > 4096 octets', () => {
    const cp = CookieParser.create();
    expect(asErr(cp.serialize(new Cookie('s', 'x'.repeat(5000)))).data.reason).toBe(CookieErrorReason.CookieTooLarge);
  });
});

describe('Attack: timing-safe HMAC iteration', () => {
  it('verifies regardless of secret position in rotation array', async () => {
    const k1 = 'DAFa9Tm4TjwbEew6OJ2WjyL4hDkBytmILCPItWAvij8';
    const k2 = '39bzADCd-pZ69QBXlC2wGBNmKLUWclgkYIPNBDfOEnc';
    const k3 = 'lU5yqjYisLZ0gXAEbAOiQwcNDKGXoVdLwvnCCNf12fg';
    const k4 = 'f_58oLMYSRKNGG5vIzRSurZqqZy8bTJaO-d6py0Slms';
    const k5 = 'nge6Avvzrm8caHPUDLTcI6-Qa_AalZKo0yikksU-iZs';
    const cp = CookieParser.create({ secrets: [k1, k2, k3, k4, k5] });
    const lastOnly = CookieParser.create({ secrets: [k5] });
    const signed = expectOk(lastOnly.sign(new Cookie('s', 'v')));
    const unsigned = expectOk(await cp.unsign(signed));
    expect(unsigned.value).toBe('v');
  });
});

describe('Attack: control characters in cookie name', () => {
  const cp = CookieParser.create();
  for (const code of [0x00, 0x09, 0x0a, 0x0d, 0x1f, 0x20, 0x7f]) {
    it(`rejects 0x${code.toString(16).padStart(2, '0')} in name`, () => {
      expect(asErr(cp.createCookie(`a${String.fromCharCode(code)}b`, 'v')).data.reason).toBe(CookieErrorReason.InvalidCookieName);
    });
  }
});

describe('Attack: empty / blank cookie name', () => {
  const cp = CookieParser.create();
  it('rejects empty name', () => {
    expect(asErr(cp.createCookie('', 'v')).data.reason).toBe(CookieErrorReason.InvalidCookieName);
  });
});

describe('Attack: percent in name (Bun.CookieMap interop)', () => {
  const cp = CookieParser.create();
  it('rejects "%" in cookie name to guarantee Bun round-trip safety', () => {
    expect(asErr(cp.createCookie('bad%name', 'v')).data.reason).toBe(CookieErrorReason.InvalidCookieName);
  });
});

describe('Attack: error type leakage (H-2 fix)', () => {
  const cp = CookieParser.create();
  it('createCookie never leaks TypeError to callers (surfaces the canonical reason)', () => {
    const cases: Array<{ opts: CookieAttributes; reason: CookieErrorReason }> = [
      { opts: { expires: 'not-a-date' }, reason: CookieErrorReason.InvalidExpires },
      { opts: { expires: NaN }, reason: CookieErrorReason.InvalidExpires },
      { opts: { expires: Infinity }, reason: CookieErrorReason.InvalidExpires },
      { opts: { expires: new Date('invalid') }, reason: CookieErrorReason.InvalidExpires },
      { opts: { domain: 'evil; injected' }, reason: CookieErrorReason.InvalidDomain },
      { opts: { path: '/x; injected' }, reason: CookieErrorReason.InvalidPath },
    ];
    for (const { opts, reason } of cases) {
      expect(asErr(cp.createCookie('s', 'v', opts)).data.reason).toBe(reason);
    }
  });
});

describe('Attack: control characters in Path/Domain (RFC 6265 §4.1.1)', () => {
  const cp = CookieParser.create();
  const ctls = ['\x00', '\x01', '\x09', '\x0B', '\x1F', '\x7F'];
  for (const ch of ctls) {
    const hex = ch.charCodeAt(0).toString(16).padStart(2, '0');
    it(`rejects path containing CTL byte 0x${hex}`, () => {
      expect(asErr(cp.createCookie('s', 'v', { path: '/foo' + ch + 'bar' })).data.reason).toBe(CookieErrorReason.InvalidPath);
    });
    it(`rejects domain containing CTL byte 0x${hex}`, () => {
      expect(asErr(cp.createCookie('s', 'v', { domain: 'ex' + ch + 'ample.com' })).data.reason).toBe(CookieErrorReason.InvalidDomain);
    });
  }
});

describe('CWE-117 defense: validation error messages never echo caller input', () => {
  const cp = CookieParser.create();
  const secretMarker = 'SECRET_INPUT_' + Math.random().toString(36).slice(2);
  const cases: Array<{ label: string; opts: CookieAttributes; reason: CookieErrorReason }> = [
    { label: 'invalid expires', opts: { expires: secretMarker }, reason: CookieErrorReason.InvalidExpires },
    { label: 'invalid domain', opts: { domain: `${secretMarker}.com` }, reason: CookieErrorReason.InvalidDomain },
    { label: 'invalid path', opts: { path: `/${secretMarker}\x7f` }, reason: CookieErrorReason.InvalidPath },
  ];
  for (const c of cases) {
    it(`canonicalizes ${c.label} message (no input echo)`, () => {
      const e = asErr(cp.createCookie('s', 'v', c.opts)).data;
      expect(e.reason).toBe(c.reason);
      expect(e.message).not.toContain(secretMarker);
    });
  }
});


