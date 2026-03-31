import type { JsonValue } from './types';

/**
 * SSE event options for typed events with metadata.
 *
 * @public
 */
export interface ServerSentEventOptions {
  readonly event?: string;
  readonly id?: string;
  readonly retry?: number;
}

/**
 * SSE event marker with metadata.
 * When yielded from an AsyncIterable handler, the event/id/retry fields
 * are included in the SSE frame.
 *
 * @public
 */
export class ServerSentEvent {
  readonly data: JsonValue | string;
  readonly event: string | undefined;
  readonly id: string | undefined;
  readonly retry: number | undefined;

  constructor(data: JsonValue | string, options?: ServerSentEventOptions) {
    this.data = data;
    this.event = options?.event;
    this.id = options?.id;
    this.retry = options?.retry;
  }
}

const TEXT_ENCODER = new TextEncoder();

/**
 * Formats an SSE chunk into a `Uint8Array` wire frame.
 * Handles plain values, strings, and `ServerSentEvent` typed events.
 *
 * @param chunk - The value to format.
 * @returns The SSE frame as bytes.
 * @public
 */
export function formatSSEChunk(chunk: unknown): Uint8Array {
  let frame = '';

  if (chunk instanceof ServerSentEvent) {
    if (chunk.event !== undefined) frame += `event: ${stripLineBreaks(chunk.event)}\n`;
    if (chunk.id !== undefined) frame += `id: ${stripLineBreaks(chunk.id)}\n`;
    if (chunk.retry !== undefined) frame += `retry: ${chunk.retry}\n`;
    frame += formatDataField(serializeData(chunk.data));
  } else if (typeof chunk === 'string') {
    frame = formatDataField(chunk);
  } else {
    frame = formatDataField(JSON.stringify(chunk));
  }

  return TEXT_ENCODER.encode(frame);
}

/**
 * SSE spec: data fields containing newlines must prefix each line with `data:`.
 * CR/CRLF are also treated as line breaks (W3C SSE section 9.2).
 *
 * @param value - The data string to format.
 * @returns The formatted `data:` field with double newline terminator.
 */
function formatDataField(value: string): string {
  return value.replace(/\r\n|\r/g, '\n').split('\n').map(line => `data: ${line}`).join('\n') + '\n\n';
}

function serializeData(data: unknown): string {
  return typeof data === 'string' ? data : JSON.stringify(data);
}

/** SSE event/id 필드는 단일 행 값이다. 개행 문자를 제거하여 프레임 인젝션을 방지한다. */
function stripLineBreaks(value: string): string {
  return value.replace(/\r\n|\r|\n/g, '');
}

/**
 * Type guard for `AsyncIterable`.
 *
 * @param value - The value to check.
 * @returns `true` if the value implements `Symbol.asyncIterator`.
 * @public
 */
export function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return value !== null
    && value !== undefined
    && typeof value === 'object'
    && Symbol.asyncIterator in value;
}
