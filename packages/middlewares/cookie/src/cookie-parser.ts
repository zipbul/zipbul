import { Cookie } from 'bun';
import { err, isErr } from '@zipbul/result';
import type { Result, ResultAsync } from '@zipbul/result';

import { CookieErrorReason, CookiePriority, SameSite } from './enums';
import { type CookieAttributes, type CookieErrorData, type CookieParserOptions, type SerializeContext } from './interfaces';
import { resolveCookieParserOptions } from './options';
import { validateCookieOptionsAtBoot } from './cookie-options';
import { isValidCookieName, isValidDomain, isValidExpires, isValidMaxAge, isValidPath, normalizeExpires } from './cookie-validators';
import {
  bufferFromB64Url,
  bufferToB64Url,
  constantTimeEqual,
  deriveAesKey,
  deriveHmacKeyBytesSync,
} from './cookie-crypto';
import {
  AUTH_TAG_BITS,
  IV_LENGTH,
  KID_LENGTH,
  MAX_ATTRIBUTE_OCTETS,
  MAX_HEADER_OCTETS,
  MAX_NAME_VALUE_OCTETS,
  MIN_CIPHERTEXT_LENGTH,
  NAME_VALUE_SEPARATOR,
} from './constants';
import type { ResolvedCookieParserOptions } from './types';

// The full set of CookieAttributes keys, used to detect which attributes a caller passed
// explicitly. `satisfies` validates every entry against the interface, and the compile-time
// exhaustiveness statement below fails to build if a new attribute is added without being listed
// here — so a new attribute can never silently skip explicit-attribute tracking.
const COOKIE_ATTRIBUTE_KEYS = [
  'domain', 'path', 'secure', 'httpOnly', 'sameSite',
  'maxAge', 'expires', 'partitioned', 'priority',
] as const satisfies readonly (keyof CookieAttributes)[];
true satisfies [Exclude<keyof CookieAttributes, (typeof COOKIE_ATTRIBUTE_KEYS)[number]>] extends [never] ? true : false;

function isCookiePriority(value: string): value is CookiePriority {
  return value === CookiePriority.Low || value === CookiePriority.Medium || value === CookiePriority.High;
}

function isSameSite(value: string): value is SameSite {
  return value === SameSite.Strict || value === SameSite.Lax || value === SameSite.None;
}

const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder();

interface CookieMeta {
  explicit: Set<keyof CookieAttributes>;
  priority?: CookiePriority;
}

export class CookieParser {
  private readonly meta = new WeakMap<Cookie, CookieMeta>();
  private readonly aesKeyPromises: Promise<{ key: CryptoKey; kid: Uint8Array }>[];
  private readonly hmacKeys: { keyBytes: Uint8Array; kid: Uint8Array }[];

  private constructor(private readonly options: ResolvedCookieParserOptions) {
    // HMAC keys + their KIDs are derived ONCE here (sync HKDF via Bun.CryptoHasher) and reused by every
    // sign()/unsign(); the inputs (secret, salt, algorithm) are fixed for the parser's lifetime, so
    // re-deriving per call would be wasted work. AES-GCM keys need async crypto.subtle import.
    this.hmacKeys = options.secrets !== null
      ? options.secrets.map((s) => this.deriveHmacSync(s))
      : [];
    this.aesKeyPromises = options.encryptionSecrets !== null
      ? options.encryptionSecrets.map((s) => deriveAesKey(s, options.kdfSalt))
      : [];
  }

  public static create(options?: CookieParserOptions): CookieParser {
    // Boot validation: misconfigured options are a programmer error and throw here (same failure on
    // every request), before resolve normalizes them. Runtime/per-cookie failures stay Result-typed.
    validateCookieOptionsAtBoot(options ?? {});
    return new CookieParser(resolveCookieParserOptions(options));
  }

  public get isSigningConfigured(): boolean {
    return this.options.secrets !== null;
  }

