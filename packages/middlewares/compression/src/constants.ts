import { CompressionCodec } from './enums';

export const DEFAULT_THRESHOLD = 1024;

export const DEFAULT_ENCODINGS: CompressionCodec[] = [
  CompressionCodec.Br,
  CompressionCodec.Gzip,
];

/**
 * RFC 9530 §2·§3: integrity 필드는 실제 content/representation 바이트를 서술하므로,
 * 인코딩 적용 후 비인코딩 기준으로 계산된 기존 값은 거짓이 되어 유지할 수 없다
 * (STANDARDS §2.2 — Content-Length 무효화와 동일 논리).
 */
export const INTEGRITY_FIELDS = ['content-digest', 'repr-digest'] as const;

/** Encodings with safe format-level padding for BREACH mitigation (gzip FEXTRA, zstd skippable frame). */
export const BREACH_SAFE_ENCODINGS: ReadonlySet<CompressionCodec> = new Set<CompressionCodec>([
  CompressionCodec.Gzip,
  CompressionCodec.Zstd,
]);

export const DEFAULT_LEVELS = {
  [CompressionCodec.Br]: 4,
  [CompressionCodec.Gzip]: 6,
  [CompressionCodec.Deflate]: 6,
  [CompressionCodec.Zstd]: 3,
} satisfies Record<CompressionCodec, number>;

/**
 * Valid integer level range per codec — the single source of truth the options schema
 * validates against. `satisfies Record<CompressionCodec, …>` makes a codec added to the
 * enum without a range here a compile error. gzip/deflate follow zlib (1–9), br follows
 * BROTLI_PARAM_QUALITY (0–11), zstd is capped at 19 by the RFC 9659 8 MB HTTP window.
 */
export const LEVEL_RANGES = {
  [CompressionCodec.Gzip]: { min: 1, max: 9 },
  [CompressionCodec.Br]: { min: 0, max: 11 },
  [CompressionCodec.Deflate]: { min: 1, max: 9 },
  [CompressionCodec.Zstd]: { min: 1, max: 19 },
} satisfies Record<CompressionCodec, { min: number; max: number }>;

const COMPRESSIBLE_PATTERN =
  /^text\/(?!event-stream\b)|^application\/(?:json|javascript|xml|xhtml\+xml|ecmascript|graphql|ld\+json|manifest\+json|vnd\.api\+json|.+\+xml|.+\+json)|^image\/svg\+xml/i;

export const DEFAULT_FILTER = (contentType: string): boolean =>
  COMPRESSIBLE_PATTERN.test(contentType);
