// Package-wide magic constants: size caps, crypto byte-lengths, the HMAC name/value separator, the
// Date range bound, and user-facing defaults. Kept in one file (file-unit constant management) so the
// numeric/literal values aren't scattered across modules. Logic-bearing constants stay with their owner:
// validation regexes live in cookie-validators.ts, the algorithm→hash maps and HKDF info bytes live in
// cookie-crypto.ts, and the CookieAttributes exhaustiveness list lives in cookie-parser.ts.

// --- wire size caps (RFC 6265bis §5.4 / §5.6, RFC 9110) ---
/** Max combined octets of cookie name + value. */
export const MAX_NAME_VALUE_OCTETS = 4096;
/** Max octets of a single free-form attribute value (Domain/Path). */
export const MAX_ATTRIBUTE_OCTETS = 1024;
/** Max octets of a serialized `Set-Cookie` header line. */
export const MAX_HEADER_OCTETS = 8190;

/** Separator binding name to value inside the signed HMAC payload (`name + \x00 + value`). */
export const NAME_VALUE_SEPARATOR = '\x00';

/** Largest absolute time (ms) a JS Date can represent (ECMAScript ±8.64e15). */
export const MAX_TIME_MS = 8.64e15;

// --- crypto byte lengths ---
/** AES-GCM IV length (96-bit, NIST SP 800-38D recommended). */
export const IV_LENGTH = 12;
/** Key-id prefix length carried on every signature/ciphertext for rotation. */
export const KID_LENGTH = 4;
/** AES-GCM authentication tag length in bits. */
export const AUTH_TAG_BITS = 128;
/** Minimum bytes a valid ciphertext blob can be (KID + IV + tag, the tag being AUTH_TAG_BITS / 8). */
export const MIN_CIPHERTEXT_LENGTH = KID_LENGTH + IV_LENGTH + AUTH_TAG_BITS / 8;

// --- user-facing defaults ---
/** Default HKDF salt (RFC 5869 §3.1) when the caller supplies none. */
export const DEFAULT_KDF_SALT = new TextEncoder().encode('@zipbul/cookie/2026');
/** Default cap (bytes) on an inbound `Cookie` header the CookieJar will parse. */
export const DEFAULT_MAX_INBOUND_COOKIE_BYTES = 16384;
