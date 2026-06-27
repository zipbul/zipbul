import { HttpHeader } from '@zipbul/http-adapter';

import type { HeaderEntry } from '../header-entry';
import type { XFrameOptionsValue } from '../types';

/** X-Frame-Options. User case is preserved on emit (WAF compatibility). */
export function serializeXFrameOptions(value: XFrameOptionsValue): HeaderEntry {
  return [HttpHeader.XFrameOptions, value];
}
