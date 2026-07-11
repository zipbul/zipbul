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
 * RFC 9110 §12.5.5: returns the selecting-header tokens from `incoming` that are not
 * already present in `existing` (case-insensitive), so a handler-set `Vary` can be
 * merged with the middleware's `Accept-Encoding` without dropping either. Empty when
 * `existing` already varies on everything (`*`).
 */
export function varyTokensToAppend(existing: string | null, incoming: string): string[] {
  const seen = new Set(
    (existing ?? '').split(',').map((t) => t.trim().toLowerCase()).filter((t) => t !== ''),
  );
  if (seen.has('*')) return [];

  const toAppend: string[] = [];
  for (const token of incoming.split(',')) {
    const t = token.trim();
    if (t !== '' && !seen.has(t.toLowerCase())) {
      toAppend.push(t);
      seen.add(t.toLowerCase());
    }
  }
  return toAppend;
}

/**
 * RFC 9110 §7.7 · RFC 9111 §5.2.2.6: detects the `no-transform` response directive
 * in a `Cache-Control` field value (case-insensitive, comma-separated directives).
 */
export function hasNoTransform(cacheControl: string): boolean {
  return cacheControl.split(',').some((d) => d.trim().toLowerCase() === 'no-transform');
}
