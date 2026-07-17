/** Referrer-Policy's recognized tokens (STANDARDS §2.2 — the 8 W3C Referrer Policy ED policy-tokens). */
export enum ReferrerPolicyToken {
  NoReferrer = 'no-referrer',
  NoReferrerWhenDowngrade = 'no-referrer-when-downgrade',
  SameOrigin = 'same-origin',
  Origin = 'origin',
  StrictOrigin = 'strict-origin',
  OriginWhenCrossOrigin = 'origin-when-cross-origin',
  StrictOriginWhenCrossOrigin = 'strict-origin-when-cross-origin',
  UnsafeUrl = 'unsafe-url',
}
