import { describe, expect, it } from 'bun:test';
import { asCookieError, asErr, captureCookieError, expectOk } from '../test/support';
import { Cookie } from 'bun';

import type { Result } from '@zipbul/result';

import { CookieErrorReason, CookiePriority, SameSite, SigningAlgorithm } from './enums';
import { CookieError, type CookieErrorData } from './interfaces';
import { CookieParser } from './cookie-parser';

describe('CookieParser', () => {
  describe('create', () => {
    it('should create instance without signing or encryption when no options', () => {
      const cp = CookieParser.create();
      expect(cp).toBeInstanceOf(CookieParser);
    });

    it('should create instance with signing when secrets provided', () => {
      const cp = CookieParser.create({ secrets: ['Zt0tEdS1HGYL9uL1XCdYAK7jcXMwVoTJcVWgM6ZgAC8'] });
      expect(cp).toBeInstanceOf(CookieParser);
    });

    it('should create instance with encryption when encryptionSecret provided', () => {
      const cp = CookieParser.create({ encryptionSecret: '7jsSFQIsrYMx7njVC74raAcw-YrfDSdVdSJwq1t1xMA' });
      expect(cp).toBeInstanceOf(CookieParser);
    });

    it('should create instance with both when secrets and encryptionSecret provided', () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      expect(cp).toBeInstanceOf(CookieParser);
    });

    it('should throw EmptySecrets when secrets array is empty', () => {
      let caught: unknown;
      try {
        CookieParser.create({ secrets: [] });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect(asCookieError(caught).reason).toBe(CookieErrorReason.EmptySecrets);
    });

    it('should throw InvalidSecret when a secret is blank', () => {
      let caught: unknown;
      try {
        CookieParser.create({ secrets: ['FG-Qz_XD9uOM7e9O6mp_sZjsXPCrVik4ofHYTGagT3k', '  '] });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect(asCookieError(caught).reason).toBe(CookieErrorReason.InvalidSecret);
    });

    it('should throw InvalidEncryptionSecret when encryptionSecret is blank', () => {
      let caught: unknown;
      try {
        CookieParser.create({ encryptionSecret: '  ' });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect(asCookieError(caught).reason).toBe(
        CookieErrorReason.InvalidEncryptionSecret,
      );
    });

    it('should throw InvalidEncryptionSecret when secrets valid but encryptionSecret blank', () => {
      let caught: unknown;
      try {
        CookieParser.create({ secrets: ['FG-Qz_XD9uOM7e9O6mp_sZjsXPCrVik4ofHYTGagT3k'], encryptionSecret: '' });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect(asCookieError(caught).reason).toBe(
        CookieErrorReason.InvalidEncryptionSecret,
      );
    });

    it('should throw InvalidEncryptionSecret when encryptionSecret is an empty array', () => {
      expect(captureCookieError(() => CookieParser.create({ encryptionSecret: [] })).reason).toBe(CookieErrorReason.InvalidEncryptionSecret);
    });

    it('should throw InvalidEncryptionSecret when an encryptionSecret array element is blank', () => {
      expect(captureCookieError(() => CookieParser.create({ encryptionSecret: ['v3MALRP-T0CO2gZ46D5As25K-U1D74PDhsdQJGjk4QQ', '  '] })).reason).toBe(CookieErrorReason.InvalidEncryptionSecret);
    });

    it('accepts short / low-entropy secrets — cryptographic strength is the operator\'s responsibility, not validated', () => {
      expect(() => CookieParser.create({ secrets: ['short-secret'] })).not.toThrow();
      expect(() => CookieParser.create({ secrets: ['x'.repeat(40)] })).not.toThrow();
      expect(() => CookieParser.create({ secrets: ['abcdefgh'.repeat(4)] })).not.toThrow();
      expect(() => CookieParser.create({ encryptionSecret: 'abcdefgh'.repeat(4) })).not.toThrow();
    });

    it('accepts a short kdfSalt (no minimum length floor)', () => {
      expect(() => CookieParser.create({ kdfSalt: 'short' })).not.toThrow();
    });

    it('should create instance without signing or encryption when options is empty object', () => {
      const cp = CookieParser.create({});
      expect(cp).toBeInstanceOf(CookieParser);
    });
  });

  describe('serialize', () => {
    it('should return Set-Cookie header string when serializing Cookie', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('session', 'abc', { path: '/', secure: true });
      const header = expectOk(cp.serialize(cookie));
      expect(header).toContain('session=abc');
      expect(header).toContain('Secure');
    });

    it('should produce consistent result when serialize then parse roundtrip', () => {
      const cp = CookieParser.create();
      const original = new Cookie('token', 'xyz', { path: '/', httpOnly: true });
      const header = expectOk(cp.serialize(original));
      const parsed = Cookie.parse(header);
      expect(parsed.name).toBe('token');
      expect(parsed.value).toBe('xyz');
      expect(parsed.path).toBe('/');
      expect(parsed.httpOnly).toBe(true);
    });

    it('applies a parser default priority to a cookie that sets none', () => {
      const cp = CookieParser.create({ priority: CookiePriority.High });
      const header = expectOk(cp.serialize(expectOk(cp.createCookie('x', 'v', { path: '/' }))));
      expect(header).toContain('Priority=High');
    });
  });

  describe('boot validation — a malformed parser option/default is a config error and throws at create()', () => {
    // A bad parser DEFAULT fails identically on every request, so it is a programmer error surfaced at
    // construction (boot), not deferred to a per-request Result. Per-cookie/per-request input failures
    // (createCookie/set/sign/unsign on a bad VALUE) stay Result-typed — see those describes.
    it('throws InvalidExpires at create() when the default expires is malformed', () => {
      expect(captureCookieError(() => CookieParser.create({ expires: 'bad-date' })).reason).toBe(CookieErrorReason.InvalidExpires);
    });

    it('throws InvalidDomain at create() when the default domain is malformed', () => {
      expect(captureCookieError(() => CookieParser.create({ domain: 'BAD DOMAIN WITH SPACES' })).reason).toBe(CookieErrorReason.InvalidDomain);
    });

    it('throws InvalidPath at create() when the default path is malformed', () => {
      expect(captureCookieError(() => CookieParser.create({ path: 'bad;path' })).reason).toBe(CookieErrorReason.InvalidPath);
    });

    it('rejects a malformed default regardless of signing/encryption configuration', () => {
      expect(captureCookieError(() => CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], domain: 'BAD DOMAIN WITH SPACES' })).reason).toBe(CookieErrorReason.InvalidDomain);
      expect(captureCookieError(() => CookieParser.create({ encryptionSecret: 'v3MALRP-T0CO2gZ46D5As25K-U1D74PDhsdQJGjk4QQ', domain: 'BAD DOMAIN WITH SPACES' })).reason).toBe(CookieErrorReason.InvalidDomain);
    });

    // Regression: the validator must agree with Bun.Cookie. These three default values used to PASS boot
    // validation (looser validator) and then silently drop every cookie at serialize time; they must now
    // fail fast at create().
    it('throws InvalidDomain at create() for an UPPERCASE default domain (Bun rejects it)', () => {
      expect(captureCookieError(() => CookieParser.create({ domain: 'EXAMPLE.COM' })).reason).toBe(CookieErrorReason.InvalidDomain);
    });

    it('throws InvalidPath at create() for a non-ASCII default path (Bun rejects it)', () => {
      expect(captureCookieError(() => CookieParser.create({ path: '/ünïcödé' })).reason).toBe(CookieErrorReason.InvalidPath);
    });

    it('throws InvalidExpires at create() for a default numeric expires outside the Date range', () => {
      expect(captureCookieError(() => CookieParser.create({ expires: 8.64e15 + 1 })).reason).toBe(CookieErrorReason.InvalidExpires);
    });

    it('throws InvalidExpires at create() for a default numeric expires below the negative Date bound', () => {
      // BVA companion to the positive bound above — isValidExpires uses Math.abs(ms) <= MAX_TIME_MS.
      expect(captureCookieError(() => CookieParser.create({ expires: -(8.64e15) - 1 })).reason).toBe(CookieErrorReason.InvalidExpires);
    });

    it('throws InvalidMaxInboundCookieBytes at create() for a non-positive maxInboundCookieBytes', () => {
      expect(captureCookieError(() => CookieParser.create({ maxInboundCookieBytes: 0 })).reason).toBe(CookieErrorReason.InvalidMaxInboundCookieBytes);
    });

    // Each per-field reason rides on that @Field's context.reason (cookie-options.ts), which is excluded
    // from coverage — so a mis-wired context (e.g. two fields swapping reasons) would pass the green bar
    // unnoticed. One representative malformed value per field locks the mapping.
    it.each([
      ['secure', { secure: 'yes' }, CookieErrorReason.InvalidSecure],
      ['sameSite', { sameSite: 'sideways' }, CookieErrorReason.InvalidSameSite],
      ['httpOnly', { httpOnly: 'yes' }, CookieErrorReason.InvalidHttpOnly],
      ['partitioned', { partitioned: 'yes' }, CookieErrorReason.InvalidPartitioned],
      ['prefixValidation', { prefixValidation: 'yes' }, CookieErrorReason.InvalidPrefixValidation],
      ['kdfSalt', { kdfSalt: 123 }, CookieErrorReason.InvalidKdfSalt],
      ['priority', { priority: 'urgent' }, CookieErrorReason.InvalidPriority],
      ['algorithm', { algorithm: 'md5' }, CookieErrorReason.InvalidAlgorithm],
      ['maxAge', { maxAge: 0 }, CookieErrorReason.InvalidMaxAge],
    ] as const)('throws the %s-specific reason at create() for a malformed default', (_field, options, reason) => {
      expect(captureCookieError(() => CookieParser.create(options as never)).reason).toBe(reason);
    });

    it('accepts an ISO-8601 default expires and serializes it as a canonical IMF-fixdate', () => {
      // Date.parse accepts '2021-06-09' but Bun's string parser rejects it — normalizeExpires converts it
      // to a Date so it round-trips instead of being dropped.
      const cp = CookieParser.create({ expires: '2021-06-09' });
      const header = expectOk(cp.serialize(new Cookie('x', 'v')));
      expect(header).toContain('Expires=Wed, 09 Jun 2021 00:00:00 GMT');
    });
  });

  describe('Static cross-field validation at createCookie time (Secure known, non-auto default)', () => {
    const cp = CookieParser.create();
    it('rejects SameSite=None without Secure at set() time (not deferred to flush)', () => {
      expect(asErr(cp.createCookie('s', 'v', { sameSite: SameSite.None })).data.reason).toBe(CookieErrorReason.SameSiteNoneRequiresSecure);
    });
    it('rejects Partitioned without Secure at set() time (not deferred to flush)', () => {
      expect(asErr(cp.createCookie('s', 'v', { partitioned: true })).data.reason).toBe(CookieErrorReason.PartitionedRequiresSecure);
    });
  });

  describe('serialize size caps — MAX_HEADER_OCTETS (8190) vs MAX_ATTRIBUTE_OCTETS (1024)', () => {
    const cp = CookieParser.create();
    it('rejects a serialized header > 8190 octets via CookieTooLarge (name+value within 4096)', () => {
      // 2800 ";" characters: name+value is 2801 octets (well under the 4096 name+value cap), but each
      // ";" percent-encodes to "%3B" (3 octets), expanding the serialized header past 8190 — locking the
      // MAX_HEADER_OCTETS branch in serialize() distinct from the name+value cap.
      const value = ';'.repeat(2800);
      expect(Buffer.byteLength('s') + Buffer.byteLength(value)).toBeLessThanOrEqual(4096);
      expect(asErr(cp.serialize(new Cookie('s', value))).data.reason).toBe(CookieErrorReason.CookieTooLarge);
    });
    it('enforces the 1024 attribute-value cap on a raw Cookie via serialize() (AttributeTooLarge)', () => {
      // A raw Cookie passed straight to serialize() never went through createCookie's attribute-size
      // check; the path here is 2001 octets — over the 1024 attribute cap but under the 8190 header cap,
      // so AttributeTooLarge fires before CookieTooLarge.
      expect(asErr(cp.serialize(new Cookie('s', 'v', { path: '/' + 'a'.repeat(2000) }))).data.reason).toBe(CookieErrorReason.AttributeTooLarge);
    });
    it('enforces the 1024 attribute cap on a Domain that is valid LDH but too long (AttributeTooLarge)', () => {
      // Every label is a single valid char so it passes RFC1123 validation, but the whole Domain is 1025
      // octets — exercising the Domain branch of checkAttributeSizes distinct from the Path branch above.
      const longDomain = 'a.'.repeat(512) + 'a';
      expect(asErr(cp.createCookie('x', 'v', { domain: longDomain })).data.reason).toBe(CookieErrorReason.AttributeTooLarge);
    });
  });

  describe('sign', () => {
    it('should return Cookie with signed value when signing', () => {
      const cp = CookieParser.create({ secrets: ['uLplyRvLnHhzccmlgR32eWltxxck4zA03xyJ40ik4DQ'] });
      const cookie = new Cookie('session', 'hello');
      const signed = expectOk(cp.sign(cookie));
      expect(signed.name).toBe('session');
      expect(signed.value).toContain('hello.');
      expect(signed.value).not.toBe('hello');
    });

    it('should preserve cookie name and attributes when signing', () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'] });
      const cookie = new Cookie('token', 'val', {
        path: '/api',
        secure: true,
        httpOnly: true,
      });
      const signed = expectOk(cp.sign(cookie));
      expect(signed.name).toBe('token');
      expect(signed.path).toBe('/api');
      expect(signed.secure).toBe(true);
      expect(signed.httpOnly).toBe(true);
    });

    it('flows a parser DEFAULT expires through sign() into serialize() as a canonical IMF-fixdate', () => {
      // The source Cookie carries no Expires; cloneWithValue() inside sign() must pull the parser
      // default expires onto the signed clone, and serialize() must then emit it as an RFC 7231
      // IMF-fixdate ("...GMT", not Bun's non-conformant "-0000"/1-digit-day form).
      const cp = CookieParser.create({
        secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'],
        expires: new Date('2030-01-02T03:04:05Z'),
      });
      const signed = expectOk(cp.sign(new Cookie('session', 'v')));
      const header = expectOk(cp.serialize(signed));
      expect(header).toContain('Expires=Wed, 02 Jan 2030 03:04:05 GMT');
      expect(header).not.toContain('-0000');
    });

    it('should throw SigningNotConfigured when signing without secrets', () => {
      const cp = CookieParser.create();
      expect(asErr(cp.sign(new Cookie('n', 'v'))).data.reason).toBe(
        CookieErrorReason.SigningNotConfigured,
      );
    });

    it('should return Cookie in originalValue.<sig> form and round-trip back via unsign', async () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'] });
      const original = 'hello-world';
      const signed = expectOk(cp.sign(new Cookie('n', original)));
      // Wire shape is `originalValue.<base64url-sig>` — the cleartext value is preserved verbatim
      // before the dot, and a non-empty signature follows it.
      const dot = signed.value.lastIndexOf('.');
      expect(signed.value.slice(0, dot)).toBe(original);
      expect(signed.value.slice(dot + 1).length).toBeGreaterThan(0);
      expect(signed.value).toMatch(/^hello-world\..+/);
      // Full sign -> unsign round-trip recovers the original value.
      const unsigned = expectOk(await cp.unsign(signed));
      expect(unsigned.value).toBe(original);
    });

    it('should return Cookie with .<sig> form when signing empty value', () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'] });
      const signed = expectOk(cp.sign(new Cookie('n', '')));
      expect(signed.value).toMatch(/^\..+/);
    });

    it('should return same result when signing same cookie twice', () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'] });
      const cookie = new Cookie('n', 'v');
      const a = expectOk(cp.sign(cookie));
      const b = expectOk(cp.sign(cookie));
      expect(a.value).toBe(b.value);
    });
  });

  describe('unsign', () => {
    it('should return Cookie with original value when unsigning', async () => {
      const cp = CookieParser.create({ secrets: ['5LXB_5T8ke-OM3lbaSCxmSh5MLRfX-xzgfeqiC0XU-4'] });
      const signed = expectOk(cp.sign(new Cookie('n', 'hello')));
      const unsigned = expectOk(await cp.unsign(signed));
      expect(unsigned.name).toBe('n');
      expect(unsigned.value).toBe('hello');
    });

    it('rejects a value with a dot whose signature blob is shorter than the KID', async () => {
      // 'AA' base64url-decodes to 1 byte, below KID_LENGTH+1 — the explicit too-short-blob guard fires
      // before any HMAC compare, distinct from a wrong-MAC rejection.
      const cp = CookieParser.create({ secrets: ['5LXB_5T8ke-OM3lbaSCxmSh5MLRfX-xzgfeqiC0XU-4'] });
      expect(asErr(await cp.unsign(new Cookie('n', 'value.AA'))).data.reason).toBe(CookieErrorReason.SignatureVerificationFailed);
    });

    it('should succeed with second secret when unsigning with key rotation', async () => {
      const cpOld = CookieParser.create({ secrets: ['c-BonY3Jbzq2IWbz7U92BtJtQVDGl9wnoudjt9RkihY'] });
      const signed = expectOk(cpOld.sign(new Cookie('n', 'data')));
      const cpNew = CookieParser.create({ secrets: ['xM8Em3o_YBlUuk66TuXhAUgxC2E4fMk-OAOUl4KV02A', 'c-BonY3Jbzq2IWbz7U92BtJtQVDGl9wnoudjt9RkihY'] });
      const unsigned = expectOk(await cpNew.unsign(signed));
      expect(unsigned.value).toBe('data');
    });

    it('should throw SigningNotConfigured when unsigning without secrets', async () => {
      const cp = CookieParser.create();
      expect(asErr(await cp.unsign(new Cookie('n', 'v.sig'))).data.reason).toBe(
        CookieErrorReason.SigningNotConfigured,
      );
    });

    it('should throw InvalidSignature when unsigning value without dot', async () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'] });
      expect(asErr(await cp.unsign(new Cookie('n', 'nodot'))).data.reason).toBe(
        CookieErrorReason.InvalidSignature,
      );
    });

    it('should throw SignatureVerificationFailed when unsigning with wrong hmac', async () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'] });
      expect(asErr(await cp.unsign(new Cookie('n', 'value.wronghmac'))).data.reason).toBe(
        CookieErrorReason.SignatureVerificationFailed,
      );
    });

    it('should throw SignatureVerificationFailed when value was tampered', async () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'] });
      const signed = expectOk(cp.sign(new Cookie('n', 'original')));
      const tampered = new Cookie(
        'n',
        'tampered' + signed.value.slice(signed.value.lastIndexOf('.')),
      );
      expect(asErr(await cp.unsign(tampered)).data.reason).toBe(
        CookieErrorReason.SignatureVerificationFailed,
      );
    });

    it('should split at last dot when unsigning value with multiple dots', async () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'] });
      const cookie = new Cookie('n', 'a.b.c');
      const signed = expectOk(cp.sign(cookie));
      const unsigned = expectOk(await cp.unsign(signed));
      expect(unsigned.value).toBe('a.b.c');
    });

    it('should return original value when sign then unsign roundtrip', async () => {
      const cp = CookieParser.create({ secrets: ['_cxDYhedJoI3pyfq0QbajZaiG-_F-pAASJH65k7wr6w'] });
      const original = new Cookie('session', 'user:42', { path: '/', secure: true });
      const signed = expectOk(cp.sign(original));
      const unsigned = expectOk(await cp.unsign(signed));
      expect(unsigned.value).toBe('user:42');
      expect(unsigned.name).toBe('session');
    });
  });

  describe('encrypt', () => {
    it('should return Cookie with encrypted value that round-trips back via decrypt', async () => {
      const cp = CookieParser.create({ encryptionSecret: 'Jxfcxvq26bQMrza3M9GXKSy-1jSPeLw4mUhtCiEv3aY' });
      const plaintext = 'secret-data';
      const cookie = new Cookie('session', plaintext);
      const encrypted = expectOk(await cp.encrypt(cookie));
      expect(encrypted.name).toBe('session');
      expect(encrypted.value).not.toBe(plaintext);
      expect(encrypted.value.length).toBeGreaterThan(0);
      // The opaque ciphertext must not leak the plaintext anywhere in the wire value.
      expect(encrypted.value).not.toContain(plaintext);
      // Full encrypt -> decrypt round-trip recovers the original plaintext.
      const decrypted = expectOk(await cp.decrypt(encrypted));
      expect(decrypted.value).toBe(plaintext);
    });

    it('should preserve cookie name and attributes when encrypting', async () => {
      const cp = CookieParser.create({ encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      const cookie = new Cookie('token', 'val', {
        path: '/api',
        secure: true,
        httpOnly: true,
      });
      const encrypted = expectOk(await cp.encrypt(cookie));
      expect(encrypted.name).toBe('token');
      expect(encrypted.path).toBe('/api');
      expect(encrypted.secure).toBe(true);
      expect(encrypted.httpOnly).toBe(true);
    });

    it('should throw EncryptionNotConfigured when encrypting without secret', async () => {
      const cp = CookieParser.create();
      expect(asErr(await cp.encrypt(new Cookie('n', 'v'))).data.reason).toBe(
        CookieErrorReason.EncryptionNotConfigured,
      );
    });

    it('should return different ciphertexts when encrypting same cookie twice', async () => {
      const cp = CookieParser.create({ encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      const cookie = new Cookie('n', 'same-value');
      const a = expectOk(await cp.encrypt(cookie));
      const b = expectOk(await cp.encrypt(cookie));
      expect(a.value).not.toBe(b.value);
    });
  });

  describe('decrypt', () => {
    it('should return Cookie with original value when decrypting', async () => {
      const cp = CookieParser.create({ encryptionSecret: 'mrL_P-ipSo5gJWyLB1fpKzLvXpDQhWd127WUIjVkE0Q' });
      const encrypted = expectOk(await cp.encrypt(new Cookie('n', 'plaintext')));
      const decrypted = expectOk(await cp.decrypt(encrypted));
      expect(decrypted.name).toBe('n');
      expect(decrypted.value).toBe('plaintext');
    });

    it('should throw EncryptionNotConfigured when decrypting without secret', async () => {
      const cp = CookieParser.create();
      expect(asErr(await cp.decrypt(new Cookie('n', 'cipher'))).data.reason).toBe(
        CookieErrorReason.EncryptionNotConfigured,
      );
    });

    it('should throw InvalidCiphertext when decrypting too-short value', async () => {
      const cp = CookieParser.create({ encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      expect(asErr(await cp.decrypt(new Cookie('n', 'short'))).data.reason).toBe(
        CookieErrorReason.InvalidCiphertext,
      );
    });

    it('should throw DecryptionFailed when decrypting tampered ciphertext', async () => {
      const cp = CookieParser.create({ encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      const encrypted = expectOk(await cp.encrypt(new Cookie('n', 'v')));
      const tampered = new Cookie(
        'n',
        encrypted.value.slice(0, -4) + 'XXXX',
      );
      expect(asErr(await cp.decrypt(tampered)).data.reason).toBe(
        CookieErrorReason.DecryptionFailed,
      );
    });

    it('should throw DecryptionFailed when decrypting with wrong key', async () => {
      const cpA = CookieParser.create({ encryptionSecret: '15MzBo5XvJ5s4pH6_Qg2rdLQ73O_ZWOyoNT2vsDtN1U' });
      const cpB = CookieParser.create({ encryptionSecret: 'G2ChMLgCJsc5VkAXlrN2ZUqgAKHsrASwTplEv5lcS1w' });
      const encrypted = expectOk(await cpA.encrypt(new Cookie('n', 'v')));
      expect(asErr(await cpB.decrypt(encrypted)).data.reason).toBe(
        CookieErrorReason.DecryptionFailed,
      );
    });

    it('should return original value when encrypt then decrypt roundtrip', async () => {
      const cp = CookieParser.create({ encryptionSecret: '_cxDYhedJoI3pyfq0QbajZaiG-_F-pAASJH65k7wr6w' });
      const original = new Cookie('session', 'user:42', { path: '/', secure: true });
      const encrypted = expectOk(await cp.encrypt(original));
      const decrypted = expectOk(await cp.decrypt(encrypted));
      expect(decrypted.value).toBe('user:42');
      expect(decrypted.name).toBe('session');
    });
  });

  describe('validatePrefix', () => {
    it('should pass when validating __Host- cookie with all valid attributes', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('__Host-session', 'v', {
        secure: true,
        path: '/',
      });
      expectOk(cp.validatePrefix(cookie));
    });

    it('should pass when validating __Secure- cookie with secure flag', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('__Secure-token', 'v', { secure: true });
      expectOk(cp.validatePrefix(cookie));
    });

    it('should pass when validating cookie without prefix', () => {
      const cp = CookieParser.create();
      expectOk(cp.validatePrefix(new Cookie('normal', 'v')));
    });

    it('should throw HostPrefixRequiresSecure when __Host- without secure', () => {
      const cp = CookieParser.create();
      expect(asErr(cp.validatePrefix(new Cookie('__Host-x', 'v', { path: '/' }))).data.reason).toBe(
        CookieErrorReason.HostPrefixRequiresSecure,
      );
    });

    it('should throw HostPrefixForbidsDomain when __Host- with domain', () => {
      const cp = CookieParser.create();
      expect(asErr(cp.validatePrefix(
        new Cookie('__Host-x', 'v', {
          secure: true,
          path: '/',
          domain: 'example.com',
        }),
      )).data.reason).toBe(
        CookieErrorReason.HostPrefixForbidsDomain,
      );
    });

    it('should throw HostPrefixRequiresRootPath when __Host- with wrong path', () => {
      const cp = CookieParser.create();
      expect(asErr(cp.validatePrefix(new Cookie('__Host-x', 'v', { secure: true, path: '/admin' }))).data.reason).toBe(
        CookieErrorReason.HostPrefixRequiresRootPath,
      );
    });

    it('should throw SecurePrefixRequiresSecure when __Secure- without secure', () => {
      const cp = CookieParser.create();
      expect(asErr(cp.validatePrefix(new Cookie('__Secure-x', 'v'))).data.reason).toBe(
        CookieErrorReason.SecurePrefixRequiresSecure,
      );
    });
  });

  describe('pipeline', () => {
    it('should complete outbound pipeline validatePrefix then sign then encrypt then serialize', async () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      const cookie = new Cookie('__Secure-session', 'data', {
        secure: true,
        path: '/',
      });
      expectOk(cp.validatePrefix(cookie));
      const signed = expectOk(cp.sign(cookie));
      const encrypted = expectOk(await cp.encrypt(signed));
      const header = expectOk(cp.serialize(encrypted));
      expect(header).toContain('__Secure-session=');
    });

    it('should complete inbound pipeline parse then decrypt then unsign', async () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      const original = new Cookie('session', 'secret-data');
      const signed = expectOk(cp.sign(original));
      const encrypted = expectOk(await cp.encrypt(signed));
      const header = expectOk(cp.serialize(encrypted));
      const parsed = Cookie.parse(header);
      const decrypted = expectOk(await cp.decrypt(parsed));
      const unsigned = expectOk(await cp.unsign(decrypted));
      expect(unsigned.value).toBe('secret-data');
    });

    it('should produce different results when sign-then-encrypt vs encrypt-then-sign', async () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      const cookie = new Cookie('n', 'v');
      const signFirst = expectOk(await cp.encrypt(expectOk(cp.sign(cookie))));
      const encryptFirst = expectOk(cp.sign(expectOk(await cp.encrypt(cookie))));
      expect(signFirst.value).not.toBe(encryptFirst.value);
    });

    it('should throw EncryptionNotConfigured when created with secrets only and encrypt called', async () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'] });
      expect(asErr(await cp.encrypt(new Cookie('n', 'v'))).data.reason).toBe(
        CookieErrorReason.EncryptionNotConfigured,
      );
    });

    it('should throw SigningNotConfigured when created with encryptionSecret only and sign called', () => {
      const cp = CookieParser.create({ encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      expect(asErr(cp.sign(new Cookie('n', 'v'))).data.reason).toBe(
        CookieErrorReason.SigningNotConfigured,
      );
    });

    it('should always sign with first secret in array', () => {
      const cpA = CookieParser.create({ secrets: ['TkAnVMEz2b6plPoYz_d34hH8YUoKtqSpKw98hRF1jyc', 'xWrp7xEBI_mt-LG3QJDz6wMQr37-nK0PvNmQp2Ejg0g'] });
      const cpB = CookieParser.create({ secrets: ['TkAnVMEz2b6plPoYz_d34hH8YUoKtqSpKw98hRF1jyc'] });
      const cookie = new Cookie('n', 'v');
      expect(expectOk(cpA.sign(cookie)).value).toBe(expectOk(cpB.sign(cookie)).value);
    });

    it('should unsign with old secret when key rotation array includes it', async () => {
      const cpOld = CookieParser.create({ secrets: ['L9B6csE6Sq9NA6MXZumamSev-eUUCfzGF_wMa8BRUaU'] });
      const signed = expectOk(cpOld.sign(new Cookie('n', 'important')));
      const cpRotated = CookieParser.create({ secrets: ['1cxQCYROyjGcQQ_wLx_R6aGe0sfQL2LYjoQ3UStKWUI', 'L9B6csE6Sq9NA6MXZumamSev-eUUCfzGF_wMa8BRUaU'] });
      const unsigned = expectOk(await cpRotated.unsign(signed));
      expect(unsigned.value).toBe('important');
    });
  });

  describe('algorithm', () => {
    it('should sign with sha384 algorithm', async () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], algorithm: SigningAlgorithm.Sha384 });
      const signed = expectOk(cp.sign(new Cookie('n', 'v')));
      expect(signed.value).toContain('v.');
      const unsigned = expectOk(await cp.unsign(signed));
      expect(unsigned.value).toBe('v');
    });

    it('should sign with sha512 algorithm', async () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], algorithm: SigningAlgorithm.Sha512 });
      const signed = expectOk(cp.sign(new Cookie('n', 'v')));
      expect(signed.value).toContain('v.');
      const unsigned = expectOk(await cp.unsign(signed));
      expect(unsigned.value).toBe('v');
    });

    it('should produce different signatures for different algorithms', () => {
      const cp256 = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], algorithm: SigningAlgorithm.Sha256 });
      const cp512 = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], algorithm: SigningAlgorithm.Sha512 });
      const cookie = new Cookie('n', 'v');
      expect(expectOk(cp256.sign(cookie)).value).not.toBe(expectOk(cp512.sign(cookie)).value);
    });

    it('should fail to unsign with different algorithm', async () => {
      const cp256 = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], algorithm: SigningAlgorithm.Sha256 });
      const cp512 = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], algorithm: SigningAlgorithm.Sha512 });
      const signed = expectOk(cp256.sign(new Cookie('n', 'v')));
      expect(asErr(await cp512.unsign(signed)).data.reason).toBe(
        CookieErrorReason.SignatureVerificationFailed,
      );
    });

    it('should throw InvalidAlgorithm when algorithm is unsupported', () => {
      let caught: unknown;
      try {
        // @ts-expect-error — intentionally out-of-union value; tests runtime rejection of an untyped caller
        CookieParser.create({ algorithm: 'md5' });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect(asCookieError(caught).reason).toBe(CookieErrorReason.InvalidAlgorithm);
    });
  });

  describe('createCookie', () => {
    it('should create cookie with no defaults when none configured', () => {
      const cp = CookieParser.create();
      const cookie = expectOk(cp.createCookie('session', 'abc'));
      expect(cookie.name).toBe('session');
      expect(cookie.value).toBe('abc');
    });

    it('should apply parser defaults to created cookie', () => {
      const cp = CookieParser.create({
        httpOnly: true,
        secure: true,
        sameSite: SameSite.Strict,
        path: '/app',
        domain: 'example.com',
        maxAge: 3600,
        partitioned: true,
      });
      const cookie = expectOk(cp.createCookie('session', 'abc'));
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.secure).toBe(true);
      expect(cookie.sameSite).toBe('strict');
      expect(cookie.path).toBe('/app');
      expect(cookie.domain).toBe('example.com');
      expect(cookie.maxAge).toBe(3600);
      expect(cookie.partitioned).toBe(true);
    });

    it('should allow per-cookie overrides over parser defaults', () => {
      const cp = CookieParser.create({
        httpOnly: true,
        secure: true,
        path: '/',
      });
      const cookie = expectOk(cp.createCookie('session', 'abc', {
        httpOnly: false,
        secure: false,
        path: '/admin',
      }));
      expect(cookie.httpOnly).toBe(false);
      expect(cookie.secure).toBe(false);
      expect(cookie.path).toBe('/admin');
    });

    it('should not apply secure to cookie when default is auto', () => {
      const cp = CookieParser.create({ secure: 'auto' });
      const cookie = expectOk(cp.createCookie('session', 'abc'));
      expect(cookie.secure).toBe(false);
    });

    it('should allow explicit secure override even when default is auto', () => {
      const cp = CookieParser.create({ secure: 'auto' });
      const cookie = expectOk(cp.createCookie('session', 'abc', { secure: true }));
      expect(cookie.secure).toBe(true);
    });
  });

  describe('serialize with context', () => {
    it('should resolve secure auto to true when context.isSecure is true', () => {
      const cp = CookieParser.create({ secure: 'auto' });
      const cookie = new Cookie('session', 'abc');
      const header = cp.serialize(cookie, { isSecure: true });
      expect(header).toContain('Secure');
    });

    it('should resolve secure auto to false when context.isSecure is false', () => {
      const cp = CookieParser.create({ secure: 'auto' });
      const cookie = new Cookie('session', 'abc');
      const header = cp.serialize(cookie, { isSecure: false });
      expect(header).not.toContain('Secure');
    });

    it('throws when secure="auto" but no SerializeContext is provided', () => {
      const cp = CookieParser.create({ secure: 'auto' });
      const cookie = new Cookie('session', 'abc');
      expect(asErr(cp.serialize(cookie)).data.reason).toBe(CookieErrorReason.InvalidAttribute);
    });

    it('different kdfSalt produces signatures that do not cross-verify', async () => {
      const secret = '5qly1QnPB1M6tT3thbFxuaY6A7OXv2zS8_O3VTHTAQ8';
      const a = CookieParser.create({ secrets: [secret], kdfSalt: 'deployment-A-salt-padding-32-bytes!!' });
      const b = CookieParser.create({ secrets: [secret], kdfSalt: 'deployment-B-salt-padding-32-bytes!!' });
      const signed = expectOk(a.sign(new Cookie('s', 'v')));
      expect(asErr(await b.unsign(signed)).data.reason).toBe(CookieErrorReason.SignatureVerificationFailed);
    });

    it('throws when secure="auto" but context.isSecure is undefined', () => {
      const cp = CookieParser.create({ secure: 'auto' });
      const cookie = new Cookie('session', 'abc');
      expect(asErr(cp.serialize(cookie, {})).data.reason).toBe(CookieErrorReason.InvalidAttribute);
    });

    it('should apply nullable defaults in serialize when cookie has no domain', () => {
      const cp = CookieParser.create({ domain: 'example.com' });
      const cookie = new Cookie('session', 'abc');
      const header = expectOk(cp.serialize(cookie));
      expect(header).toContain('Domain=example.com');
    });

    it('should not override cookie domain with default', () => {
      const cp = CookieParser.create({ domain: 'default.com' });
      const cookie = new Cookie('session', 'abc', { domain: 'explicit.com' });
      const header = expectOk(cp.serialize(cookie));
      expect(header).toContain('Domain=explicit.com');
      expect(header).not.toContain('default.com');
    });

    it('should apply nullable maxAge default when cookie has none', () => {
      const cp = CookieParser.create({ maxAge: 7200 });
      const cookie = new Cookie('session', 'abc');
      const header = expectOk(cp.serialize(cookie));
      expect(header).toContain('Max-Age=7200');
    });
  });

  describe('prefixValidation', () => {
    it('should auto-validate prefix when prefixValidation is true', () => {
      const cp = CookieParser.create({ prefixValidation: true });
      const cookie = new Cookie('__Host-x', 'v', { path: '/' });
      expect(asErr(cp.serialize(cookie)).data.reason).toBe(
        CookieErrorReason.HostPrefixRequiresSecure,
      );
    });

    it('should not validate prefix when prefixValidation is false', () => {
      const cp = CookieParser.create({ prefixValidation: false });
      const cookie = new Cookie('__Host-x', 'v', { path: '/' });
      expectOk(cp.serialize(cookie));
    });

    it('should pass auto-validation for valid __Host- cookie', () => {
      const cp = CookieParser.create({ prefixValidation: true });
      const cookie = new Cookie('__Host-session', 'v', {
        secure: true,
        path: '/',
      });
      expectOk(cp.serialize(cookie));
    });

    it('should auto-validate with secure auto resolved to true', () => {
      const cp = CookieParser.create({
        prefixValidation: true,
        secure: 'auto',
      });
      const cookie = new Cookie('__Secure-token', 'v');
      expectOk(cp.serialize(cookie, { isSecure: true }));
    });

    it('should fail auto-validation with secure auto resolved to false', () => {
      const cp = CookieParser.create({
        prefixValidation: true,
        secure: 'auto',
      });
      const cookie = new Cookie('__Secure-token', 'v');
      expect(asErr(cp.serialize(cookie, { isSecure: false })).data.reason).toBe(
        CookieErrorReason.SecurePrefixRequiresSecure,
      );
    });
  });

  describe('cloneCookieWithDefaults', () => {
    it('should apply nullable defaults when signing cookie with no domain', () => {
      const cp = CookieParser.create({
        secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'],
        domain: 'example.com',
        maxAge: 3600,
      });
      const cookie = new Cookie('session', 'data');
      const signed = expectOk(cp.sign(cookie));
      const header = expectOk(cp.serialize(signed));
      expect(header).toContain('Domain=example.com');
      expect(header).toContain('Max-Age=3600');
    });

    it('should preserve maxAge 0 through sign roundtrip', async () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'] });
      const cookie = new Cookie('session', 'data', { maxAge: 0 });
      const signed = expectOk(cp.sign(cookie));
      expect(signed.maxAge).toBe(0);
      const unsigned = expectOk(await cp.unsign(signed));
      expect(unsigned.maxAge).toBe(0);
    });

    it('does NOT inject the parser default Domain into a __Host- cookie when signing', () => {
      // __Host- forbids Domain (RFC 6265bis §4.1.3.2). mergeAttributes/applyDefaultsForSerialize already
      // suppress the default Domain for __Host- names; cloneWithValue (used by sign/encrypt) must do the
      // same, else the signed clone carries the default Domain and serialize() rejects it.
      const cp = CookieParser.create({
        secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'],
        domain: 'example.com',
      });
      const signed = expectOk(cp.sign(new Cookie('__Host-sid', 'v', { secure: true, path: '/' })));
      const header = expectOk(cp.serialize(signed));
      expect(header).not.toContain('Domain=');
      expect(header).toContain('Secure');
    });
  });

  describe('RFC compliance', () => {
    it('should throw InvalidCookieName when name is empty', () => {
      const cp = CookieParser.create();
      expect(asErr(cp.createCookie('', 'v')).data.reason).toBe(CookieErrorReason.InvalidCookieName);
    });

    it('should throw InvalidCookieName when name contains spaces', () => {
      const cp = CookieParser.create();
      expect(asErr(cp.createCookie('bad name', 'v')).data.reason).toBe(CookieErrorReason.InvalidCookieName);
    });

    it('should throw InvalidCookieName when name contains control chars', () => {
      const cp = CookieParser.create();
      expect(asErr(cp.createCookie('bad\x00name', 'v')).data.reason).toBe(CookieErrorReason.InvalidCookieName);
    });

    it('should throw InvalidCookieName when name contains separator chars', () => {
      const cp = CookieParser.create();
      for (const ch of ['(', ')', '<', '>', '@', ',', ';', ':', '\\', '"', '/', '[', ']', '?', '=', '{', '}']) {
        expect(asErr(cp.createCookie(`bad${ch}name`, 'v')).data.reason).toBe(CookieErrorReason.InvalidCookieName);
      }
    });

    it('should accept valid token characters in cookie name', () => {
      const cp = CookieParser.create();
      expectOk(cp.createCookie('valid-name_123.test~!', 'v'));
    });

    it('should throw CookieTooLarge when serialized cookie exceeds 4096 bytes', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('session', 'x'.repeat(4096));
      expect(asErr(cp.serialize(cookie)).data.reason).toBe(CookieErrorReason.CookieTooLarge);
    });

    it('should not throw when serialized cookie is within 4096 bytes', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg', 'v');
      expectOk(cp.serialize(cookie));
    });
  });

  describe('edge cases', () => {
    it('should encrypt and decrypt empty string value', async () => {
      const cp = CookieParser.create({ encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      const cookie = new Cookie('session', '');
      const encrypted = expectOk(await cp.encrypt(cookie));
      const decrypted = expectOk(await cp.decrypt(encrypted));
      expect(decrypted.value).toBe('');
    });

    it('should apply expires default in serialize when cookie has none', () => {
      const expires = new Date(Date.now() + 30 * 86400 * 1000);
      const cp = CookieParser.create({ expires });
      const cookie = new Cookie('session', 'v');
      const header = expectOk(cp.serialize(cookie));
      expect(header).toContain('Expires=');
    });

    it('serializes a numeric (JS ms) DEFAULT expires at the correct epoch, not Bun seconds', () => {
      // A bare number is JS milliseconds (Date.now() convention); Bun.Cookie reads numbers as seconds,
      // which would mis-serialize 2030 as year ~57425 unless we normalize number -> Date at resolve.
      const ms = Date.UTC(2030, 0, 1, 0, 0, 0); // Tue, 01 Jan 2030 00:00:00 GMT
      const cp = CookieParser.create({ expires: ms });
      const header = expectOk(cp.serialize(new Cookie('x', 'v')));
      expect(header).toContain('Expires=Tue, 01 Jan 2030 00:00:00 GMT');
    });

    it('serializes a numeric (JS ms) EXPLICIT expires at the correct epoch, not Bun seconds', () => {
      const ms = Date.UTC(2030, 0, 1, 0, 0, 0);
      const cp = CookieParser.create();
      const cookie = expectOk(cp.createCookie('x', 'v', { expires: ms }));
      const header = expectOk(cp.serialize(cookie));
      expect(header).toContain('Expires=Tue, 01 Jan 2030 00:00:00 GMT');
    });

    it('throws InvalidMaxAge at create() when the default maxAge is 0 (config error)', () => {
      // A default maxAge of 0 is ungrammatical (max-age-av = non-zero-digit *DIGIT) and now fails fast at
      // boot. A per-call createCookie({ maxAge: 0 }) still surfaces as a per-request Err (see createCookie).
      expect(captureCookieError(() => CookieParser.create({ maxAge: 0 })).reason).toBe(CookieErrorReason.InvalidMaxAge);
    });

    it('should not clone in serialize when no defaults apply and secure is not auto', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('session', 'v', { secure: true, path: '/' });
      const header = expectOk(cp.serialize(cookie));
      expect(header).toContain('session=v');
      expect(header).toContain('Secure');
    });
  });

  describe('RFC 6265bis compliance', () => {
    it('should throw SameSiteNoneRequiresSecure when SameSite=None without Secure', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('session', 'v', { sameSite: 'none' });
      expect(asErr(cp.serialize(cookie)).data.reason).toBe(
        CookieErrorReason.SameSiteNoneRequiresSecure,
      );
    });

    it('should allow SameSite=None with Secure', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('session', 'v', { sameSite: 'none', secure: true });
      expectOk(cp.serialize(cookie));
    });

    it('should allow SameSite=Lax without Secure', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('session', 'v', { sameSite: 'lax' });
      expectOk(cp.serialize(cookie));
    });

    it('should allow SameSite=Strict without Secure', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('session', 'v', { sameSite: 'strict' });
      expectOk(cp.serialize(cookie));
    });

    it('should allow cookie without Max-Age', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('session', 'v');
      expectOk(cp.serialize(cookie));
    });

    it('should validate SameSite=None after secure auto resolves to true', () => {
      const cp = CookieParser.create({ secure: 'auto' });
      const cookie = new Cookie('session', 'v', { sameSite: 'none' });
      expectOk(cp.serialize(cookie, { isSecure: true }));
    });

    it('should reject SameSite=None after secure auto resolves to false', () => {
      const cp = CookieParser.create({ secure: 'auto' });
      const cookie = new Cookie('session', 'v', { sameSite: 'none' });
      expect(asErr(cp.serialize(cookie, { isSecure: false })).data.reason).toBe(
        CookieErrorReason.SameSiteNoneRequiresSecure,
      );
    });
    it('should throw PartitionedRequiresSecure when Partitioned without Secure', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('session', 'v', { partitioned: true });
      expect(asErr(cp.serialize(cookie)).data.reason).toBe(
        CookieErrorReason.PartitionedRequiresSecure,
      );
    });

    it('should allow Partitioned with Secure', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('session', 'v', { partitioned: true, secure: true });
      expectOk(cp.serialize(cookie));
    });

    it('should reject domain with semicolon at Cookie construction (Bun validates)', () => {
      expect(() => new Cookie('session', 'v', { domain: 'evil.com; Path=/' })).toThrow();
    });

    it('should reject domain with newline at Cookie construction (Bun validates)', () => {
      expect(() => new Cookie('session', 'v', { domain: "evil.com\r\nSet-Cookie: bad=1" })).toThrow();
    });

    it('should reject path with semicolon at Cookie construction (Bun validates)', () => {
      expect(() => new Cookie('session', 'v', { path: '/; Domain=evil.com' })).toThrow();
    });

    it('should reject path with newline at Cookie construction (Bun validates)', () => {
      expect(() => new Cookie('session', 'v', { path: "/\r\nSet-Cookie: bad=1" })).toThrow();
    });

    it('should allow valid domain and path', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('session', 'v', {
        domain: 'example.com',
        path: '/app/dashboard',
        secure: true,
      });
      expectOk(cp.serialize(cookie));
    });

    it('should accept a path without a leading "/" (path-value = *av-octet, bis §4.1.1)', () => {
      const cp = CookieParser.create();
      expectOk(cp.createCookie('n', 'v', { path: 'foo' }));
      expect(expectOk(cp.serialize(expectOk(cp.createCookie('n', 'v', { path: 'foo' }))))).toContain('Path=foo');
    });
  });

  describe('name binding (C1, C2 fixes)', () => {
    const SIGN_SECRET = 'CBzj5JR05_07YsY5omzjqXIij4t3dRfV53j5O7CQJ7A';
    const ENC_SECRET = 'cR4uVjV4lfCVnqFwvsyNGlH7SJ_mtBG5OdXE-evGkIY';

    it('should reject HMAC-signed value when cookie name differs (C1)', async () => {
      const cp = CookieParser.create({ secrets: [SIGN_SECRET] });
      const signed = expectOk(cp.sign(new Cookie('admin', 'true')));
      // Replay signature under a different cookie name
      const replayed = new Cookie('user', signed.value);
      expect(asErr(await cp.unsign(replayed)).data.reason).toBe(CookieErrorReason.SignatureVerificationFailed);
    });

    it('should reject AES-GCM ciphertext when cookie name differs (C2)', async () => {
      const cp = CookieParser.create({ encryptionSecret: ENC_SECRET });
      const encrypted = expectOk(await cp.encrypt(new Cookie('admin', 'true')));
      const replayed = new Cookie('user', encrypted.value);
      expect(asErr(await cp.decrypt(replayed)).data.reason).toBe(CookieErrorReason.DecryptionFailed);
    });

    it('should sign and unsign successfully when cookie name matches', async () => {
      const cp = CookieParser.create({ secrets: [SIGN_SECRET] });
      const signed = expectOk(cp.sign(new Cookie('session', 'data')));
      const unsigned = expectOk(await cp.unsign(signed));
      expect(unsigned.value).toBe('data');
    });

    it('should encrypt and decrypt successfully when cookie name matches', async () => {
      const cp = CookieParser.create({ encryptionSecret: ENC_SECRET });
      const encrypted = expectOk(await cp.encrypt(new Cookie('session', 'data')));
      const decrypted = expectOk(await cp.decrypt(encrypted));
      expect(decrypted.value).toBe('data');
    });
  });

  describe('encryption key rotation (H2 fix)', () => {
    const KEY_OLD = '6H3Sj5cLS9TVElTBHCWw8a90Gdi1B0TyW4hs5ZUXK8o';
    const KEY_NEW = 'ESduDrMmoDDKP-g1nZ882YzFcaZiYg-IzQoIiDqQ5kU';

    it('should accept encryptionSecret as array', () => {
      const cp = CookieParser.create({ encryptionSecret: [KEY_NEW, KEY_OLD] });
      expect(cp).toBeInstanceOf(CookieParser);
    });

    it('should encrypt with first key and decrypt with any key in array', async () => {
      const cpOld = CookieParser.create({ encryptionSecret: KEY_OLD });
      const encryptedOld = expectOk(await cpOld.encrypt(new Cookie('s', 'data')));
      const cpRotated = CookieParser.create({ encryptionSecret: [KEY_NEW, KEY_OLD] });
      const decrypted = expectOk(await cpRotated.decrypt(encryptedOld));
      expect(decrypted.value).toBe('data');
    });

    it('should fail to decrypt when no rotation key matches', async () => {
      const cpA = CookieParser.create({ encryptionSecret: KEY_OLD });
      const encrypted = expectOk(await cpA.encrypt(new Cookie('s', 'data')));
      const cpB = CookieParser.create({ encryptionSecret: 'Zgpo7Ytgh_uw3ubvZ7SssN8oCbLdnr1DeeN6XSKScMA' });
      expect(asErr(await cpB.decrypt(encrypted)).data.reason).toBe(CookieErrorReason.DecryptionFailed);
    });
  });

  describe('blank secret rejection', () => {
    it('should throw InvalidSecret when a signing secret is blank', () => {
      let caught: unknown;
      try { CookieParser.create({ secrets: ['  '] }); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
      expect(asCookieError(caught).reason).toBe(CookieErrorReason.InvalidSecret);
    });

    it('should throw InvalidEncryptionSecret when an encryption secret is blank', () => {
      let caught: unknown;
      try { CookieParser.create({ encryptionSecret: '  ' }); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
      expect(asCookieError(caught).reason).toBe(CookieErrorReason.InvalidEncryptionSecret);
    });

    it('should accept a short secret (strength is the operator\'s responsibility)', () => {
      expect(() => CookieParser.create({ secrets: ['short'] })).not.toThrow();
      expect(() => CookieParser.create({ encryptionSecret: 'short' })).not.toThrow();
    });

    it('should accept a low-entropy secret (single repeated char)', () => {
      expect(() => CookieParser.create({ secrets: ['a'.repeat(40)] })).not.toThrow();
    });
  });

  describe('maxAge integer validation (N6, N7 fixes)', () => {
    it('should throw InvalidMaxAge when maxAge is NaN via createCookie (N6)', () => {
      const cp = CookieParser.create();
      expect(asErr(cp.createCookie('n', 'v', { maxAge: NaN })).data.reason).toBe(CookieErrorReason.InvalidMaxAge);
    });

    it('should throw InvalidMaxAge when maxAge is decimal 0.5 via createCookie (N7)', () => {
      const cp = CookieParser.create();
      expect(asErr(cp.createCookie('n', 'v', { maxAge: 0.5 })).data.reason).toBe(CookieErrorReason.InvalidMaxAge);
    });

    it('should throw InvalidMaxAge when maxAge is Infinity via createCookie', () => {
      const cp = CookieParser.create();
      expect(asErr(cp.createCookie('n', 'v', { maxAge: Infinity })).data.reason).toBe(CookieErrorReason.InvalidMaxAge);
    });

    it('should throw InvalidMaxAge in serialize when raw Cookie has decimal maxAge', () => {
      const cp = CookieParser.create();
      expect(asErr(cp.serialize(new Cookie('n', 'v', { maxAge: 0.5 }))).data.reason).toBe(CookieErrorReason.InvalidMaxAge);
    });

    it('should throw InvalidMaxAge when maxAge is negative (bis §4.1.1 non-zero-digit)', () => {
      const cp = CookieParser.create();
      expect(asErr(cp.createCookie('n', 'v', { maxAge: -1 })).data.reason).toBe(CookieErrorReason.InvalidMaxAge);
    });

    it('should throw InvalidMaxAge when maxAge is zero (bis §4.1.1 non-zero-digit)', () => {
      const cp = CookieParser.create();
      expect(asErr(cp.createCookie('n', 'v', { maxAge: 0 })).data.reason).toBe(CookieErrorReason.InvalidMaxAge);
    });
  });

  describe('constant-time HMAC verify (H3 fix)', () => {
    it('should verify correctly regardless of secret position in array', async () => {
      const KEY1 = '-0dchjqFPQroVsWenM90XGv9NwJ0SfIeMvViNC_P90s';
      const KEY5 = 'AjtO7x4Fi8N8X8_vJRapkf8F-lmYjkzTyTMoSr5Ywv4';
      const cp = CookieParser.create({ secrets: [KEY1, 't5U2PwbDwqncuRrp7ugKdwCdVNxY9l59p0DpZtCsr_w', 'nbfONK9H2TJNeewNHc4JE00NwToJpRqL8-PFeQgPsz4', 'h4Y-jMwAdZXyGnHTqRK3f4spihRsOLqCr1Z8NokZBkc', KEY5] });
      // Sign with last key
      const cpLast = CookieParser.create({ secrets: [KEY5] });
      const signed = expectOk(cpLast.sign(new Cookie('s', 'data')));
      // Verifies even though it's last in rotation array
      const unsigned = expectOk(await cp.unsign(signed));
      expect(unsigned.value).toBe('data');
    });
  });

  describe('token validation across all entry points (H-1 fix)', () => {
    const SIGN_SECRET = 'mUGiDLrJDq7yYP8XCeTmvHFu6uUYzYLNhl03gLPfllA';
    const ENC_SECRET = 'weIQlNCq5MacmAUQsFI8EnM1NM4Dana95Mn48ResQYs';

    async function expectInvalidName(fn: () => Result<unknown, CookieErrorData> | Promise<Result<unknown, CookieErrorData>>): Promise<void> {
      const result: Result<unknown, CookieErrorData> = await fn();
      expect(asErr<unknown, CookieErrorData>(result).data.reason).toBe(CookieErrorReason.InvalidCookieName);
    }

    it('should reject comma in name via serialize (RFC 9110 §5.6.2 token violation)', () => {
      const cp = CookieParser.create();
      return expectInvalidName(() => cp.serialize(new Cookie('bad,name', 'v')));
    });

    it('should reject paren in name via serialize', () => {
      const cp = CookieParser.create();
      return expectInvalidName(() => cp.serialize(new Cookie('bad(name', 'v')));
    });

    it('should reject quote in name via serialize', () => {
      const cp = CookieParser.create();
      return expectInvalidName(() => cp.serialize(new Cookie('bad"name', 'v')));
    });

    it('should reject @ in name via serialize', () => {
      const cp = CookieParser.create();
      return expectInvalidName(() => cp.serialize(new Cookie('bad@name', 'v')));
    });

    it('should reject invalid name via sign', () => {
      const cp = CookieParser.create({ secrets: [SIGN_SECRET] });
      return expectInvalidName(() => cp.sign(new Cookie('bad,name', 'v')));
    });

    it('should reject invalid name via encrypt', async () => {
      const cp = CookieParser.create({ encryptionSecret: ENC_SECRET });
      await expectInvalidName(() => cp.encrypt(new Cookie('bad,name', 'v')));
    });

    it('should reject invalid name via unsign', async () => {
      const cp = CookieParser.create({ secrets: [SIGN_SECRET] });
      await expectInvalidName(() => cp.unsign(new Cookie('bad,name', 'v.sig')));
    });

    it('should reject invalid name via decrypt', async () => {
      const cp = CookieParser.create({ encryptionSecret: ENC_SECRET });
      await expectInvalidName(() => cp.decrypt(new Cookie('bad,name', 'bDx0MVBNq29dB9qJ7q1QHW_zSizEq3rqcoDOM_X7RWs')));
    });

    it('should reject invalid name via validatePrefix', () => {
      const cp = CookieParser.create();
      return expectInvalidName(() => cp.validatePrefix(new Cookie('bad,name', 'v')));
    });
  });

  describe('expires normalization (H-2 fix)', () => {
    it('should throw CookieError(InvalidExpires) for invalid date string via createCookie', () => {
      const cp = CookieParser.create();
      expect(asErr(cp.createCookie('n', 'v', { expires: 'not-a-date' })).data.reason).toBe(CookieErrorReason.InvalidExpires);
    });

    it('should throw CookieError(InvalidExpires) for NaN expires', () => {
      const cp = CookieParser.create();
      expect(asErr(cp.createCookie('n', 'v', { expires: NaN })).data.reason).toBe(CookieErrorReason.InvalidExpires);
    });

    it('should throw CookieError(InvalidExpires) for invalid Date object', () => {
      const cp = CookieParser.create();
      expect(asErr(cp.createCookie('n', 'v', { expires: new Date('invalid') })).data.reason).toBe(CookieErrorReason.InvalidExpires);
    });

    it('should throw CookieError(InvalidExpires) for Infinity expires', () => {
      const cp = CookieParser.create();
      expect(asErr(cp.createCookie('n', 'v', { expires: Infinity })).data.reason).toBe(CookieErrorReason.InvalidExpires);
    });

    it('should accept valid IMF-fixdate string', () => {
      const cp = CookieParser.create();
      expectOk(cp.createCookie('n', 'v', { expires: 'Wed, 21 Oct 2026 07:28:00 GMT' }));
    });

    it('should accept valid Date object', () => {
      const cp = CookieParser.create();
      const future = new Date(Date.now() + 30 * 86400 * 1000);
      expectOk(cp.createCookie('n', 'v', { expires: future }));
    });

    it('should accept valid number timestamp', () => {
      const cp = CookieParser.create();
      expectOk(cp.createCookie('n', 'v', { expires: Date.now() + 30 * 86400 * 1000 }));
    });

    it('should wrap Bun ctor errors into CookieError (no TypeError leak)', () => {
      const cp = CookieParser.create();
      expect(asErr(cp.createCookie('n', 'v', { domain: 'evil; injected' })).data.reason).toBe(CookieErrorReason.InvalidDomain);
    });

    it('should wrap Bun path errors into CookieError', () => {
      const cp = CookieParser.create();
      expect(asErr(cp.createCookie('n', 'v', { path: '/x;injected' })).data.reason).toBe(CookieErrorReason.InvalidPath);
    });
  });

  describe('decrypt KID binding', () => {
    const ENC = '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4';

    it('should reject a ciphertext whose KID matches no configured key', async () => {
      const cp = CookieParser.create({ encryptionSecret: ENC });
      const encrypted = expectOk(await cp.encrypt(new Cookie('n', 'topsecret')));
      const buf = Buffer.from(encrypted.value, 'base64url');
      // Corrupt the 4-byte KID prefix; the GCM body is left intact.
      for (let i = 0; i < 4; i++) {buf[i] = (buf[i]! ^ 0xff) & 0xff;}
      expect(asErr(await cp.decrypt(new Cookie('n', buf.toString('base64url')))).data.reason).toBe(CookieErrorReason.DecryptionFailed);
    });
  });

  describe('__Host- prefix domain suppression', () => {
    it('should not apply a parser default Domain to a __Host- cookie', () => {
      const cp = CookieParser.create({ domain: 'example.com' });
      const header = expectOk(cp.serialize(expectOk(cp.createCookie('__Host-id', 'v', { secure: true, path: '/' }))));
      expect(header).not.toContain('Domain');
    });

    it('should reject an explicit Domain on a __Host- cookie at createCookie()', () => {
      const cp = CookieParser.create();
      expect(asErr(cp.createCookie('__Host-id', 'v', { secure: true, path: '/', domain: 'example.com' })).data.reason).toBe(CookieErrorReason.HostPrefixForbidsDomain);
    });

    it('should not apply a non-root parser default Path to a __Host- cookie (it mandates Path=/)', () => {
      // RFC 6265bis §4.1.3.2: __Host- requires Path=/. A parser default Path other than / must be suppressed
      // (like the default Domain), or every __Host- cookie fails prefix validation and is unserializable.
      const cp = CookieParser.create({ path: '/admin' });
      const header = expectOk(cp.serialize(expectOk(cp.createCookie('__Host-id', 'v', { secure: true }))));
      expect(header).toContain('Path=/;');
      expect(header).not.toContain('/admin');
    });

    it('still applies a parser default Path to a non-prefixed cookie', () => {
      const cp = CookieParser.create({ path: '/admin' });
      const header = expectOk(cp.serialize(expectOk(cp.createCookie('regular', 'v'))));
      expect(header).toContain('Path=/admin');
    });
  });

  describe('Expires canonicalization preserves the name=value pair', () => {
    it('should not drop the name=value pair when the cookie is literally named "expires"', () => {
      const cp = CookieParser.create();
      const header = expectOk(cp.serialize(expectOk(cp.createCookie('expires', 'v', { expires: new Date(Date.UTC(2030, 0, 1)), path: '/' }))));
      // The leading name=value pair must survive the Expires rewrite (regression: it was filtered out).
      expect(header.startsWith('expires=v')).toBe(true);
      expect(header).toContain('Expires=Tue, 01 Jan 2030 00:00:00 GMT');
    });

    it('should emit a canonical IMF-fixdate Expires for an ordinary cookie', () => {
      const cp = CookieParser.create();
      const header = expectOk(cp.serialize(expectOk(cp.createCookie('sid', 'abc', { expires: new Date(Date.UTC(2030, 0, 1)), path: '/' }))));
      expect(header.startsWith('sid=abc')).toBe(true);
      expect(header).toContain('Expires=Tue, 01 Jan 2030 00:00:00 GMT');
      expect(header).not.toContain('-0000');
    });
  });

  describe('lifetime defaults are mutually exclusive (Max-Age vs Expires, RFC 6265bis §5.4.2)', () => {
    const future = new Date(Date.UTC(2035, 0, 1));

    it('an explicit expires suppresses the parser default Max-Age (the default would override the Expires)', () => {
      const cp = CookieParser.create({ maxAge: 3600 });
      const header = expectOk(cp.serialize(expectOk(cp.createCookie('sid', 'v', { expires: future, path: '/' }))));
      expect(header).not.toContain('Max-Age');
      expect(header).toContain('01 Jan 2035 00:00:00 GMT');
    });

    it('an explicit maxAge suppresses the parser default expires', () => {
      const cp = CookieParser.create({ expires: future });
      const header = expectOk(cp.serialize(expectOk(cp.createCookie('sid', 'v', { maxAge: 100, path: '/' }))));
      expect(header).toContain('Max-Age=100');
      expect(header).not.toContain('Expires');
    });

    it('still applies a parser default Max-Age when no explicit lifetime is given', () => {
      const cp = CookieParser.create({ maxAge: 3600 });
      const header = expectOk(cp.serialize(expectOk(cp.createCookie('sid', 'v', { path: '/' }))));
      expect(header).toContain('Max-Age=3600');
    });

    it('does not re-introduce the default Max-Age when signing a cookie set with an explicit expires', () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], maxAge: 3600 });
      const signed = expectOk(cp.sign(expectOk(cp.createCookie('sid', 'v', { expires: future, path: '/' }))));
      const header = expectOk(cp.serialize(signed));
      expect(header).not.toContain('Max-Age');
      expect(header).toContain('01 Jan 2035 00:00:00 GMT');
    });
  });
});
