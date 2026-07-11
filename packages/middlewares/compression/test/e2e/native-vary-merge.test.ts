import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { bootCompressionApp, setupSilentLogger } from './helpers';
import type { CompressionTestApp } from './helpers';

function streamOf(t: string): ReadableStream<Uint8Array> {
  const b = new TextEncoder().encode(t);
  return new ReadableStream({ pull(c) { c.enqueue(b); c.close(); } });
}

describe('e2e native-Response Vary merge on non-compression paths (RFC 9110 §12.5.5)', () => {
  setupSilentLogger();
  let app: CompressionTestApp;
  beforeAll(async () => {
    app = await bootCompressionApp({
      // raw Response carrying its own Vary; not compressed on these requests.
      nStream: () => new Response(streamOf('x'.repeat(3000)), {
        headers: { 'content-type': 'text/html', 'vary': 'Accept-Language' },
      }),
    });
  });
  afterAll(async () => { await app.close(); });

  it('F4-01 no-AE request keeps handler Vary AND adds Accept-Encoding', async () => {
    const r = await app.fetchRaw('/nStream', {});
    const vary = (r.headers.get('vary') ?? '').toLowerCase();
    expect(vary).toContain('accept-language');
    expect(vary).toContain('accept-encoding');
  });

  it('F4-02 identity-negotiated request keeps both Vary tokens', async () => {
    const r = await app.fetchRaw('/nStream', { headers: { 'accept-encoding': 'identity' } });
    const vary = (r.headers.get('vary') ?? '').toLowerCase();
    expect(vary).toContain('accept-language');
    expect(vary).toContain('accept-encoding');
  });
});
