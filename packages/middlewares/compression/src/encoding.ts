import { CompressionCodec } from './enums';

export interface EncodingPreference {
  encoding: string;
  quality: number;
}

/**
 * Parses an Accept-Encoding header value into a sorted list of preferences.
 * Follows RFC 9110 §12.5.3 (quality values).
 *
 * @example parseAcceptEncoding('gzip;q=1.0, br;q=0.8, identity;q=0.5')
 * // [{ encoding: 'gzip', quality: 1.0 }, { encoding: 'br', quality: 0.8 }, ...]
 */
export function parseAcceptEncoding(header: string): EncodingPreference[] {
  const preferences: EncodingPreference[] = [];

  for (const part of header.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;

    const [encoding, ...params] = trimmed.split(';');
    if (encoding === undefined) continue;
    let name = encoding.trim().toLowerCase();
    if (name === '') continue;

    // RFC 9110 §8.4.1: x-gzip is equivalent to gzip, x-compress to compress
    if (name === 'x-gzip') name = 'gzip';
    else if (name === 'x-compress') name = 'compress';

    let quality = 1.0;
    for (const param of params) {
      const [key, value] = param.split('=');
      if (key?.trim().toLowerCase() === 'q' && value !== undefined) {
        // RFC 9110 §12.4.2 qvalue ABNF: ( "0" [ "." 0*3DIGIT ] ) / ( "1" [ "." 0*3("0") ] ).
        // Values outside this grammar (q=1.5, q=-0.1, q=0.5junk, q=abc) are malformed;
        // the RFC defines no recipient handling, so we ignore the parameter and keep the
        // default weight 1 rather than coercing a bad value to a preference.
        const v = value.trim();
        if (/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(v)) {
          quality = Number.parseFloat(v);
        }
      }
    }

    preferences.push({ encoding: name, quality });
  }

  preferences.sort((a, b) => b.quality - a.quality);
  return preferences;
}

/**
 * Negotiates the best encoding based on server preferences and client Accept-Encoding.
 *
 * Strategy: among server-supported encodings that the client also accepts (q > 0),
 * pick the one with the highest client quality value. Ties are broken by server
 * preference order (earlier = higher priority).
 */
export function negotiateEncoding(
  serverEncodings: CompressionCodec[],
  clientPreferences: EncodingPreference[],
): CompressionCodec | null {
  const clientMap = new Map<string, number>();
  let wildcardQuality = -1;

  for (const pref of clientPreferences) {
    if (pref.encoding === '*') {
      if (pref.quality > wildcardQuality) wildcardQuality = pref.quality;
    } else {
      // 중복 항목은 최고 qvalue가 대표한다 — 마지막 항목이 앞의 항목을
      // 덮어써 §12.5.3의 "최고 non-zero qvalue 선호"를 뒤집으면 안 된다
      const existing = clientMap.get(pref.encoding);
      if (existing === undefined || pref.quality > existing) {
        clientMap.set(pref.encoding, pref.quality);
      }
    }
  }

  let best: CompressionCodec | null = null;
  let bestQuality = 0;

  for (const encoding of serverEncodings) {
    const quality = clientMap.get(encoding) ?? wildcardQuality;
    if (quality > 0 && quality > bestQuality) {
      best = encoding;
      bestQuality = quality;
    }
  }

  return best;
}

/**
 * Determines whether the identity (no-coding) representation is acceptable.
 *
 * RFC 9110 §12.5.3 rule 2: a representation without a content coding is
 * acceptable by default unless specifically excluded by `identity;q=0` or
 * `*;q=0` without a more specific entry for identity. Duplicate entries are
 * represented by their highest qvalue (same rule as {@link negotiateEncoding}).
 */
export function isIdentityAcceptable(clientPreferences: EncodingPreference[]): boolean {
  let identityQuality: number | undefined;
  let wildcardQuality: number | undefined;

  for (const pref of clientPreferences) {
    if (pref.encoding === 'identity') {
      if (identityQuality === undefined || pref.quality > identityQuality) {
        identityQuality = pref.quality;
      }
    } else if (pref.encoding === '*') {
      if (wildcardQuality === undefined || pref.quality > wildcardQuality) {
        wildcardQuality = pref.quality;
      }
    }
  }

  if (identityQuality !== undefined) return identityQuality > 0;
  if (wildcardQuality !== undefined) return wildcardQuality > 0;
  return true;
}
