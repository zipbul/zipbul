import type { CookiePriority, SameSite, SigningAlgorithm } from './enums';

export type ResolvedCookieParserOptions = {
  secrets: string[] | null;
  algorithm: SigningAlgorithm;
  encryptionSecrets: string[] | null;
  prefixValidation: boolean;
  kdfSalt: Uint8Array<ArrayBuffer>;
  maxInboundCookieBytes: number;
  defaults: ResolvedCookieDefaults;
};

export type ResolvedCookieDefaults = {
  httpOnly: boolean | null;
  secure: boolean | 'auto' | null;
  sameSite: SameSite | null;
  path: string | null;
  domain: string | null;
  maxAge: number | null;
  // A user expires (number ms / Date / string) is normalized to a Date at resolve time (see
  // normalizeExpires) so the serialization path never hands Bun a bare number (misread as seconds) or a
  // string whose parser Bun would reject.
  expires: Date | null;
  partitioned: boolean | null;
  priority: CookiePriority | null;
};
