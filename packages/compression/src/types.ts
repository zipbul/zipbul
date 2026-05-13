import type { CompressionCodec } from './enums.ts';

export type ResolvedCompressionOptions = {
  encodings: CompressionCodec[];
  threshold: number;
  filter: (contentType: string) => boolean;
  level: Record<CompressionCodec, number>;
};

export type BufferCompressFn = (data: Uint8Array, level: number) => Uint8Array;
