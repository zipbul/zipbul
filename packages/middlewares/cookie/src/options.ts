import { DEFAULT_KDF_SALT, DEFAULT_MAX_INBOUND_COOKIE_BYTES } from './constants';
import { SigningAlgorithm } from './enums';
import type { CookieParserOptions } from './interfaces';
import { normalizeExpires } from './cookie-validators';
import type { ResolvedCookieDefaults, ResolvedCookieParserOptions } from './types';

// Option validation lives in cookie-options.ts (baker schema, run at CookieParser.create). This module
// only resolves the user's options into the fully-defaulted shape the parser holds; it assumes the
// input already passed boot validation, so it performs no validation of its own.
export function resolveCookieParserOptions(options?: CookieParserOptions): ResolvedCookieParserOptions {
  const defaults: ResolvedCookieDefaults = {
    httpOnly: options?.httpOnly ?? null,
    secure: options?.secure ?? null,
    sameSite: options?.sameSite ?? null,
    path: options?.path ?? null,
    domain: options?.domain ?? null,
    maxAge: options?.maxAge ?? null,
    // number (JS ms) -> Date here so the default never reaches Bun.Cookie as a bare number (seconds).
    expires: options?.expires != null ? normalizeExpires(options.expires) : null,
    partitioned: options?.partitioned ?? null,
    priority: options?.priority ?? null,
  };

  const encryptionSecrets = options?.encryptionSecret == null
    ? null
    : Array.isArray(options.encryptionSecret)
      ? options.encryptionSecret
      : [options.encryptionSecret];

  let kdfSalt: Uint8Array<ArrayBuffer> = DEFAULT_KDF_SALT;
  if (options?.kdfSalt !== undefined) {
    kdfSalt = typeof options.kdfSalt === 'string'
      ? new TextEncoder().encode(options.kdfSalt)
      : new Uint8Array(options.kdfSalt);
  }

  return {
    secrets: options?.secrets ?? null,
    algorithm: options?.algorithm ?? SigningAlgorithm.Sha256,
    encryptionSecrets,
    prefixValidation: options?.prefixValidation ?? true,
    kdfSalt,
    maxInboundCookieBytes: options?.maxInboundCookieBytes ?? DEFAULT_MAX_INBOUND_COOKIE_BYTES,
    defaults,
  };
}
