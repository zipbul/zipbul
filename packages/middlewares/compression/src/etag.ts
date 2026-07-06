/**
 * RFC 9110 §8.8.3 entity-tag 문법: `opaque-tag = DQUOTE *etagc DQUOTE`,
 * `etagc = %x21 / %x23-7E / obs-text(%x80-FF)`. 문법에 맞는 strong tag만 `W/`를
 * 부여하고, 기형 값(무인용·소문자 `w/`·목록형)은 무효한 weak tag를 새로 만들지
 * 않도록 불변으로 둔다. (`\x80-\xff`가 obs-text 전 구간을 명시 커버한다.)
 */
// eslint-disable-next-line no-control-regex
const STRONG_ETAG_PATTERN = /^"[!#-~\x80-\xff]*"$/;

/**
 * Weakens a strong entity-tag to `W/"..."` after a content coding is applied
 * (RFC 9110 §8.8.1 — a validator shared between the coded and non-coded
 * representation is weak). Already-weak (`W/…`) tags and syntactically malformed
 * values are returned unchanged so no invalid weak tag is fabricated.
 */
export function weakenETag(etag: string): string {
  if (etag.startsWith('W/')) return etag;
  return STRONG_ETAG_PATTERN.test(etag) ? `W/${etag}` : etag;
}
