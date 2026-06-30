import { HttpHeader } from '@zipbul/http-adapter';

import type { HeaderEntry } from '../header-entry';

export function serializeXContentTypeOptions(): HeaderEntry {
  return [HttpHeader.XContentTypeOptions, 'nosniff'];
}
