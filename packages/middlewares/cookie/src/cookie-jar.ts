import { Cookie } from 'bun';
import { isErr } from '@zipbul/result';
import type { Result, ResultAsync } from '@zipbul/result';

import { SameSite } from './enums';
import { isValidCookieName } from './cookie-validators';
import type { CookieAttributes, CookieErrorData, SerializeContext } from './interfaces';
import type { CookieParser } from './cookie-parser';

interface OutboundEntry {
  readonly cookie: Cookie;
  readonly deleted: boolean;
}

/**
 * Splits a raw Cookie header into decoded-name → RAW-value pairs, mirroring `Bun.CookieMap`'s pair
 * tokenisation (split on `;`, first `=` is the delimiter, trim OWS, first occurrence wins). The NAME is
 * percent-decoded so the key matches `Bun.CookieMap`'s decoded name even when the wire name is itself
 * percent-encoded (e.g. `n%41` → `nA`); the VALUE is kept raw so the caller can strict-decode it to tell
 * a silently-corrupted value from a genuine U+FFFD.
 * @internal
 */
function parseRawCookiePairs(header: string): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      continue;
    }
    const rawName = part.slice(0, eq).trim();
    if (rawName === '') {
      continue;
    }
    // Bun decodes cookie names with decodeURIComponent semantics (verified), so decode here to key by the
    // same decoded name the lookup uses. A name with malformed escapes throws and is skipped — Bun would
    // have decoded it to a U+FFFD name that isValidCookieName already rejected upstream, so it can never be
    // a lookup target.
    let name: string;
    try {
      name = decodeURIComponent(rawName);
    } catch {
      continue;
    }
    if (pairs.has(name)) {
      continue;
    }
    pairs.set(name, part.slice(eq + 1).trim());
  }
  return pairs;
}

/**
 * Reports whether a raw percent-encoded segment decodes without error. `decodeURIComponent` throws on
 * a malformed escape (`%XX`, a truncated UTF-8 sequence, a bare `%`) — exactly the inputs `Bun.CookieMap`
 * silently turns into U+FFFD — while a legitimately-encoded U+FFFD (`%EF%BF%BD`) decodes cleanly.
 * @internal
 */
function isStrictlyDecodable(raw: string): boolean {
  try {
    decodeURIComponent(raw);
    return true;
  } catch {
    return false;
  }
}

export class CookieJar {
  private readonly inbound: ReadonlyMap<string, string>;
  private readonly outbound = new Map<string, OutboundEntry>();

  constructor(
    private readonly parser: CookieParser,
    cookieHeader: string,
  ) {
    const parsed = new Map<string, string>();
    // Bound the per-request parsing cost: an oversized `Cookie` header is treated as carrying no cookies
    // rather than parsed in full (DoS amplification guard). The cap is `Buffer.byteLength`, not `.length`,
    // so multi-byte values are measured by their true wire size.
    if (cookieHeader !== '' && Buffer.byteLength(cookieHeader, 'utf8') <= parser.maxInboundCookieBytes) {
      const map = new Bun.CookieMap(cookieHeader);
      // Bun.CookieMap percent-decodes leniently: a malformed escape (`%XX`, a truncated multi-byte
      // sequence, a bare `%`) is replaced with U+FFFD instead of failing. A literal U+FFFD value is,
      // however, a legitimate scalar a caller may legitimately store, so a substring test on the
      // decoded output cannot tell silent corruption from a real U+FFFD. We disambiguate by strict-
      // decoding the RAW wire segment: only entries whose decoded form contains U+FFFD AND whose raw
      // segment is NOT strictly decodable are dropped as corrupt. The raw map is parsed lazily, only
      // when a U+FFFD actually appears.
      let rawPairs: Map<string, string> | null = null;
      for (const [name, value] of map) {
        // First-occurrence wins (parity with Bun.CookieMap.get). Crucially, this also prevents a later
        // malformed same-name duplicate from overwriting an already-stored valid value: once a name is
        // kept, every later pair for that name is skipped before the U+FFFD check can mis-fire.
        if (parsed.has(name)) {
          continue;
        }
        // Drop any name that is not a valid RFC 9110 token. This both filters Bun.CookieMap's
        // U+FFFD-corrupted names (a U+FFFD is non-tchar) AND any other non-token name Bun may keep
        // (e.g. "a b"): emitting/getting such a name would make `new Cookie(name, …)` throw, so a
        // malformed name is treated as absent here — keeping has()/getRaw()/get() consistent.
        if (!isValidCookieName(name)) {
          continue;
        }
        if (value.includes('�')) {
          rawPairs ??= parseRawCookiePairs(cookieHeader);
          const rawValue = rawPairs.get(name);
          if (rawValue === undefined || !isStrictlyDecodable(rawValue)) {
            continue;
          }
        }
        parsed.set(name, value);
      }
    }
    this.inbound = parsed;
  }

