import { HttpHeader } from '@zipbul/http-adapter';

import type { HeaderEntry } from '../header-entry';
import type { ReferrerPolicyToken } from '../types';

export function serializeReferrerPolicy(tokens: readonly ReferrerPolicyToken[]): HeaderEntry {
  return [HttpHeader.ReferrerPolicy, tokens.join(', ')];
}
