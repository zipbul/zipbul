import { HttpStatus } from '../enums';

import type { JsonValue } from './json';

export type ResponseBodyValue =
  | JsonValue | string | Uint8Array | ArrayBuffer
  | ReadableStream<Uint8Array> | Blob
  | null;

/**
 * 3xx status codes that the redirect helper / decorator accept.
 * RFC 9110 §15.4: 301, 302, 303, 307, 308 (304/305/306 excluded — 304 is
 * conditional, 305 is deprecated, 306 is reserved).
 */
export type RedirectStatus =
  | HttpStatus.MovedPermanently
  | HttpStatus.Found
  | HttpStatus.SeeOther
  | HttpStatus.TemporaryRedirect
  | HttpStatus.PermanentRedirect;
