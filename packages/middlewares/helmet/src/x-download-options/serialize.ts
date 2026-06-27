import { HttpHeader } from '@zipbul/http-adapter';

import type { HeaderEntry } from '../header-entry';

export function serializeXDownloadOptions(): HeaderEntry {
  return [HttpHeader.XDownloadOptions, 'noopen'];
}