  /** Whether an inbound cookie with this name was present (and survived corruption filtering). */
  public has(name: string): boolean {
    return this.inbound.has(name);
  }

  /**
   * The RAW inbound value — percent-decoded by the parser but NOT unsigned/decrypted. Use {@link get}
   * for the verified/decoded value when signing or encryption is configured; `getRaw` deliberately
   * bypasses that, so the caller is responsible for any verification.
   */
  public getRaw(name: string): string | undefined {
    return this.inbound.get(name);
  }

  public async get(name: string): ResultAsync<string | null, CookieErrorData> {
    const raw = this.inbound.get(name);
    if (raw === undefined) {
      return null;
    }

    let cookie = new Cookie(name, raw);

    if (this.parser.isEncryptionConfigured) {
      const decrypted = await this.parser.decrypt(cookie);
      if (isErr(decrypted)) {return decrypted;}
      cookie = decrypted;
    }

    if (this.parser.isSigningConfigured) {
      const unsigned = await this.parser.unsign(cookie);
      if (isErr(unsigned)) {return unsigned;}
      cookie = unsigned;
    }

    return cookie.value;
  }

  public set(name: string, value: string, options?: CookieAttributes): Result<void, CookieErrorData> {
    const cookie = this.parser.createCookie(name, value, options);
    if (isErr(cookie)) {return cookie;}
    this.outbound.set(name, { cookie, deleted: false });
    return undefined;
  }

  public delete(name: string, options?: CookieAttributes): Result<void, CookieErrorData> {
    // Fill defaults only — explicit user input is honored verbatim so cross-site deletions
    // (sameSite:'none' + secure:true) remain possible.
    const lower = name.toLowerCase();
    const isHostPrefix = lower.startsWith('__host-');
    const isSecurePrefix = lower.startsWith('__secure-');

    // Deletion is a past Expires (RFC 6265bis §4.1.2.2 expiry mechanism), NOT Max-Age=0 — the latter is
    // ungrammatical (max-age-av = non-zero-digit *DIGIT) and createCookie now rejects it. A caller-
    // supplied Max-Age MUST be dropped: per §5.4.2 Max-Age takes precedence over Expires, so leaving it
    // in would turn `delete(name, { maxAge: 100 })` into a 100-second renewal instead of a deletion.
    const overrides: CookieAttributes = {
      ...options,
      expires: new Date(0),
    };
    delete overrides.maxAge;
    if (options?.sameSite === undefined) {
      overrides.sameSite = SameSite.Lax;
    }
    if (options?.secure === undefined && (isHostPrefix || isSecurePrefix)) {
      // __Host-/__Secure- deletions MUST carry Secure (RFC 6265bis §4.1.3) or the UA ignores the expiry
      // line. Non-prefixed deletions leave Secure to the parser default — mirroring set(), so a cookie
      // set under secure:'auto' (Secure deferred to the flush channel) stays deletable.
      overrides.secure = true;
    }
    if (isHostPrefix && options?.path === undefined) {
      // __Host- requires Path=/ (RFC 6265bis §4.1.3.2); set it so the expiry line passes prefix
      // validation and matches the original host-only cookie's scope.
      overrides.path = '/';
    }
    const cookie = this.parser.createCookie(name, '', overrides);
    if (isErr(cookie)) {return cookie;}
    this.outbound.set(name, { cookie, deleted: true });
    return undefined;
  }

  public async getSetCookieHeaders(context?: SerializeContext): Promise<string[]> {
    const results = await Promise.all(
      [...this.outbound.values()].map((entry) => this.serializeEntry(entry, context)),
    );
    // Per-cookie isolation: each cookie is its own Set-Cookie line (RFC 9110 §5.3 — Set-Cookie is never
    // combined), so a cookie that cannot be serialized/emitted on the current channel is skipped and
    // never drops the others. Validation errors the caller can act on already surfaced at set()/delete().
    return results.filter((r): r is string => !isErr(r));
  }

  private async serializeEntry(entry: OutboundEntry, context?: SerializeContext): ResultAsync<string, CookieErrorData> {
    if (entry.deleted) {
      return this.parser.serialize(entry.cookie, context);
    }
    return this.transformAndSerialize(entry.cookie, context);
  }

  private async transformAndSerialize(cookie: Cookie, context?: SerializeContext): ResultAsync<string, CookieErrorData> {
    let c = cookie;
    if (this.parser.isSigningConfigured) {
      const signed = this.parser.sign(c);
      if (isErr(signed)) {return signed;}
      c = signed;
    }
    if (this.parser.isEncryptionConfigured) {
      const encrypted = await this.parser.encrypt(c);
      if (isErr(encrypted)) {return encrypted;}
      c = encrypted;
    }
    return this.parser.serialize(c, context);
  }
}
