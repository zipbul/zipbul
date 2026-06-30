import { HttpHeader } from '@zipbul/http-adapter';

import type { HeaderEntry } from '../header-entry';

export function serializeXDnsPrefetchControl(value: 'on' | 'off'): HeaderEntry {
  return [HttpHeader.XDnsPrefetchControl, value];
}
