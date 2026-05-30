import { Cookie } from 'bun';
import { err } from '@zipbul/result';
import type { ResultAsync } from '@zipbul/result';

import { CookieErrorReason } from './enums';
import { CookieError } from './interfaces';
import type { CookieAttributes, CookieErrorData, SerializeContext } from './interfaces';
import type { CookieParser } from './cookie-parser';

interface OutboundEntry {
  readonly cookie: Cookie;
  readonly deleted: boolean;
}

type Step = 'decrypt' | 'unsign';

export class CookieJar {
  private readonly inbound: ReadonlyMap<string, string>;
  private readonly outbound = new Map<string, OutboundEntry>();

  constructor(
    private readonly parser: CookieParser,
    cookieHeader: string,
  ) {
    const parsed = new Map<string, string>();
    if (cookieHeader !== '') {
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
        if (name.includes('�')) continue;
        if (value.includes('�')) {
          rawPairs ??= parseRawCookiePairs(cookieHeader);
          const rawValue = rawPairs.get(name);
          if (rawValue === undefined || !isStrictlyDecodable(rawValue)) continue;
        }
        parsed.set(name, value);
      }
    }
    this.inbound = parsed;
  }

  public has(name: string): boolean {
    return this.inbound.has(name);
  }

  public getRaw(name: string): string | undefined {
    return this.inbound.get(name);
  }

  public async get(name: string): ResultAsync<string | null, CookieErrorData> {
    const raw = this.inbound.get(name);
    if (raw === undefined) return null;

    let cookie = new Cookie(name, raw);

    if (this.parser.isEncryptionConfigured) {
      try {
        cookie = await this.parser.decrypt(cookie);
      } catch (thrown) {
        return this.toErr(thrown, 'decrypt');
      }
    }

    if (this.parser.isSigningConfigured) {
      try {
        cookie = await this.parser.unsign(cookie);
      } catch (thrown) {
        return this.toErr(thrown, 'unsign');
      }
    }

    return cookie.value;
  }

  public set(name: string, value: string, options?: CookieAttributes): void {
    const cookie = this.parser.createCookie(name, value, options);
    this.outbound.set(name, { cookie, deleted: false });
  }

  public delete(name: string, options?: CookieAttributes): void {
    // For deletion, the parser may have defaults (e.g. sameSite='none' + secure='auto') that would
    // throw at serialize time when the request is insecure. We only fill defaults — explicit user
    // input is honored verbatim so cross-site deletions (sameSite:'none' + secure:true) are possible.
    const lower = name.toLowerCase();
    const isHostPrefix = lower.startsWith('__host-');
    const isSecurePrefix = lower.startsWith('__secure-');

    const overrides: CookieAttributes = {
      ...options,
      maxAge: 0,
      expires: new Date(0),
    };
    if (options?.sameSite === undefined) {
      overrides.sameSite = 'lax';
    }
    if (options?.secure === undefined) {
      // RFC 6265bis §4.1.3: a __Host-/__Secure- Set-Cookie MUST carry Secure even when expiring, or the
      // UA rejects the deletion line and the cookie is never cleared. Plain cookies default to insecure
      // so they can still be expired over plain HTTP without a secure='auto' parser default throwing.
      // Without this, deleting the library's own most-secure cookie classes throws under default options.
      overrides.secure = isHostPrefix || isSecurePrefix;
    }
    if (isHostPrefix && options?.path === undefined) {
      // __Host- requires Path=/ (RFC 6265bis §4.1.3.2); set it so the expiry line passes prefix
      // validation and matches the original host-only cookie's scope. The Domain prohibition is
      // enforced structurally in CookieParser.mergeAttributes (the parser default Domain is never
      // applied to a __Host- name), so no domain handling is needed here.
      overrides.path = '/';
    }
    const cookie = this.parser.createCookie(name, '', overrides);
    this.outbound.set(name, { cookie, deleted: true });
  }

  public async getSetCookieHeaders(context?: SerializeContext): Promise<string[]> {
    const tasks: Promise<string>[] = [];

    for (const [, entry] of this.outbound) {
      if (entry.deleted) {
        tasks.push(Promise.resolve(this.parser.serialize(entry.cookie, context)));
        continue;
      }
      tasks.push(this.transformAndSerialize(entry.cookie, context));
    }

    return Promise.all(tasks);
  }

  private async transformAndSerialize(cookie: Cookie, context?: SerializeContext): Promise<string> {
    let c = cookie;
    if (this.parser.isSigningConfigured) {
      c = this.parser.sign(c);
    }
    if (this.parser.isEncryptionConfigured) {
      c = await this.parser.encrypt(c);
    }
    return this.parser.serialize(c, context);
  }

  private toErr(thrown: unknown, step: Step): ReturnType<typeof err<CookieErrorData>> {
    if (thrown instanceof CookieError) {
      return err<CookieErrorData>({
        reason: thrown.reason,
        message: thrown.message,
      });
    }
    return err<CookieErrorData>({
      reason: step === 'decrypt'
        ? CookieErrorReason.DecryptionFailed
        : CookieErrorReason.SignatureVerificationFailed,
      message: thrown instanceof Error ? thrown.message : 'unknown cookie error',
    });
  }
}

/**
 * Splits a raw Cookie header into name → raw-value pairs WITHOUT percent-decoding, mirroring
 * `Bun.CookieMap`'s pair tokenisation (split on `;`, first `=` is the delimiter, trim OWS). Valid
 * cookie names carry no `%`, so a kept entry's name matches Bun's decoded name. First occurrence wins.
 * @internal
 */
function parseRawCookiePairs(header: string): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === '' || pairs.has(name)) continue;
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
