import { HttpHeader } from '@zipbul/http-adapter';

/**
 * Serializes the `X-Content-Type-Options` header.
 *
 * The sole valid token is `nosniff` (STANDARDS §1.2 — WHATWG Fetch value ABNF
 * `X-Content-Type-Options = "nosniff"`), so the value is fixed and the caller
 * only decides whether the header is emitted at all.
 *
 * @param enabled - Whether to emit the header.
 * @returns The header entry `[name, "nosniff"]`, or `undefined` when disabled.
 */
export function serializeXContentTypeOptions(
  enabled: boolean,
): readonly [name: string, value: string] | undefined {
  return enabled ? [HttpHeader.XContentTypeOptions, 'nosniff'] : undefined;
}