  public get isEncryptionConfigured(): boolean {
    return this.options.encryptionSecrets !== null;
  }

  /** Maximum byte length of an inbound `Cookie` header the {@link CookieJar} will parse. */
  public get maxInboundCookieBytes(): number {
    return this.options.maxInboundCookieBytes;
  }

  public createCookie(name: string, value: string, options?: CookieAttributes): Result<Cookie, CookieErrorData> {
    const sizeErr = this.checkValidName(name) ?? this.checkNameValueSize(name, value);
    if (sizeErr !== undefined) {return err(sizeErr);}

    const explicit = new Set<keyof CookieAttributes>();
    if (options) {
      for (const k of COOKIE_ATTRIBUTE_KEYS) {
        if (options[k] !== undefined) {explicit.add(k);}
      }
    }

    const merged = this.mergeAttributes(name, options);
    if (isErr(merged)) {return merged;}

    const attrErr =
      (merged.maxAge != null ? this.checkValidMaxAge(merged.maxAge) : undefined)
      ?? (merged.expires != null ? this.checkValidExpires(merged.expires) : undefined)
      ?? (merged.domain != null ? this.checkValidDomain(merged.domain) : undefined)
      ?? (merged.path != null ? this.checkValidPath(merged.path) : undefined)
      ?? (merged.sameSite != null ? this.checkValidSameSite(merged.sameSite) : undefined)
      ?? (merged.priority != null ? this.checkValidPriority(merged.priority) : undefined)
      ?? this.checkAttributeSizes(merged);
    if (attrErr !== undefined) {return err(attrErr);}

    // Priority is a CookieAttributes field but not a Bun.Cookie constructor option; omit it via a
    // typed destructure (no Record widening) and re-attach it through `meta` below.
    const { priority, ...bunOpts } = merged;

    // Every attribute Bun.Cookie can reject (name, domain, path, expires, sameSite) is validated above,
    // and a value is always percent-encoded (never rejected), so construction cannot throw here.
    const cookie = new Cookie(name, value, bunOpts);

    this.meta.set(cookie, priority !== undefined ? { explicit, priority } : { explicit });

    // Static cross-field validation surfaces at the boundary (set()/delete()), NOT deferred to flush —
    // EXCEPT when `secure` is still unresolved because of a `secure:'auto'` default. In that one case
    // the Secure-coupled rules genuinely depend on the request channel and are checked at serialize().
    const secureDeferred = this.options.defaults.secure === 'auto' && !explicit.has('secure');
    if (!secureDeferred) {
      const crossErr = this.checkCrossField(cookie);
      if (crossErr !== undefined) {return err(crossErr);}
      if (this.options.prefixValidation) {
        const prefixErr = this.validatePrefix(cookie);
        if (isErr(prefixErr)) {return prefixErr;}
      }
    }
    return cookie;
  }

  private checkCrossField(cookie: Cookie): CookieErrorData | undefined {
    if (cookie.sameSite === 'none' && !cookie.secure) {
      return { reason: CookieErrorReason.SameSiteNoneRequiresSecure, message: 'SameSite=None cookies must have the Secure attribute' };
    }
    if (cookie.partitioned && !cookie.secure) {
      return { reason: CookieErrorReason.PartitionedRequiresSecure, message: 'Partitioned cookies must have the Secure attribute' };
    }
    return undefined;
  }

