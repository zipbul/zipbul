import type { JsonValue } from './json';

export type ResponseBodyValue =
  | JsonValue | string | Uint8Array | ArrayBuffer
  | ReadableStream<Uint8Array> | Blob
  | null;
