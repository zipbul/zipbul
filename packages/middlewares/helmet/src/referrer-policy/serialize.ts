import { HttpHeader } from '@zipbul/http-adapter';

import type { ReferrerPolicyOption } from './types';

/**
 * Serializes the `Referrer-Policy` header.
 * - `false`       → undefined (no emission; per §2.5 modern UAs already apply the default)
 * - single token  → [name, token]
 * - token array   → [name, "a, b"] — the §2.4 fallback list, emitted as one header per §2.11
 *
 * An empty array has nothing to emit, so it is treated as undefined (no emission).
 */
export function serializeReferrerPolicy(
  policy: ReferrerPolicyOption,
): readonly [name: string, value: string] | undefined {
  if (policy === false) return undefined;
  // Narrow via typeof-string — Array.isArray's predicate is `any[]`, which
  // can't strip the readonly array from the non-array branch and fails with
  // TS2322. A string enum is a subset of string, so typeof narrows both ways.
  const value = typeof policy === 'string' ? policy : policy.join(', ');
  if (value.length === 0) return undefined; // empty array ([]) → no emission (equivalent to §2.5)
  return [HttpHeader.ReferrerPolicy, value];
}
