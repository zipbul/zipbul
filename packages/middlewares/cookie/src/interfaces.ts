import type { CookieErrorReason, CookiePriority, SameSite, SigningAlgorithm } from './enums';

/**
 * The error payload carried by every `Err` arm of the package's `Result`-returning methods, and by
 * {@link CookieError.reason}. Part of the public error contract.
 */
export interface CookieErrorData {
  reason: CookieErrorReason;
  message: string;
}

export class CookieError extends Error {
  public readonly reason: CookieErrorReason;

  constructor(data: CookieErrorData) {
    super(data.message);
    this.name = 'CookieError';
    this.reason = data.reason;
  }
}

export interface CookieParserOptions {
  secrets?: string[];
  algorithm?: SigningAlgorithm;
  encryptionSecret?: string | string[];
  prefixValidation?: boolean;
  /**
   * Optional HKDF salt (RFC 5869 §3.1). When omitted, a fixed library default is used. Supplying a
   * per-deployment salt ensures two installations sharing the same secret derive independent keys.
   */
  kdfSalt?: string | Uint8Array;
  /**
   * Maximum byte length of an inbound `Cookie` header to parse. A request whose header exceeds this is
   * treated as carrying no cookies, bounding the per-request parsing cost (DoS amplification guard).
   * Defaults to 16384 (16 KiB) — raise it for apps that legitimately send very large cookie sets.
   */
  maxInboundCookieBytes?: number;
  httpOnly?: boolean;
  secure?: boolean | 'auto';
  sameSite?: SameSite;
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: number | Date | string;
  partitioned?: boolean;
  priority?: CookiePriority;
}

export interface CookieAttributes {
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: SameSite;
  maxAge?: number;
  expires?: number | Date | string;
  partitioned?: boolean;
  priority?: CookiePriority;
}

export interface SerializeContext {
  isSecure?: boolean;
}
