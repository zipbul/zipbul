import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { bootCompressionApp, setupSilentLogger } from './helpers';
import type { CompressionTestApp } from './helpers';

const HTML = '<p>vary preservation payload</p> '.repeat(2000); // ~66KB compressible text/html

function chunkedStream(text: string, chunkSize = 4096): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) { controller.close(); return; }
      controller.enqueue(bytes.subarray(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

describe('e2e stream-path Vary preservation (RFC 9110 §12.5.5)', () => {
  setupSilentLogger();
  let app: CompressionTestApp;

  beforeAll(async () => {
    app = await bootCompressionApp({
      // Handler returns a raw Response whose own Vary COLLIDES with the
      // Vary: Accept-Encoding the middleware appends during compression.
      varyLang: () => new Response(chunkedStream(HTML), {
        headers: { 'content-type': 'text/html', 'vary': 'Accept-Language' },
      }),
    });
  });

  afterAll(async () => { await app.close(); });

  it('E2E-VARY-01 compressed stream must keep the handler-set Vary AND add Accept-Encoding', async () => {
    const raw = await app.fetchRaw('/varyLang', { headers: { 'accept-encoding': 'gzip' } });
    expect(raw.status).toBe(200);
    expect(raw.headers.get('content-encoding')).toBe('gzip');

    const vary = (raw.headers.get('vary') ?? '').toLowerCase();
    // Both selecting headers must be advertised — dropping Accept-Language poisons shared caches.
    expect(vary).toContain('accept-language');
    expect(vary).toContain('accept-encoding');
  });
});
