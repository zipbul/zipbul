import { describe, expect, it } from 'bun:test';

import { SameSite, SigningAlgorithm } from './enums';
import { resolveCookieParserOptions } from './options';

const VALID_SECRET = 'zt3oaxqd6dOCT4bNxEsuMoLxbpCnfOyiWBwS4vBWzxM';
const VALID_ENC_SECRET = '5qly1QnPB1M6tT3thbFxuaY6A7OXv2zS8_O3VTHTAQ8';

describe('resolveCookieParserOptions', () => {
  it('should return all defaults when no options provided', () => {
    const resolved = resolveCookieParserOptions();
    expect(resolved.secrets).toBeNull();
    expect(resolved.algorithm).toBe(SigningAlgorithm.Sha256);
    expect(resolved.encryptionSecrets).toBeNull();
    expect(resolved.prefixValidation).toBe(true);
    expect(resolved.maxInboundCookieBytes).toBe(16384);
    expect(resolved.defaults.httpOnly).toBeNull();
    expect(resolved.defaults.secure).toBeNull();
    expect(resolved.defaults.sameSite).toBeNull();
    expect(resolved.defaults.path).toBeNull();
    expect(resolved.defaults.domain).toBeNull();
    expect(resolved.defaults.maxAge).toBeNull();
    expect(resolved.defaults.expires).toBeNull();
    expect(resolved.defaults.partitioned).toBeNull();
  });

  it('should return all defaults when empty options provided', () => {
    const resolved = resolveCookieParserOptions({});
    expect(resolved.secrets).toBeNull();
    expect(resolved.algorithm).toBe(SigningAlgorithm.Sha256);
    expect(resolved.prefixValidation).toBe(true);
  });

  it('should resolve secrets when provided', () => {
    const resolved = resolveCookieParserOptions({ secrets: [VALID_SECRET, VALID_SECRET + '_alt'] });
    expect(resolved.secrets).toEqual([VALID_SECRET, VALID_SECRET + '_alt']);
  });

  it('should resolve algorithm when provided', () => {
    const resolved = resolveCookieParserOptions({ algorithm: SigningAlgorithm.Sha512 });
    expect(resolved.algorithm).toBe(SigningAlgorithm.Sha512);
  });

  it('should normalize encryptionSecret single string into array', () => {
    const resolved = resolveCookieParserOptions({ encryptionSecret: VALID_ENC_SECRET });
    expect(resolved.encryptionSecrets).toEqual([VALID_ENC_SECRET]);
  });

  it('should pass encryptionSecret array through unchanged', () => {
    const resolved = resolveCookieParserOptions({ encryptionSecret: [VALID_ENC_SECRET, VALID_ENC_SECRET + '_alt'] });
    expect(resolved.encryptionSecrets).toEqual([VALID_ENC_SECRET, VALID_ENC_SECRET + '_alt']);
  });

  it('should resolve prefixValidation when provided', () => {
    const resolved = resolveCookieParserOptions({ prefixValidation: true });
    expect(resolved.prefixValidation).toBe(true);
  });

  it('should resolve cookie defaults when provided', () => {
    const resolved = resolveCookieParserOptions({
      httpOnly: true,
      secure: true,
      sameSite: SameSite.Strict,
      path: '/',
      domain: 'example.com',
      maxAge: 3600,
      expires: 1000,
      partitioned: true,
    });
    expect(resolved.defaults.httpOnly).toBe(true);
    expect(resolved.defaults.secure).toBe(true);
    expect(resolved.defaults.sameSite).toBe(SameSite.Strict);
    expect(resolved.defaults.path).toBe('/');
    expect(resolved.defaults.domain).toBe('example.com');
    expect(resolved.defaults.maxAge).toBe(3600);
    // A numeric (JS ms) expires is normalized to a Date at resolve time so Bun never reads it as seconds.
    expect(resolved.defaults.expires).toEqual(new Date(1000));
    expect(resolved.defaults.partitioned).toBe(true);
  });

  it('should resolve secure auto when provided', () => {
    const resolved = resolveCookieParserOptions({ secure: 'auto' });
    expect(resolved.defaults.secure).toBe('auto');
  });
});

describe('kdfSalt option (RFC 5869 §3.1)', () => {
  it('uses default salt when omitted', () => {
    const r = resolveCookieParserOptions();
    expect(r.kdfSalt).toBeInstanceOf(Uint8Array);
    expect(r.kdfSalt.length).toBeGreaterThanOrEqual(16);
  });
  it('accepts string salt', () => {
    const r = resolveCookieParserOptions({ kdfSalt: 'my-deployment-salt-2026__padding' });
    expect(new TextDecoder().decode(r.kdfSalt)).toBe('my-deployment-salt-2026__padding');
  });
  it('accepts Uint8Array salt (defensively copied)', () => {
    const bytes = new Uint8Array(20).fill(7);
    const r = resolveCookieParserOptions({ kdfSalt: bytes });
    expect(r.kdfSalt).toEqual(bytes);
    expect(r.kdfSalt).not.toBe(bytes);
  });
});
