import { HttpHeader } from '@zipbul/http-adapter';

import type { HeaderEntry } from '../header-entry';

export function serializeXRobotsTag(directives: readonly string[]): HeaderEntry {
  return [HttpHeader.XRobotsTag, directives.join(', ')];
}
