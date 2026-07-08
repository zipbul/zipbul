import { afterAll, describe, expect, it } from 'bun:test';
import { defineMiddleware } from '@zipbul/common';
import { HttpContext } from '@zipbul/http-adapter';

import { bootCompressionApp, LARGE_OBJ, LARGE_TEXT, setupSilentLogger } from './helpers';
import type { CompressionTestApp } from './helpers';

describe('e2e pipeline (파이프라인 계약)', () => {
  setupSilentLogger();

  const apps: CompressionTestApp[] = [];
  afterAll(async () => {
    for (const app of apps) {
      await app.close();
    }
  });

  async function boot(...args: Parameters<typeof bootCompressionApp>) {
    const app = await bootCompressionApp(...args);
    apps.push(app);
    return app;
  }

  it('E2E-PL-01 핸들러 object 반환(CT 미설정) → serialize 선행 CT 추론 → filter 통과 → 압축 (NOTICE 전제 3-1 증명)', async () => {
    const app = await boot({
      inferred: () => LARGE_OBJ, // CT를 설정하지 않는다 — Serialize 스텝이 추론해야 함
    });
    const res = await app.fetchRaw('/inferred', { headers: { 'accept-encoding': 'gzip' } });
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('content-encoding')).toBe('gzip');
    const round = await app.fetch('/inferred', { headers: { 'accept-encoding': 'gzip' } });
    expect(await round.json()).toEqual(LARGE_OBJ);
  });

  it('E2E-PL-02 핸들러 string + CT 명시 → 압축', async () => {
    const app = await boot({
      text: (ctx) => {
        ctx.response.setContentType('text/plain');
        return LARGE_TEXT;
      },
    });
    const res = await app.fetchRaw('/text', { headers: { 'accept-encoding': 'gzip' } });
    expect(res.headers.get('content-encoding')).toBe('gzip');
  });

  it('E2E-PL-03 타 미들웨어(헤더 조작) 선행 공존 → 상호 간섭 없음', async () => {
    const stamp = defineMiddleware([], () => (ctx) => {
      const http = ctx.to(HttpContext);
      http.response.setHeader('x-prior-stamp', 'ok');
    });
    const app = await boot(
      {
        text: (ctx) => {
          ctx.response.setContentType('text/plain');
          return LARGE_TEXT;
        },
      },
      undefined,
      { priorMiddlewares: [stamp] },
    );
    const res = await app.fetchRaw('/text', { headers: { 'accept-encoding': 'gzip' } });
    expect(res.headers.get('x-prior-stamp')).toBe('ok');
    expect(res.headers.get('content-encoding')).toBe('gzip');
  });

  it('[§9.1.1] E2E-PL-04 미들웨어 미장착 앱 → 무압축·표준 적합 응답 (NOTICE §2 증명)', async () => {
    const app = await boot(
      {
        text: (ctx) => {
          ctx.response.setContentType('text/plain');
          return LARGE_TEXT;
        },
      },
      undefined,
      { withoutCompression: true },
    );
    const res = await app.fetchRaw('/text', { headers: { 'accept-encoding': 'gzip' } });
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(await res.text()).toBe(LARGE_TEXT);
  });

  it('E2E-PL-05 동일 앱 연속 상이 AE 요청 → 각각 독립 협상(캐시 오염 없음)', async () => {
    const app = await boot({
      text: (ctx) => {
        ctx.response.setContentType('text/plain');
        return LARGE_TEXT;
      },
    });
    const gz = await app.fetchRaw('/text', { headers: { 'accept-encoding': 'gzip' } });
    const br = await app.fetchRaw('/text', { headers: { 'accept-encoding': 'br' } });
    const none = await app.fetchRaw('/text', { headers: { 'accept-encoding': 'identity' } });
    expect(gz.headers.get('content-encoding')).toBe('gzip');
    expect(br.headers.get('content-encoding')).toBe('br');
    expect(none.headers.get('content-encoding')).toBeNull();
  });

  it('E2E-PL-06 핸들러 throw → 오류 응답 경로에서 압축 미들웨어 무해 통과', async () => {
    const app = await boot({
      boom: () => {
        throw new Error('handler exploded');
      },
    });
    const res = await app.fetch('/boom', { headers: { 'accept-encoding': 'gzip' } });
    expect(res.status).toBe(500);
    // 오류 body가 온전한 JSON으로 도착 (압축 미들웨어가 손상시키지 않음)
    const parsed = await res.json() as { status: number };
    expect(parsed.status).toBe(500);
  });

  it('E2E-PL-07 302 redirect(+body) → wire에 고아 CE·coded metadata 없음(일관성)', async () => {
    const app = await boot({
      moved: (ctx) => {
        ctx.response.redirect('/elsewhere');
        ctx.response.setStatus(302);
        ctx.response.setContentType('text/plain');
        return LARGE_TEXT;
      },
    });
    const res = await app.fetchRaw('/moved', { redirect: 'manual', headers: { 'accept-encoding': 'gzip' } });
    expect(res.status).toBe(302);
    // 어댑터가 redirect body를 제거하므로 body는 비어 있고 고아 CE도 남지 않는다
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.byteLength).toBe(0);
    expect(res.headers.get('content-encoding')).toBeNull();
  });
});
