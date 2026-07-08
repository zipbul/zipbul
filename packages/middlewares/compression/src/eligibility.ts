/**
 * Header predicates that decide whether a response is eligible for content-coding,
 * independent of the middleware's orchestration. Pure string logic over RFC
 * header list values.
 */

/**
 * RFC 9110 §12.5.5·§12.4.3: an existing `Vary` already covers Accept-Encoding when
 * it lists `accept-encoding` or the wildcard `*` (unlimited variance), so appending
 * `Accept-Encoding` again is unnecessary.
 */
export function varyCoversAcceptEncoding(header: string): boolean {
  return header.split(',').some((v) => {
    const token = v.trim().toLowerCase();
    return token === 'accept-encoding' || token === '*';
  });
}

/**
 * RFC 9110 §7.7 · RFC 9111 §5.2.2.6: detects the `no-transform` response directive
 * in a `Cache-Control` field value (case-insensitive, comma-separated directives).
 */
export function hasNoTransform(cacheControl: string): boolean {
  return cacheControl.split(',').some((d) => d.trim().toLowerCase() === 'no-transform');
}