  public serialize(cookie: Cookie, context?: SerializeContext): Result<string, CookieErrorData> {
    const preErr = this.checkValidName(cookie.name) ?? this.checkNameValueSize(cookie.name, cookie.value);
    if (preErr !== undefined) {return err(preErr);}

    const meta = this.meta.get(cookie);
    const explicit = meta?.explicit ?? new Set<keyof CookieAttributes>();
    const { defaults } = this.options;

    const target = this.applyDefaultsForSerialize(cookie, explicit, context);
    if (isErr(target)) {return target;}

    const crossErr = this.checkCrossField(target);
    if (crossErr !== undefined) {return err(crossErr);}
    const targetErr =
      (target.maxAge != null ? this.checkValidMaxAge(target.maxAge) : undefined)
      ?? (target.domain != null ? this.checkValidDomain(target.domain) : undefined)
      ?? (target.path != null ? this.checkValidPath(target.path) : undefined)
      // The per-attribute 1024-octet cap also applies on the serialize path (a raw Cookie passed
      // straight to serialize() never went through createCookie's check).
      ?? this.checkAttributeSizes({
        ...(target.domain != null && { domain: target.domain }),
        ...(target.path != null && { path: target.path }),
      });
    if (targetErr !== undefined) {return err(targetErr);}

    if (this.options.prefixValidation) {
      const prefixErr = this.validatePrefix(target);
      if (isErr(prefixErr)) {return prefixErr;}
    }

    // Bun.Cookie emits a non-conformant Expires ("Fri, 1 Jan 1970 00:00:00 -0000" — 1-digit day, a
    // "-0000" zone) instead of an RFC 7231 §7.1.1.1 IMF-fixdate. Rather than rewrite Bun's output
    // string (which cannot distinguish the leading `name=value` pair from an `Expires=` attribute and
    // would corrupt a cookie literally named "expires"), serialize a copy that omits Expires and append
    // the canonical value ourselves. `target.expires` is always a Date once the cookie is constructed
    // (Bun rejects non-finite/invalid at construction), so toUTCString() is always valid, and attribute
    // order is not significant (RFC 6265bis §5.4 / §4.1.1) so appending Expires last is conformant.
    // `target` is a fully-validated Cookie (its attributes already passed Bun construction and this
    // method's checks), so re-constructing the Expires-less copy below cannot throw.
    let header: string;
    if (target.expires == null) {
      header = target.serialize();
    } else {
      const base = new Cookie(target.name, target.value, {
        ...(target.domain != null && { domain: target.domain }),
        ...(target.path != null && { path: target.path }),
        secure: target.secure,
        httpOnly: target.httpOnly,
        ...(target.sameSite != null && { sameSite: target.sameSite }),
        ...(target.maxAge != null && { maxAge: target.maxAge }),
        partitioned: target.partitioned,
      });
      header = `${base.serialize()}; Expires=${new Date(target.expires).toUTCString()}`;
    }

    const priority = meta?.priority ?? (defaults.priority ?? null);
    if (priority !== null) {
      const cap = priority.charAt(0).toUpperCase() + priority.slice(1);
      header = `${header}; Priority=${cap}`;
    }

    if (Buffer.byteLength(header, 'utf8') > MAX_HEADER_OCTETS) {
      return err<CookieErrorData>({
        reason: CookieErrorReason.CookieTooLarge,
        message: `serialized cookie exceeds ${MAX_HEADER_OCTETS} bytes`,
      });
    }

    return header;
  }

  public sign(cookie: Cookie): Result<Cookie, CookieErrorData> {
    if (this.options.secrets === null) {
      return err<CookieErrorData>({
        reason: CookieErrorReason.SigningNotConfigured,
        message: 'signing requires secrets to be configured',
      });
    }
    const nameErr = this.checkValidName(cookie.name);
    if (nameErr !== undefined) {return err(nameErr);}

    const data = utf8.encode(cookie.name + NAME_VALUE_SEPARATOR + cookie.value);
    const signed = this.signSync(data);
    return this.cloneWithValue(cookie, `${cookie.value}.${signed}`);
  }

