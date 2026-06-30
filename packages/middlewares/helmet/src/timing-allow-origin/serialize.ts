import { HttpHeader } from '@zipbul/http-adapter';

import type { HeaderEntry } from '../header-entry';

export function serializeTimingAllowOrigin(values: readonly string[]): HeaderEntry {
  return [HttpHeader.TimingAllowOrigin, values.join(', ')];
}
