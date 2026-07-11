import { describe, expect, it } from 'bun:test';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';

import { BUFFER_COMPRESSORS } from './compressors';
import { CompressionCodec } from './enums';

// Compressors are pure functions — assert real compress→decompress OUTCOMES and the
// on-the-wire byte format, not call patterns against mocked codecs.
const text = 'The quick brown fox jumps over the lazy dog. '.repeat(64);
const data = new TextEncoder().encode(text);
const roundtrips = (out: Uint8Array, decode: (b: Uint8Array) => Uint8Array | Buffer) =>
  Buffer.from(decode(out)).toString() === text;

describe('BUFFER_COMPRESSORS', () => {
  it('gzip output is a valid RFC 1952 gzip stream that decompresses to the input', () => {
    const out = BUFFER_COMPRESSORS[CompressionCodec.Gzip](data, 6);
    expect(out[0]).toBe(0x1f); // gzip ID1
    expect(out[1]).toBe(0x8b); // gzip ID2
    expect(roundtrips(out, gunzipSync)).toBe(true);
  });

  it('deflate output is zlib-WRAPPED (RFC 1950), not raw deflate, and decompresses to the input', () => {
    const out = BUFFER_COMPRESSORS[CompressionCodec.Deflate](data, 6);
    // RFC 1950 CMF: low nibble 8 = deflate; 0x78 is the common zlib header. A raw RFC 1951
    // stream (Bun.deflateSync) would NOT be inflate-able by the zlib-wrapped inflateSync.
    expect(out[0]! & 0x0f).toBe(0x08);
    expect(((out[0]! << 8) | out[1]!) % 31).toBe(0); // FCHECK: CMF*256+FLG divisible by 31
    expect(roundtrips(out, inflateSync)).toBe(true);
  });

  it('brotli output decompresses to the input', () => {
    const out = BUFFER_COMPRESSORS[CompressionCodec.Br](data, 5);
    expect(roundtrips(out, brotliDecompressSync)).toBe(true);
  });

  it('zstd output decompresses to the input', () => {
    const out = BUFFER_COMPRESSORS[CompressionCodec.Zstd](data, 6);
    expect(roundtrips(out, (b) => Bun.zstdDecompressSync(new Uint8Array(b)))).toBe(true);
  });

  it('every codec round-trips empty input to empty output', () => {
    const empty = new Uint8Array(0);
    expect(gunzipSync(BUFFER_COMPRESSORS[CompressionCodec.Gzip](empty, 6)).length).toBe(0);
    expect(inflateSync(BUFFER_COMPRESSORS[CompressionCodec.Deflate](empty, 6)).length).toBe(0);
    expect(brotliDecompressSync(BUFFER_COMPRESSORS[CompressionCodec.Br](empty, 5)).length).toBe(0);
    expect(Bun.zstdDecompressSync(new Uint8Array(BUFFER_COMPRESSORS[CompressionCodec.Zstd](empty, 6))).length).toBe(0);
  });

  it('a higher compression level yields a smaller gzip output for compressible input', () => {
    const low = BUFFER_COMPRESSORS[CompressionCodec.Gzip](data, 1);
    const high = BUFFER_COMPRESSORS[CompressionCodec.Gzip](data, 9);
    expect(high.byteLength).toBeLessThanOrEqual(low.byteLength);
    expect(roundtrips(low, gunzipSync)).toBe(true);
    expect(roundtrips(high, gunzipSync)).toBe(true);
  });

  it('brotli honours its quality level (higher quality is not larger)', () => {
    const low = BUFFER_COMPRESSORS[CompressionCodec.Br](data, 1);
    const high = BUFFER_COMPRESSORS[CompressionCodec.Br](data, 11);
    expect(high.byteLength).toBeLessThanOrEqual(low.byteLength);
    expect(roundtrips(high, brotliDecompressSync)).toBe(true);
  });

  it('is deterministic: same input and level produce identical bytes', () => {
    const a = BUFFER_COMPRESSORS[CompressionCodec.Gzip](data, 6);
    const b = BUFFER_COMPRESSORS[CompressionCodec.Gzip](data, 6);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
