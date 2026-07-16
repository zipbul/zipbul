import { HttpStatus, ResponseBodyKind } from '../enums';

import type { JsonValue } from './json';

export type ResponseBodyValue =
  | JsonValue | string | Uint8Array | ArrayBuffer
  | ReadableStream<Uint8Array> | Blob
  | null;

/**
 * `ResponseBodyValue` narrowed to what a buffered representation can hold —
 * streams and Blobs are `Stream`-slot only, never assignable to the
 * `Buffered` slot or to {@link HttpResponse.replaceRepresentation}.
 */
export type BufferedBodyValue = Exclude<ResponseBodyValue, ReadableStream<Uint8Array> | Blob>;

/**
 * The response body's single storage slot — a tagged union so the old
 * two-store shape (`_body` mutually exclusive with a native `Response`) is a
 * type-level invariant instead of a discipline call sites had to maintain by
 * hand.
 */
export type BodySlot =
  | { readonly kind: ResponseBodyKind.None }
  | { readonly kind: ResponseBodyKind.Buffered; readonly value: BufferedBodyValue }
  | {
      readonly kind: ResponseBodyKind.Stream;
      /** bodiless 핸들러 Response(`new Response(null, {status:204})`)에서 null —
       *  슬롯의 존재 자체가 "이 응답은 핸들러의 것"이라는 표식 (AfterHandle 스킵 계약 보존) */
      readonly readable: ReadableStream | null;
      /** Bun이 전송 시점에 Blob backing에서 Content-Type을 추론한다 — §5 격리 가드가 이 플래그로 판단한다 */
      readonly blobBacked: boolean;
    };

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
