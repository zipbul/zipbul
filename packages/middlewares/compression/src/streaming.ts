import { CompressionCodec } from './enums';

/**
 * CompressionStream 포맷 문자열 매핑.
 *
 * WHATWG Compression Standard(2026-04-20 스냅숏) 표준 포맷: `gzip`(RFC 1952)·
 * `deflate`(RFC 1950 zlib-wrapped)·`brotli`(RFC 7932). `zstd`는 표준이 아닌
 * Bun 런타임 확장이다. HTTP `deflate` content coding은 zlib-wrapped이므로
 * `deflate-raw`(RFC 1951)가 아니라 `deflate`를 사용한다.
 */
export const STREAM_FORMATS = {
  [CompressionCodec.Gzip]: 'gzip',
  [CompressionCodec.Deflate]: 'deflate',
  [CompressionCodec.Br]: 'brotli',
  [CompressionCodec.Zstd]: 'zstd',
} as const satisfies Record<CompressionCodec, string>;

/**
 * 소스 스트림을 지정 코딩의 압축 스트림으로 감싼다.
 *
 * - 소스는 즉시 파이프에 잠기고(locked), 반환 스트림은 잠기지 않은 새 스트림이다.
 * - 소스의 mid-stream 에러는 반환 스트림의 소비자에게 그대로 전파된다.
 * - CompressionStream은 레벨 파라미터를 받지 않는다 — 런타임 기본 레벨 위임
 *   (STANDARDS §9.2.1: 레벨은 정책이며 어떤 정본도 규정하지 않는다).
 */
export function compressStream(
  source: ReadableStream<Uint8Array>,
  codec: CompressionCodec,
): ReadableStream<Uint8Array> {
  // Bun의 CompressionStream은 'brotli'·'zstd' 확장 포맷을 받지만 lib 타입은
  // WHATWG 표준 3종만 알고, writable도 BufferSource로 넓게 선언되어 있어
  // 생성자 인자와 pair 타입만 국소적으로 좁힌다 (동작은 유닛 스펙이 보증).
  const compression = new CompressionStream(
    STREAM_FORMATS[codec] as ConstructorParameters<typeof CompressionStream>[0],
  ) as unknown as ReadableWritablePair<Uint8Array, Uint8Array>;
  return source.pipeThrough(compression);
}
