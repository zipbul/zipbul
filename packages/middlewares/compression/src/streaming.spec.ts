import { describe, expect, it } from 'bun:test';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';

import { STREAM_FORMATS, compressStream } from './streaming';
import { CompressionCodec } from './enums';

function sourceOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let off = 0;
  for (const c of chunks) { total.set(c, off); off += c.byteLength; }
  return total;
}

const TEXT = 'unit streaming payload '.repeat(64);

describe('STREAM_FORMATS', () => {
  it('should map gzip to the WHATWG "gzip" format', () => {
    expect(STREAM_FORMATS[CompressionCodec.Gzip]).toBe('gzip');
  });

  it('should map deflate to the WHATWG "deflate" (zlib-wrapped) format, not deflate-raw', () => {
    expect(STREAM_FORMATS[CompressionCodec.Deflate]).toBe('deflate');
  });

  it('should map br to the WHATWG "brotli" format', () => {
    expect(STREAM_FORMATS[CompressionCodec.Br]).toBe('brotli');
  });

  it('should map zstd to the Bun runtime-extension "zstd" format', () => {
    expect(STREAM_FORMATS[CompressionCodec.Zstd]).toBe('zstd');
  });
});

describe('compressStream', () => {
  it('should produce a gzip stream that decompresses to the source content', async () => {
    const out = await drain(compressStream(sourceOf(TEXT), CompressionCodec.Gzip));
    expect(out[0]).toBe(0x1f);
    expect(out[1]).toBe(0x8b);
    expect(gunzipSync(out).toString('utf-8')).toBe(TEXT);
  });

  it('should produce a zlib-wrapped deflate stream (RFC 1950)', async () => {
    const out = await drain(compressStream(sourceOf(TEXT), CompressionCodec.Deflate));
    expect((out[0] ?? 0) & 0x0f).toBe(8);
    expect(inflateSync(out).toString('utf-8')).toBe(TEXT);
  });

  it('should produce a brotli stream that decompresses to the source content', async () => {
    const out = await drain(compressStream(sourceOf(TEXT), CompressionCodec.Br));
    expect(brotliDecompressSync(out).toString('utf-8')).toBe(TEXT);
  });

  it('should produce a zstd stream that decompresses to the source content', async () => {
    const out = await drain(compressStream(sourceOf(TEXT), CompressionCodec.Zstd));
    expect(new TextDecoder().decode(Bun.zstdDecompressSync(Buffer.from(out)))).toBe(TEXT);
  });

  it('should handle an empty source stream', async () => {
    const out = await drain(compressStream(sourceOf(), CompressionCodec.Gzip));
    expect(gunzipSync(out).byteLength).toBe(0);
  });

  it('should preserve multi-chunk content in order', async () => {
    const out = await drain(compressStream(sourceOf('a|', 'b|', 'c'), CompressionCodec.Gzip));
    expect(gunzipSync(out).toString('utf-8')).toBe('a|b|c');
  });

  it('should propagate a source stream error to the consumer', async () => {
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'));
        controller.error(new Error('boom'));
      },
    });
    await expect(drain(compressStream(failing, CompressionCodec.Gzip))).rejects.toThrow();
  });

  it('should lock the source stream and return an unlocked output stream', () => {
    const source = sourceOf(TEXT);
    const out = compressStream(source, CompressionCodec.Gzip);
    expect(source.locked).toBe(true);
    expect(out.locked).toBe(false);
  });
});