  public async unsign(cookie: Cookie): ResultAsync<Cookie, CookieErrorData> {
    if (this.options.secrets === null) {
      return err<CookieErrorData>({
        reason: CookieErrorReason.SigningNotConfigured,
        message: 'unsigning requires secrets to be configured',
      });
    }
    const nameErr = this.checkValidName(cookie.name);
    if (nameErr !== undefined) {return err(nameErr);}

    const dotIndex = cookie.value.lastIndexOf('.');
    if (dotIndex === -1) {
      return err<CookieErrorData>({
        reason: CookieErrorReason.InvalidSignature,
        message: 'signed cookie value must contain a dot separator',
      });
    }

    const value = cookie.value.slice(0, dotIndex);
    const signature = cookie.value.slice(dotIndex + 1);
    let sigBlob: Uint8Array<ArrayBuffer>;
    try {
      sigBlob = bufferFromB64Url(signature);
    } catch {
      return err<CookieErrorData>({
        reason: CookieErrorReason.SignatureVerificationFailed,
        message: 'cookie signature verification failed',
      });
    }
    if (sigBlob.length < KID_LENGTH + 1) {
      return err<CookieErrorData>({
        reason: CookieErrorReason.SignatureVerificationFailed,
        message: 'cookie signature verification failed',
      });
    }

    const sigKid = sigBlob.subarray(0, KID_LENGTH);
    const macBytes = sigBlob.subarray(KID_LENGTH);
    const dataBytes = utf8.encode(cookie.name + NAME_VALUE_SEPARATOR + value);

    // Strict KID matching: a cookie's signature MUST identify a configured key by its KID. We iterate
    // every configured key (constant-time over the key set), never short-circuiting, to avoid leaking
    // which slot matched. The HMAC is recomputed synchronously with Bun.CryptoHasher — bit-identical to
    // the crypto.subtle HMAC sign() uses — so no async WebCrypto round-trip is needed on the hot path.
    let valid = false;
    for (const { keyBytes, kid } of this.hmacKeys) {
      const hasher = new Bun.CryptoHasher(this.options.algorithm, keyBytes);
      hasher.update(dataBytes);
      const expectedMac = new Uint8Array(hasher.digest());
      const kidMatches = constantTimeEqual(sigKid, kid);
      const ok = constantTimeEqual(macBytes, expectedMac);
      valid = valid || (kidMatches && ok);
    }

    if (valid) {
      return this.cloneWithValue(cookie, value);
    }

    return err<CookieErrorData>({
      reason: CookieErrorReason.SignatureVerificationFailed,
      message: 'cookie signature verification failed',
    });
  }

