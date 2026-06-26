import { describe, expect, it } from 'bun:test';
import { asErr, expectOk } from '../test/support';
import { isErr } from '@zipbul/result';

import { CookieErrorReason, SameSite } from './enums';
import { CookieParser } from './cookie-parser';
import { CookieJar } from './cookie-jar';

describe('CookieJar', () => {
  describe('has', () => {
    it('should return true when cookie exists', () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, 'session=abc; token=xyz');
      expect(jar.has('session')).toBe(true);
      expect(jar.has('token')).toBe(true);
    });

    it('should return false when cookie does not exist', () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, 'session=abc');
      expect(jar.has('missing')).toBe(false);
    });

    it('should return false for empty cookie header', () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, '');
      expect(jar.has('session')).toBe(false);
    });

    it('parses an inbound header at the byte cap but drops one that exceeds it (DoS amplification guard)', () => {
      const parser = CookieParser.create({ maxInboundCookieBytes: 64 });
      const atCap = `s=${'x'.repeat(62)}`; // 64 bytes exactly
      expect(new CookieJar(parser, atCap).has('s')).toBe(true);
      const overCap = `s=${'x'.repeat(63)}`; // 65 bytes
      const jar = new CookieJar(parser, overCap);
      expect(jar.has('s')).toBe(false);
      expect(jar.getRaw('s')).toBeUndefined();
    });
  });

  describe('getRaw', () => {
    it('should return raw value without processing', () => {
      const parser = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      const jar = new CookieJar(parser, 'session=raw-value; _ga=GA1.2.123');
      expect(jar.getRaw('session')).toBe('raw-value');
      expect(jar.getRaw('_ga')).toBe('GA1.2.123');
    });

    it('should return undefined when cookie does not exist', () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, '');
      expect(jar.getRaw('missing')).toBeUndefined();
    });
  });

  describe('get', () => {
    it('should return null when cookie does not exist', async () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, '');
      const result = await jar.get('missing');
      expect(result).toBeNull();
    });

    it('should return plain value when no signing or encryption configured', async () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, 'session=hello');
      const result = await jar.get('session');
      expect(result).toBe('hello');
    });

    it('should auto-unsign when signing configured', async () => {
      const parser = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'] });
      const signed = expectOk(parser.sign(new (await import('bun')).Cookie('session', 'data')));
      const jar = new CookieJar(parser, `session=${signed.value}`);
      const result = await jar.get('session');
      expect(result).toBe('data');
    });

    it('should auto-decrypt when encryption configured', async () => {
      const parser = CookieParser.create({ encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      const { Cookie } = await import('bun');
      const encrypted = expectOk(await parser.encrypt(new Cookie('session', 'secret')));
      const jar = new CookieJar(parser, `session=${encrypted.value}`);
      const result = await jar.get('session');
      expect(result).toBe('secret');
    });

    it('should auto-decrypt then auto-unsign when both configured', async () => {
      const parser = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      const { Cookie } = await import('bun');
      const cookie = new Cookie('session', 'user:42');
      const signed = expectOk(parser.sign(cookie));
      const encrypted = expectOk(await parser.encrypt(signed));
      const jar = new CookieJar(parser, `session=${encrypted.value}`);
      const result = await jar.get('session');
      expect(result).toBe('user:42');
    });

    it('should return Err when signature verification fails', async () => {
      const parser = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'] });
      const jar = new CookieJar(parser, 'session=tampered.invalidsig');
      const result = await jar.get('session');
      expect(isErr(result)).toBe(true);
      expect(asErr(result).data.reason).toBe(
        CookieErrorReason.SignatureVerificationFailed,
      );
    });

    it('should return Err when decryption fails', async () => {
      const parser = CookieParser.create({ encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      const jar = new CookieJar(parser, 'session=notvalidciphertext_padded_enough_xxxxxxxx');
      const result = await jar.get('session');
      expect(isErr(result)).toBe(true);
    });

    it('should return null for empty cookie header', async () => {
      const parser = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'] });
      const jar = new CookieJar(parser, '');
      const result = await jar.get('session');
      expect(result).toBeNull();
    });

    it('should handle multiple cookies and return correct one', async () => {
      const parser = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'] });
      const { Cookie } = await import('bun');
      const signedA = expectOk(parser.sign(new Cookie('a', 'val-a')));
      const signedB = expectOk(parser.sign(new Cookie('b', 'val-b')));
      const jar = new CookieJar(parser, `a=${signedA.value}; b=${signedB.value}`);
      expect(await jar.get('a')).toBe('val-a');
      expect(await jar.get('b')).toBe('val-b');
      expect(await jar.get('c')).toBeNull();
    });
  });

  describe('set', () => {
    it('should queue cookie for outbound', async () => {
      const parser = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'] });
      const jar = new CookieJar(parser, '');
      jar.set('session', 'user:42');
      const headers = await jar.getSetCookieHeaders();
      expect(headers).toHaveLength(1);
      expect(headers[0]).toContain('session=');
    });

    it('should apply parser defaults to set cookie', async () => {
      const parser = CookieParser.create({
        secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'],
        httpOnly: true,
        secure: true,
        path: '/',
      });
      const jar = new CookieJar(parser, '');
      jar.set('session', 'data');
      const headers = await jar.getSetCookieHeaders();
      expect(headers[0]).toContain('HttpOnly');
      expect(headers[0]).toContain('Secure');
      expect(headers[0]).toContain('Path=/');
    });

    it('should allow per-cookie attribute overrides', async () => {
      const parser = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], path: '/' });
      const jar = new CookieJar(parser, '');
      jar.set('token', 'jwt', { path: '/api' });
      const headers = await jar.getSetCookieHeaders();
      expect(headers[0]).toContain('Path=/api');
    });

    it('should throw InvalidCookieName for invalid name', () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, '');
      expect(asErr(jar.set('bad name', 'v')).data.reason).toBe(CookieErrorReason.InvalidCookieName);
    });

    it('should overwrite previously set cookie with same name', async () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, '');
      jar.set('session', 'first');
      jar.set('session', 'second');
      const headers = await jar.getSetCookieHeaders();
      expect(headers).toHaveLength(1);
      expect(headers[0]).toContain('session=second');
    });
  });

  describe('delete', () => {
    it('should queue a deletion cookie with a past Expires and no Max-Age=0', async () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, '');
      jar.delete('session');
      const headers = await jar.getSetCookieHeaders();
      expect(headers).toHaveLength(1);
      expect(headers[0]).toContain('session=');
      expect(headers[0]).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
      expect(headers[0]).not.toContain('Max-Age=0');
    });

    it('drops a caller-supplied Max-Age so deletion is past-Expires only (Max-Age would override Expires)', async () => {
      // RFC 6265bis §5.4.2: Max-Age takes precedence over Expires. If delete() kept a caller Max-Age, the
      // UA would renew the cookie for that many seconds instead of deleting it.
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, '');
      jar.delete('session', { maxAge: 100 });
      const headers = await jar.getSetCookieHeaders();
      expect(headers).toHaveLength(1);
      expect(headers[0]).not.toContain('Max-Age');
      expect(headers[0]).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    });

    it('drops a parser-default Max-Age so deletion is past-Expires only (default Max-Age would override Expires)', async () => {
      // RFC 6265bis §5.4.2: Max-Age takes precedence over Expires. A parser-level default Max-Age must not
      // ride onto a deletion, or the UA renews the cookie for that many seconds instead of deleting it.
      const parser = CookieParser.create({ maxAge: 3600 });
      const jar = new CookieJar(parser, '');
      jar.delete('session');
      const headers = await jar.getSetCookieHeaders({ isSecure: true });
      expect(headers[0]).not.toContain('Max-Age');
      expect(headers[0]).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    });

    it('should not sign or encrypt deletion cookies', async () => {
      const parser = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      const jar = new CookieJar(parser, '');
      jar.delete('session');
      const headers = await jar.getSetCookieHeaders();
      expect(headers).toHaveLength(1);
      expect(headers[0]).toContain('session=;');
    });

    it('should override previously set cookie with deletion', async () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, '');
      jar.set('session', 'data');
      jar.delete('session');
      const headers = await jar.getSetCookieHeaders();
      expect(headers).toHaveLength(1);
      expect(headers[0]).not.toContain('Max-Age=0');
    });

    it('preserves explicit sameSite="none" when caller passes secure=true (cross-site delete)', async () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, '');
      jar.delete('session', { sameSite: SameSite.None, secure: true });
      const headers = await jar.getSetCookieHeaders({ isSecure: true });
      expect(headers[0]).toContain('SameSite=None');
      expect(headers[0]).toContain('Secure');
    });

    it('preserves explicit sameSite="strict" on deletion', async () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, '');
      jar.delete('session', { sameSite: SameSite.Strict });
      const headers = await jar.getSetCookieHeaders();
      expect(headers[0]).toContain('SameSite=Strict');
    });

    it('still defaults to lax when sameSite is omitted', async () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, '');
      jar.delete('session');
      const headers = await jar.getSetCookieHeaders();
      expect(headers[0]).toContain('SameSite=Lax');
    });

    it('drops inbound cookies whose value contains U+FFFD (Bun.CookieMap silent corruption guard)', () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, 'good=ok; bad=hello%XXworld; also=fine');
      expect(jar.getRaw('good')).toBe('ok');
      expect(jar.getRaw('also')).toBe('fine');
      expect(jar.getRaw('bad')).toBeUndefined();
      expect(jar.has('bad')).toBe(false);
    });

    it('drops an inbound cookie whose name is not a valid RFC token (treated as absent, never throws from get)', async () => {
      // Bun.CookieMap keeps non-token names like "a b"; constructing `new Cookie('a b', ...)` would throw.
      // Dropping at ingest makes has/getRaw/get consistently report "absent" instead of get() rejecting.
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, 'a b=1; good=2');
      expect(jar.has('a b')).toBe(false);
      expect(jar.getRaw('a b')).toBeUndefined();
      expect(await jar.get('a b')).toBeNull();
      // a valid sibling on the same header is unaffected
      expect(jar.getRaw('good')).toBe('2');
    });

    it('emits RFC 7231 IMF-fixdate Expires (with " GMT", not "-0000")', async () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, '');
      jar.delete('session');
      const headers = await jar.getSetCookieHeaders();
      expect(headers[0]).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
      expect(headers[0]).not.toContain('-0000');
    });
  });

  describe('getSetCookieHeaders', () => {
    it('should return empty array when no outbound cookies', async () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, 'session=data');
      const headers = await jar.getSetCookieHeaders();
      expect(headers).toHaveLength(0);
    });

    it('should auto-sign outbound cookies when signing configured', async () => {
      const parser = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'] });
      const jar = new CookieJar(parser, '');
      jar.set('session', 'data');
      const headers = await jar.getSetCookieHeaders();
      expect(headers[0]).toContain('session=data.');
    });

    it('should auto-encrypt outbound cookies when encryption configured', async () => {
      const parser = CookieParser.create({ encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      const jar = new CookieJar(parser, '');
      jar.set('session', 'secret');
      const headers = await jar.getSetCookieHeaders();
      expect(headers[0]).not.toContain('secret');
    });

    it('should auto-sign then auto-encrypt when both configured', async () => {
      const parser = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      const jar = new CookieJar(parser, '');
      jar.set('session', 'data');
      const headers = await jar.getSetCookieHeaders();
      expect(headers[0]).not.toContain('data');

      // Verify roundtrip through jar
      const jar2 = new CookieJar(parser, `session=${headers[0]!.split('=')[1]!.split(';')[0]}`);
      const result = await jar2.get('session');
      expect(result).toBe('data');
    });

    it('should pass serialize context for secure auto', async () => {
      const parser = CookieParser.create({ secure: 'auto' });
      const jar = new CookieJar(parser, '');
      jar.set('session', 'v');

      const httpsHeaders = await jar.getSetCookieHeaders({ isSecure: true });
      expect(httpsHeaders[0]).toContain('Secure');

      const httpHeaders = await jar.getSetCookieHeaders({ isSecure: false });
      expect(httpHeaders[0]).not.toContain('Secure');
    });

    it('should handle multiple set and delete in correct order', async () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, '');
      jar.set('a', '1');
      jar.set('b', '2');
      jar.delete('c');
      const headers = await jar.getSetCookieHeaders();
      expect(headers).toHaveLength(3);
    });

    it('serializes each cookie independently — a cookie unsettable on this channel does not drop the others', async () => {
      // secure:'auto' leaves Secure unresolved at set(); SameSite=None only becomes invalid once the
      // channel resolves insecure at flush. That channel-dependent failure skips just that cookie.
      const parser = CookieParser.create({ secure: 'auto' });
      const jar = new CookieJar(parser, '');
      jar.set('good', 'ok');
      jar.set('bad', 'v', { sameSite: SameSite.None });
      const headers = await jar.getSetCookieHeaders({ isSecure: false });
      // POSITIVE: the good cookie's full line is emitted; only the one channel-unsettable cookie is
      // dropped, so exactly 1 (the settable count) header is produced — a regression that drops
      // everything would fail this length check.
      expect(headers).toHaveLength(1);
      expect(headers.some((h) => h.startsWith('good=ok'))).toBe(true);
      expect(headers.some((h) => h.startsWith('bad='))).toBe(false);
    });
  });

  describe('delete with cookie prefixes (RFC 6265bis §4.1.3)', () => {
    it('should expire a __Host- cookie under default options with Secure and Path=/', async () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, '');
      jar.delete('__Host-sess');
      const headers = await jar.getSetCookieHeaders();
      expect(headers).toHaveLength(1);
      expect(headers[0]).toContain('__Host-sess=');
      expect(headers[0]).toContain('Secure');
      expect(headers[0]).toContain('Path=/');
      expect(headers[0]).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
      expect(headers[0]).not.toContain('Max-Age=0');
    });

    it('should expire a __Secure- cookie under default options with Secure', async () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, '');
      jar.delete('__Secure-sess');
      const headers = await jar.getSetCookieHeaders();
      expect(headers[0]).toContain('__Secure-sess=');
      expect(headers[0]).toContain('Secure');
      expect(headers[0]).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
      expect(headers[0]).not.toContain('Max-Age=0');
    });

    it('should not emit a Domain on a __Host- deletion even when the parser default sets one', async () => {
      const parser = CookieParser.create({ domain: 'example.com' });
      const jar = new CookieJar(parser, '');
      jar.delete('__Host-sess');
      const headers = await jar.getSetCookieHeaders();
      expect(headers[0]).not.toContain('Domain');
    });

    it('should carry the parser default Domain on a non-prefixed deletion (deletion must match)', async () => {
      const parser = CookieParser.create({ domain: 'example.com' });
      const jar = new CookieJar(parser, '');
      jar.delete('sess');
      const headers = await jar.getSetCookieHeaders();
      expect(headers[0]).toContain('Domain=example.com');
    });

    it('should expire a plain cookie without forcing Secure under default options', async () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, '');
      jar.delete('plain');
      const headers = await jar.getSetCookieHeaders();
      expect(headers[0]).toContain('plain=');
      expect(headers[0]).not.toContain('Secure');
      expect(headers[0]).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
      expect(headers[0]).not.toContain('Max-Age=0');
    });

    it('mirrors set() under secure:auto — a SameSite=None deletion defers Secure to flush, not rejected', () => {
      const parser = CookieParser.create({ secure: 'auto' });
      const jar = new CookieJar(parser, '');
      // set() of this cookie succeeds (Secure deferred to flush); delete() must too, or a cross-site
      // cookie set under secure:'auto' could never be expired.
      expectOk(jar.set('sid', 'v', { sameSite: SameSite.None }));
      expectOk(jar.delete('sid', { sameSite: SameSite.None }));
    });

    it('should reject an explicit secure:false on a __Host- deletion at delete() time', () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, '');
      // An explicit secure:false is a static contradiction (Secure is known, not channel-deferred), so
      // it surfaces as an Err at the delete() boundary where the caller can act — not silently at flush.
      expect(asErr(jar.delete('__Host-sess', { secure: false })).data.reason).toBe(CookieErrorReason.HostPrefixRequiresSecure);
    });
  });

  describe('inbound U+FFFD disambiguation', () => {
    it('should keep a cookie whose value is a legitimately percent-encoded U+FFFD', () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, 's=%EF%BF%BD');
      expect(jar.has('s')).toBe(true);
      expect(jar.getRaw('s')).toBe('�');
    });

    it('keeps a legit percent-encoded U+FFFD value even when the cookie name is itself percent-encoded', () => {
      // The raw wire name `n%41` decodes to `nA`; the value `%EF%BF%BD` is a genuine U+FFFD, not Bun's
      // silent-corruption marker. The raw-segment lookup must key by the decoded name to see that.
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, 'n%41=%EF%BF%BD');
      expect(jar.has('nA')).toBe(true);
      expect(jar.getRaw('nA')).toBe('�');
    });

    it('round-trips a U+FFFD-bearing value through encryption and back via jar.get (decode path)', async () => {
      const parser = CookieParser.create({ encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      const { Cookie } = await import('bun');
      const plaintext = 'pre�post'; // value legitimately containing U+FFFD
      const encrypted = expectOk(await parser.encrypt(new Cookie('s', plaintext)));
      // The encrypted wire value is base64url (no raw U+FFFD), so it survives Bun.CookieMap parsing,
      // and jar.get must exercise the full decrypt -> decode path back to the original plaintext.
      const jar = new CookieJar(parser, `s=${encrypted.value}`);
      const result = await jar.get('s');
      expect(result).toBe(plaintext);
    });

    it('should drop a malformed-percent-encoding cookie while keeping a sibling legit U+FFFD', () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, 'legit=%EF%BF%BD; bad=%XX; good=ok');
      expect(jar.has('legit')).toBe(true);
      expect(jar.getRaw('good')).toBe('ok');
      expect(jar.has('bad')).toBe(false);
    });

    it('must not let a malformed same-name duplicate corrupt the valid value', () => {
      const parser = CookieParser.create();
      expect(new CookieJar(parser, 'sid=valid123; sid=%ff').getRaw('sid')).toBe('valid123');
    });

    it('keeps the valid value even when the malformed duplicate comes first', () => {
      const parser = CookieParser.create();
      expect(new CookieJar(parser, 'sid=%ff; sid=valid123').getRaw('sid')).toBe('valid123');
    });

    it('keeps a legit %EF%BF%BD duplicate when an earlier malformed duplicate also decodes to U+FFFD', () => {
      // Both occurrences decode to a value containing U+FFFD: the first ('bad%ZZ') is silent corruption,
      // the second ('%EF%BF%BD') is a genuine U+FFFD. The raw lookup must consult the SECOND occurrence's
      // raw, not the first, or the legit value is wrongly dropped.
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, 'sid=bad%ZZ; sid=%EF%BF%BD; good=ok');
      expect(jar.has('sid')).toBe(true);
      expect(jar.getRaw('sid')).toBe('�');
      expect(jar.getRaw('good')).toBe('ok');
    });

    it('resolves duplicate valid cookies first-occurrence-wins (parity with Bun.CookieMap.get)', () => {
      const parser = CookieParser.create();
      expect(new CookieJar(parser, 'a=1; a=2').getRaw('a')).toBe('1');
    });
  });

  // Pins the Bun.CookieMap behaviors this package's correctness depends on. If a Bun upgrade changes
  // them these fail loudly, signalling the round-trip assumptions (esp. the '%'-exclusion from emitted
  // names) must be revisited.
  describe('Bun runtime behavior pins — inbound percent-decode', () => {
    it('percent-decodes inbound cookie NAMES (why emitted names stay %-free to round-trip)', () => {
      const jar = new CookieJar(CookieParser.create(), 'n%41=1');
      expect(jar.getRaw('nA')).toBe('1');        // 'n%41' is decoded to the key 'nA'
      expect(jar.getRaw('n%41')).toBeUndefined();
    });

    it('percent-decodes inbound cookie VALUES', () => {
      const jar = new CookieJar(CookieParser.create(), 'a=%C3%A9');
      expect(jar.getRaw('a')).toBe('é');
    });
  });
});
