import { describe, expect, it } from 'bun:test';

import { readBoundedStream } from './bounded-read';

function streamFromChunks(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

describe('readBoundedStream', () => {
  it('returns the full text when below the cap', async () => {
    const text = 'hello';
    const stream = streamFromChunks([new TextEncoder().encode(text)]);
    expect(await readBoundedStream(stream, 1024)).toBe(text);
  });

  it('truncates and tags when input exceeds the cap', async () => {
    const big = new Uint8Array(8 * 1024).fill(0x61); // 8KB of 'a'
    const stream = streamFromChunks([big]);
    const out = await readBoundedStream(stream, 4 * 1024);
    expect(out.startsWith('a'.repeat(4 * 1024))).toBe(true);
    expect(out).toMatch(/\.\.\.\[output truncated at 4096 bytes]$/);
  });

  it('keeps draining the stream after the cap so the producer is not blocked', async () => {
    let drained = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 4; i++) {
          controller.enqueue(new Uint8Array(2 * 1024).fill(0x62));
          drained++;
        }
        controller.close();
      },
    });
    const out = await readBoundedStream(stream, 1024);
    expect(out.length).toBeLessThanOrEqual(1024 + 64); // payload + truncation tag
    expect(drained).toBe(4);
  });

  it('handles empty stream', async () => {
    const stream = streamFromChunks([]);
    expect(await readBoundedStream(stream, 1024)).toBe('');
  });
});
