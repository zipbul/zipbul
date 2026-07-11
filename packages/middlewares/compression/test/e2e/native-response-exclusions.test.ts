import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { bootCompressionApp, setupSilentLogger } from './helpers';
import type { CompressionTestApp } from './helpers';

const HTML = '<p>native response payload</p> '.repeat(2000); // compressible, > threshold

describe('REPRO — native Response path asymmetries', () => {
  setupSilentLogger();
  let app: CompressionTestApp;

  beforeAll(async () => {
    app = await bootCompressionApp({
      // F1: handler returns a raw 206 Partial Content with Content-Range.
      range206: () => new Response(HTML, {
        status: 206,
        headers: { 'content-type': 'text/html', 'content-range': 'bytes 0-99/500' },
      }),
      // F2: handler returns a raw Response with Cache-Control: no-transform.
      noTransform: () => new Response(HTML, {
        headers: { 'content-type': 'text/html', 'cache-control': 'no-transform' },
      }),
      // F3: handler returns a raw Response with two Set-Cookie headers.
      multiCookie: () => new Response(HTML, {
        headers: [['set-cookie', 'a=1'], ['set-cookie', 'b=2'], ['content-type', 'text/html']],
      }),
    });
  });

  afterAll(async () => { await app.close(); });

  it('F1: a native 206 Partial Content must NOT be compressed', async () => {
    const raw = await app.fetchRaw('/range206', { headers: { 'accept-encoding': 'gzip' } });
    console.log('[F1] status =', raw.status, '| content-encoding =', JSON.stringify(raw.headers.get('content-encoding')), '| content-range =', JSON.stringify(raw.headers.get('content-range')));
    expect(raw.headers.get('content-encoding')).toBeNull(); // §15.3.7: no post-encoding on a computed range
  });

  it('F2: a native Cache-Control: no-transform must NOT be compressed', async () => {
    const raw = await app.fetchRaw('/noTransform', { headers: { 'accept-encoding': 'gzip' } });
    console.log('[F2] content-encoding =', JSON.stringify(raw.headers.get('content-encoding')));
    expect(raw.headers.get('content-encoding')).toBeNull(); // §7.7 / §5.2.2.6 no-transform
  });

  it('F3: both Set-Cookie headers must survive stream compression', async () => {
    const raw = await app.fetchRaw('/multiCookie', { headers: { 'accept-encoding': 'gzip' } });
    const cookies = raw.headers.getSetCookie();
    console.log('[F3] content-encoding =', JSON.stringify(raw.headers.get('content-encoding')), '| set-cookie =', JSON.stringify(cookies));
    expect(raw.headers.get('content-encoding')).toBe('gzip'); // it is compressed
    expect(cookies).toEqual(['a=1', 'b=2']); // both must survive
  });
});
