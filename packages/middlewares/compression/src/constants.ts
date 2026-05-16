import { CompressionCodec } from './enums.ts';

export const DEFAULT_THRESHOLD = 1024;

export const DEFAULT_ENCODINGS: CompressionCodec[] = [
  CompressionCodec.Br,
  CompressionCodec.Gzip,
];

export const DEFAULT_LEVELS = {
  [CompressionCodec.Br]: 4,
  [CompressionCodec.Gzip]: 6,
  [CompressionCodec.Deflate]: 6,
  [CompressionCodec.Zstd]: 3,
} satisfies Record<CompressionCodec, number>;

const COMPRESSIBLE_PATTERN =
  /^text\/(?!event-stream\b)|^application\/(?:json|javascript|xml|xhtml\+xml|ecmascript|graphql|ld\+json|manifest\+json|vnd\.api\+json|.+\+xml|.+\+json)|^image\/svg\+xml/i;

export const DEFAULT_FILTER = (contentType: string): boolean =>
  COMPRESSIBLE_PATTERN.test(contentType);
