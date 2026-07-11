import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { gunzipSync } from 'node:zlib';

import { bootCompressionApp, LARGE_TEXT, setupSilentLogger } from './helpers';
import type { CompressionTestApp } from './helpers';

describe('e2e wire-headers', () => {
  setupSilentLogger();

  let app: CompressionTestApp;

  beforeAll(async () => {
    app = await bootCompressionApp({
      text: (ctx) => {
        ctx.response.setContentType('text/plain');
        return LARGE_TEXT;
      },
      tagged: (ctx) => {
        ctx.response.setContentType('text/plain');
        ctx.response.setHeader('etag', '"wire-abc"');
        return LARGE_TEXT;
      },
      binary: (ctx) => {
        ctx.response.setContentType('application/octet-stream');
        return new TextEncoder().encode(LARGE_TEXT);
      },
      multivary: (ctx) => {
        ctx.response.setContentType('text/plain');
        ctx.response.appendHeader('vary', 'Origin');
        ctx.response.appendHeader('vary', '*');
        return LARGE_TEXT;
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('[§2.1.1] E2E-WH-01 wire상 Content-Encoding: gzip 실존', async () => {
    const res = await app.fetchRaw('/text', { headers: { 'accept-encoding': 'gzip' } });
    expect(res.headers.get('content-encoding')).toBe('gzip');
  });

  it('[§2.3.3] E2E-WH-02 wire상 CL = 실제 전송 압축 바이트 수', async () => {
    const res = await app.fetchRaw('/text', { headers: { 'accept-encoding': 'gzip' } });
    const bytes = new Uint8Array(await res.arrayBuffer());
    const cl = res.headers.get('content-length');
    expect(cl).not.toBeNull();
    expect(Number.parseInt(cl!, 10)).toBe(bytes.byteLength);
    // 그 바이트가 곧 유효한 gzip 스트림
    expect(gunzipSync(bytes).toString('utf-8')).toBe(LARGE_TEXT);
  });

  it('[§4.1.1] E2E-WH-03 wire상 Vary: Accept-Encoding 실존', async () => {
    const res = await app.fetchRaw('/text', { headers: { 'accept-encoding': 'gzip' } });
    const vary = res.headers.get('vary');
    expect(vary).not.toBeNull();
    expect(vary!.toLowerCase()).toContain('accept-encoding');
  });

  it('[§2.3.2] E2E-WH-04 무압축 응답: CE 부재·원본 CL 정확', async () => {
    // application/octet-stream은 기본 filter 거부 → 무압축
    const res = await app.fetchRaw('/binary', { headers: { 'accept-encoding': 'gzip' } });
    expect(res.headers.get('content-encoding')).toBeNull();
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.byteLength).toBe(new TextEncoder().encode(LARGE_TEXT).byteLength);
    expect(res.headers.get('content-length')).toBe(String(bytes.byteLength));
  });

  it('[§2.3.3] E2E-WH-05 압축 응답의 wire CL 존재·값 정확 (framing 자체는 §8.2.1 범위 밖)', async () => {
    const res = await app.fetchRaw('/text', { headers: { 'accept-encoding': 'br' } });
    const bytes = new Uint8Array(await res.arrayBuffer());
    const cl = res.headers.get('content-length');
    expect(cl).not.toBeNull();
    expect(Number.parseInt(cl!, 10)).toBe(bytes.byteLength);
  });

  it('[§4.1.1·§4.1.2] E2E-WH-07 다중 Vary field line(*, Origin 분리 append) → accept-encoding 추가 없음', async () => {
    // 실제 Headers.append 시맨틱: 분리 저장된 Vary 라인이 comma-join으로 판정되어야 한다
    const res = await app.fetchRaw('/multivary', { headers: { 'accept-encoding': 'gzip' } });
    expect(res.headers.get('content-encoding')).toBe('gzip');
    const vary = res.headers.get('vary') ?? '';
    const tokens = vary.split(',').map((t) => t.trim().toLowerCase());
    expect(tokens).toContain('*');
    expect(tokens).not.toContain('accept-encoding');
  });

  it('[§4.2.2] E2E-WH-06 핸들러 설정 ETag → wire상 W/ 접두 실존', async () => {
    const res = await app.fetchRaw('/tagged', { headers: { 'accept-encoding': 'gzip' } });
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(res.headers.get('etag')).toBe('W/"wire-abc"');
  });
});
