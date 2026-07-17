import type { ReferrerPolicyToken } from './enums';

/** Emission policy: a single token, a fallback list (§2.4), or `false` (no emission, §2.5). */
export type ReferrerPolicyOption = ReferrerPolicyToken | readonly ReferrerPolicyToken[] | false;
