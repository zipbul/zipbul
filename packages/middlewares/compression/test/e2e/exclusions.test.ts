import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { bootCompressionApp, LARGE_TEXT, setupSilentLogger } from './helpers';
import type { CompressionTestApp } from './helpers';

describe('e2e exclusions (real server 제외 경로)', () => {
  setupSilentLogger();

  let app: CompressionTestApp;

  beforeAll(async () => {
    app = await bootCompressionApp({
      text: (ctx) => {
        ctx.response.setContentType('text/plain');
        return LARGE_TEXT;
      },
      empty: (ctx) => {
        ctx.response.setStatus(204);
        return null;
      },
      keep: (ctx) => {
        ctx.response.setContentType('text/plain');
        ctx.response.setHeader('cache-control', 'no-transform');
        return LARGE_TEXT;
      },
      preencoded: (ctx) => {
        ctx.response.setContentType('text/plain');
        ctx.response.setHeader('content-encoding', 'gzip');
        return Bun.gzipSync(new TextEncoder().encode(LARGE_TEXT));
      },
      partial: (ctx) => {
        ctx.response.setStatus(206);
        ctx.response.setContentType('text/plain');
        ctx.response.setHeader('content-range', `bytes 0-1023/${LARGE_TEXT.length}`);
        return LARGE_TEXT.slice(0, 1024);
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('[§3.2.1] E2E-EX-01 real HEAD 요청 → content 없음·압축 부작용 없음', async () => {
    const res = await app.fetchRaw('/text', { method: 'HEAD', headers: { 'accept-encoding': 'gzip' } });
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.byteLength).toBe(0);
    expect(res.headers.get('content-encoding')).toBeNull();
  });

  it('[§3.1.1] E2E-EX-02 real 204 핸들러 → 무압축·무Vary', async () => {
    const res = await app.fetchRaw('/empty', { headers: { 'accept-encoding': 'gzip' } });
    expect(res.status).toBe(204);
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(res.headers.get('vary')).toBeNull();
  });

  it('[§3.4.1] E2E-EX-03 no-transform 응답 → wire 무압축', async () => {
    const res = await app.fetchRaw('/keep', { headers: { 'accept-encoding': 'gzip' } });
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(await res.text()).toBe(LARGE_TEXT);
  });

  it('[§2.4.1] E2E-EX-04 사전 인코딩된 응답 → 이중 압축 없음', async () => {
    const res = await app.fetchRaw('/preencoded', { headers: { 'accept-encoding': 'gzip' } });
    expect(res.headers.get('content-encoding')).toBe('gzip');
    const bytes = new Uint8Array(await res.arrayBuffer());
    // 1회 해제로 원문 — 이중 압축이면 gunzip 결과가 여전히 gzip 스트림
    expect(Buffer.from(Bun.gunzipSync(bytes)).toString()).toBe(LARGE_TEXT);
  });

  it('[§3.3.2] E2E-EX-05 핸들러 생성 206(+Content-Range) → wire 무압축', async () => {
    const res = await app.fetchRaw('/partial', { headers: { 'accept-encoding': 'gzip' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(await res.text()).toBe(LARGE_TEXT.slice(0, 1024));
  });
});