  public async encrypt(cookie: Cookie): ResultAsync<Cookie, CookieErrorData> {
    if (this.options.encryptionSecrets === null) {
      return err<CookieErrorData>({
        reason: CookieErrorReason.EncryptionNotConfigured,
        message: 'encryption requires encryptionSecret to be configured',
      });
    }
    const nameErr = this.checkValidName(cookie.name);
    if (nameErr !== undefined) {return err(nameErr);}

    // AES-GCM with a random 96-bit IV: the practical uniqueness guarantee is the IV birthday bound;
    // NIST SP 800-38D §8.3 recommends rotating the key well before 2^32 encryptions. That bound is
    // PER KEY across the whole fleet — not observable from one process — so the only honest control is
    // operator key rotation on a schedule. No in-process counter is kept (it could not enforce the
    // fleet-wide bound and would only simulate protection).
    const { key, kid } = await this.aesKeyPromises[0]!;
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const aad = utf8.encode(cookie.name);

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad, tagLength: AUTH_TAG_BITS },
      key,
      utf8.encode(cookie.value),
    );

    const ctBytes = new Uint8Array(ciphertext);
    const combined = new Uint8Array(KID_LENGTH + IV_LENGTH + ctBytes.length);
    combined.set(kid, 0);
    combined.set(iv, KID_LENGTH);
    combined.set(ctBytes, KID_LENGTH + IV_LENGTH);

    return this.cloneWithValue(cookie, bufferToB64Url(combined));
  }

  public async decrypt(cookie: Cookie): ResultAsync<Cookie, CookieErrorData> {
    if (this.options.encryptionSecrets === null) {
      return err<CookieErrorData>({
        reason: CookieErrorReason.EncryptionNotConfigured,
        message: 'decryption requires encryptionSecret to be configured',
      });
    }
    const nameErr = this.checkValidName(cookie.name);
    if (nameErr !== undefined) {return err(nameErr);}

    let combined: Uint8Array<ArrayBuffer>;
    try {
      combined = bufferFromB64Url(cookie.value);
    } catch {
      return err<CookieErrorData>({
        reason: CookieErrorReason.InvalidCiphertext,
        message: 'ciphertext is not valid base64url',
      });
    }
    if (combined.length < MIN_CIPHERTEXT_LENGTH) {
      return err<CookieErrorData>({
        reason: CookieErrorReason.InvalidCiphertext,
        message: 'ciphertext is too short to be valid',
      });
    }

    const ctKid = combined.subarray(0, KID_LENGTH);
    const iv = combined.subarray(KID_LENGTH, KID_LENGTH + IV_LENGTH);
    const ct = combined.subarray(KID_LENGTH + IV_LENGTH);
    const aad = utf8.encode(cookie.name);

    // KID-strict: the ciphertext's KID MUST identify a configured key, mirroring unsign()'s policy. A
    // forged or corrupted KID matches nothing and is rejected outright — we never trial-decrypt with
    // unrelated keys, which would drop the KID binding and amplify each read to N decrypt attempts.
    // Legitimate rotation is unaffected: the active key's KID is always present in the configured set.
    const matchedKeys: CryptoKey[] = [];
    for (const entry of this.aesKeyPromises) {
      const { key, kid } = await entry;
      if (constantTimeEqual(ctKid, kid)) {matchedKeys.push(key);}
    }

    for (const key of matchedKeys) {
      try {
        const plaintext = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv, additionalData: aad, tagLength: AUTH_TAG_BITS },
          key,
          ct,
        );
        return this.cloneWithValue(cookie, utf8Decoder.decode(plaintext));
      } catch { /* try next */ }
    }

    return err<CookieErrorData>({
      reason: CookieErrorReason.DecryptionFailed,
      message: 'cookie decryption failed',
    });
  }

  public validatePrefix(cookie: Cookie): Result<void, CookieErrorData> {
    const nameErr = this.checkValidName(cookie.name);
    if (nameErr !== undefined) {return err(nameErr);}
    const lower = cookie.name.toLowerCase();

    if (lower.startsWith('__host-')) {
      if (!cookie.secure) {
        return err<CookieErrorData>({
          reason: CookieErrorReason.HostPrefixRequiresSecure,
          message: '__Host- cookies must have the Secure attribute',
        });
      }
      if (cookie.domain != null && cookie.domain !== '') {
        return err<CookieErrorData>({
          reason: CookieErrorReason.HostPrefixForbidsDomain,
          message: '__Host- cookies must not have a Domain attribute',
        });
      }
      if (cookie.path !== '/') {
        return err<CookieErrorData>({
          reason: CookieErrorReason.HostPrefixRequiresRootPath,
          message: '__Host- cookies must have Path=/',
        });
      }
      return undefined;
    }

    if (lower.startsWith('__secure-')) {
      if (!cookie.secure) {
        return err<CookieErrorData>({
          reason: CookieErrorReason.SecurePrefixRequiresSecure,
          message: '__Secure- cookies must have the Secure attribute',
        });
      }
    }
    return undefined;
  }

  // --- internals ---

  private mergeAttributes(name: string, options?: CookieAttributes): Result<CookieAttributes, CookieErrorData> {
    const { defaults } = this.options;
    const merged: CookieAttributes = {};

    // A __Host- cookie is structurally host-only: RFC 6265bis §4.1.3.2 forbids a Domain attribute and
    // mandates Path=/. A parser-level default Domain or default Path therefore must not be applied to a
    // __Host- name — either would make every __Host- cookie unserializable under prefixValidation (a
    // default Domain is forbidden outright; a default Path other than '/' fails HostPrefixRequiresRootPath).
    // Suppressing both lets Bun's own Path='/' default stand, which is exactly what __Host- requires. An
    // EXPLICIT Domain/Path passed for a __Host- cookie still flows through the options merge below and is
    // rejected by validatePrefix — only the inapplicable defaults are suppressed here.
    const isHostPrefix = name.toLowerCase().startsWith('__host-');

    // Max-Age and Expires are alternative lifetime mechanisms, and Max-Age takes precedence when both are
    // present (RFC 6265bis §5.4.2). So an EXPLICIT expires must suppress the default Max-Age (otherwise the
    // default would silently override the caller's Expires — and turn delete()'s past-Expires into a
    // renewal), and an explicit maxAge must suppress the default Expires (which would otherwise ride along
    // as a dead, misleading attribute). Whichever lifetime the caller names wins outright.
    const hasExplicitMaxAge = options?.maxAge != null;
    const hasExplicitExpires = options?.expires != null;

    if (defaults.httpOnly !== null) {merged.httpOnly = defaults.httpOnly;}
    if (defaults.secure !== null && defaults.secure !== 'auto') {merged.secure = defaults.secure;}
    if (defaults.sameSite !== null) {merged.sameSite = defaults.sameSite;}
    if (defaults.path !== null && !isHostPrefix) {merged.path = defaults.path;}
    if (defaults.domain !== null && !isHostPrefix) {merged.domain = defaults.domain;}
    if (defaults.maxAge !== null && !hasExplicitExpires) {merged.maxAge = defaults.maxAge;}
    if (defaults.expires !== null && !hasExplicitMaxAge) {merged.expires = defaults.expires;}
    if (defaults.partitioned !== null) {merged.partitioned = defaults.partitioned;}
    if (defaults.priority !== null) {merged.priority = defaults.priority;}

    // Explicit per-field overrides (typed, no dynamic-key widening). A nullish option leaves the
    // parser default in place; a present option wins.
    if (options) {
      if (options.httpOnly != null) {merged.httpOnly = options.httpOnly;}
      if (options.secure != null) {merged.secure = options.secure;}
      if (options.sameSite != null) {merged.sameSite = options.sameSite;}
      if (options.path != null) {merged.path = options.path;}
      if (options.domain != null) {merged.domain = options.domain;}
      if (options.maxAge != null) {merged.maxAge = options.maxAge;}
      // number (JS ms) -> Date so the explicit per-cookie expires is never handed to Bun as seconds.
      if (options.expires != null) {merged.expires = normalizeExpires(options.expires);}
      if (options.partitioned != null) {merged.partitioned = options.partitioned;}
      if (options.priority != null) {merged.priority = options.priority;}
    }

    return merged;
  }

  // Single source of truth for overlaying the parser's Domain/Max-Age/Expires defaults onto an already-
  // constructed Cookie — shared by applyDefaultsForSerialize (the serialize path) and cloneWithValue (the
  // sign/encrypt path) so the two coupling rules below can never drift apart between them (a past
  // divergence shipped three separate bugs). A value already on the cookie always wins over a default.
  //   - __Host- forbids a Domain (RFC 6265bis §4.1.3.2), so a default Domain is never overlaid onto one.
  //   - Max-Age and Expires are alternative lifetimes and Max-Age wins when both are set (§5.4.2), so a
  //     default of one is never overlaid onto a cookie that already carries the other.
  // The returned values mirror the cookie's own getter types and reuse the cookie's references when no
  // default applies, so callers can spread them directly and compare by identity to skip a needless rebuild.
  private overlayDefaultLifetime(cookie: Cookie) {
    const { defaults } = this.options;
    const isHostPrefix = cookie.name.toLowerCase().startsWith('__host-');
    return {
      domain: cookie.domain ?? (isHostPrefix ? null : defaults.domain),
      maxAge: cookie.maxAge ?? (cookie.expires != null ? undefined : defaults.maxAge ?? undefined),
      expires: cookie.expires ?? (cookie.maxAge != null ? undefined : defaults.expires ?? undefined),
    };
  }

  private applyDefaultsForSerialize(
    cookie: Cookie,
    explicit: Set<keyof CookieAttributes>,
    context?: SerializeContext,
  ): Result<Cookie, CookieErrorData> {
    const { defaults } = this.options;

    let resolvedSecure: boolean | undefined = undefined;
    if (defaults.secure === 'auto' && !explicit.has('secure')) {
      // 'auto' is a security feature; require an explicit channel signal so we never silently
      // emit an insecure cookie that the caller intended to be Secure.
      if (context === undefined || context.isSecure === undefined) {
        return err<CookieErrorData>({
          reason: CookieErrorReason.InvalidAttribute,
          message: "secure: 'auto' requires SerializeContext.isSecure to be passed (true for HTTPS, false for plain HTTP)",
        });
      }
      resolvedSecure = context.isSecure;
    }

    const { domain, maxAge, expires } = this.overlayDefaultLifetime(cookie);
    const applySecure = resolvedSecure !== undefined;

    // The common createCookie path already baked the parser defaults into the cookie, so the overlay
    // returns the cookie's own values by identity — rebuild only when a default actually changes one of
    // them, or when a deferred secure:'auto' has to be resolved onto the wire copy.
    if (domain === cookie.domain && maxAge === cookie.maxAge && expires === cookie.expires && !applySecure) {
      return cookie;
    }

    // The applied defaults are boot-validated and `cookie` is already a valid Cookie, so this cannot throw.
    return new Cookie(cookie.name, cookie.value, {
      ...(domain != null && { domain }),
      ...(cookie.path != null && { path: cookie.path }),
      secure: applySecure ? resolvedSecure! : cookie.secure,
      httpOnly: cookie.httpOnly,
      ...(cookie.sameSite != null && { sameSite: cookie.sameSite }),
      ...(maxAge != null && { maxAge }),
      ...(expires != null && { expires }),
      partitioned: cookie.partitioned,
    });
  }

  // Synchronous HMAC key derivation (HKDF via Bun.CryptoHasher) + its 4-byte KID. Single source of
  // truth for both sign and unsign — no async crypto.subtle key import on the signing path.
  private deriveHmacSync(secret: string): { keyBytes: Uint8Array; kid: Uint8Array } {
    const keyBytes = deriveHmacKeyBytesSync(secret, this.options.algorithm, this.options.kdfSalt);
    const kidHash = new Bun.CryptoHasher('sha256');
    kidHash.update(keyBytes);
    const kid = new Uint8Array(kidHash.digest()).subarray(0, KID_LENGTH);
    return { keyBytes, kid };
  }

  private signSync(data: Uint8Array): string {
    const { keyBytes, kid } = this.hmacKeys[0]!;
    const hasher = new Bun.CryptoHasher(this.options.algorithm, keyBytes);
    hasher.update(data);
    const mac = hasher.digest();
    const blob = new Uint8Array(KID_LENGTH + mac.byteLength);
    blob.set(kid, 0);
    blob.set(new Uint8Array(mac), KID_LENGTH);
    return bufferToB64Url(blob);
  }

  private checkValidName(name: string): CookieErrorData | undefined {
    if (!isValidCookieName(name)) {
      return { reason: CookieErrorReason.InvalidCookieName, message: 'cookie name must be a valid RFC 9110 token' };
    }
    return undefined;
  }

  private checkNameValueSize(name: string, value: string): CookieErrorData | undefined {
    const bytes = Buffer.byteLength(name, 'utf8') + Buffer.byteLength(value, 'utf8');
    if (bytes > MAX_NAME_VALUE_OCTETS) {
      return { reason: CookieErrorReason.CookieTooLarge, message: `cookie name+value exceeds ${MAX_NAME_VALUE_OCTETS} octets (${bytes})` };
    }
    return undefined;
  }

  private checkAttributeSizes(merged: CookieAttributes): CookieErrorData | undefined {
    const over = (label: string, val: string | undefined): CookieErrorData | undefined => {
      if (val === undefined) {return undefined;}
      const len = Buffer.byteLength(val, 'utf8');
      if (len > MAX_ATTRIBUTE_OCTETS) {
        return { reason: CookieErrorReason.AttributeTooLarge, message: `${label} attribute exceeds ${MAX_ATTRIBUTE_OCTETS} octets (${len})` };
      }
      return undefined;
    };
    // Expires is normalized to a Date before reaching here (never a string), so only Domain/Path — the
    // two free-form string attributes — can exceed the per-attribute octet cap.
    return over('Domain', merged.domain)
      ?? over('Path', merged.path);
  }

  private checkValidMaxAge(maxAge: number): CookieErrorData | undefined {
    if (!isValidMaxAge(maxAge)) {
      return { reason: CookieErrorReason.InvalidMaxAge, message: 'Max-Age must be a positive integer' };
    }
    return undefined;
  }

  private checkValidExpires(expires: number | Date | string): CookieErrorData | undefined {
    if (!isValidExpires(expires)) {
      return { reason: CookieErrorReason.InvalidExpires, message: 'expires must be a millisecond timestamp, Date, or parseable date string within the representable Date range' };
    }
    return undefined;
  }

  private checkValidDomain(domain: string): CookieErrorData | undefined {
    if (!isValidDomain(domain)) {
      return { reason: CookieErrorReason.InvalidDomain, message: 'Domain must be a non-empty RFC 1123 subdomain (LDH rule) with no control characters or ";"' };
    }
    return undefined;
  }

  private checkValidPath(path: string): CookieErrorData | undefined {
    if (!isValidPath(path)) {
      return { reason: CookieErrorReason.InvalidPath, message: 'Path must not contain control characters or ";"' };
    }
    return undefined;
  }

  private checkValidPriority(p: string): CookieErrorData | undefined {
    if (!isCookiePriority(p)) {
      return { reason: CookieErrorReason.InvalidPriority, message: 'priority must be one of: low, medium, high' };
    }
    return undefined;
  }

  private checkValidSameSite(s: string): CookieErrorData | undefined {
    // Bun.Cookie throws on an out-of-enum sameSite (unlike the lenient boolean attrs), so validate it
    // here to surface a precise Err instead of letting construction throw.
    if (!isSameSite(s)) {
      return { reason: CookieErrorReason.InvalidSameSite, message: 'sameSite must be one of: strict, lax, none' };
    }
    return undefined;
  }

  private cloneWithValue(source: Cookie, newValue: string): Cookie {
    // Re-derive the Domain/Max-Age/Expires overlay so a default never re-appears on a cookie that must not
    // carry it (a __Host- Domain, or a Max-Age over an explicit Expires) — see overlayDefaultLifetime.
    const { domain, maxAge, expires } = this.overlayDefaultLifetime(source);
    // `source` is an already-valid Cookie and the applied defaults are boot-validated, so this cannot
    // throw — every attribute Bun.Cookie could reject is vetted before it reaches here.
    const cloned = new Cookie(source.name, newValue, {
      ...(domain != null && { domain }),
      ...(source.path != null && { path: source.path }),
      secure: source.secure,
      httpOnly: source.httpOnly,
      ...(source.sameSite != null && { sameSite: source.sameSite }),
      ...(maxAge != null && { maxAge }),
      ...(expires != null && { expires }),
      partitioned: source.partitioned,
    });
    const sourceMeta = this.meta.get(source);
    if (sourceMeta) {this.meta.set(cloned, sourceMeta);}
    return cloned;
  }
}
