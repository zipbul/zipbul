import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { bootCompressionApp, setupSilentLogger } from './helpers';
import type { CompressionTestApp } from './helpers';

const STREAM_TEXT = 'e2e stream chunk payload. '.repeat(2000); // ~52KB

function chunkedStream(text: string, chunkSize = 4096): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

describe('e2e streaming', () => {
  setupSilentLogger();

  let app: CompressionTestApp;

  beforeAll(async () => {
    app = await bootCompressionApp({
      stream: (ctx) => {
        ctx.response.setContentType('text/plain');
        ctx.response.setBody(chunkedStream(STREAM_TEXT));
        return undefined;
      },
      sse: (ctx) => {
        ctx.response.setContentType('text/event-stream');
        ctx.response.setBody(chunkedStream('data: hello\n\ndata: world\n\n'));
        return undefined;
      },
      // 핸들러가 raw Response를 반환 — CT·커스텀 헤더가 native Response 자체에 있다
      rawresponse: () => new Response(chunkedStream(STREAM_TEXT), {
        headers: { 'content-type': 'application/json', 'x-custom': 'keep-me' },
      }),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('E2E-ST-01 핸들러 스트림 응답 → wire CE gzip + 클라이언트 해제 정합', async () => {
    const raw = await app.fetchRaw('/stream', { headers: { 'accept-encoding': 'gzip' } });
    expect(raw.status).toBe(200);
    expect(raw.headers.get('content-encoding')).toBe('gzip');
    const bytes = new Uint8Array(await raw.arrayBuffer());
    expect(bytes[0]).toBe(0x1f);
    expect(bytes[1]).toBe(0x8b);

    const res = await app.fetch('/stream', { headers: { 'accept-encoding': 'gzip' } });
    expect(await res.text()).toBe(STREAM_TEXT);
  });

  it('E2E-ST-02 SSE(text/event-stream) → 무압축 실측', async () => {
    const res = await app.fetchRaw('/sse', { headers: { 'accept-encoding': 'gzip' } });
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(await res.text()).toBe('data: hello\n\ndata: world\n\n');
  });

  it('[§2.3.1] E2E-ST-05 raw Response(압축가능 CT+커스텀 헤더) 압축 시 native 헤더 보존', async () => {
    const raw = await app.fetchRaw('/rawresponse', { headers: { 'accept-encoding': 'gzip' } });
    expect(raw.status).toBe(200);
    // 압축은 적용되되
    expect(raw.headers.get('content-encoding')).toBe('gzip');
    // native Response 자체의 CT·커스텀 헤더는 소실되지 않아야 한다
    expect(raw.headers.get('content-type')).toContain('application/json');
    expect(raw.headers.get('x-custom')).toBe('keep-me');
    // 라운드트립 정합
    const res = await app.fetch('/rawresponse', { headers: { 'accept-encoding': 'gzip' } });
    expect(await res.text()).toBe(STREAM_TEXT);
  });

  it('E2E-ST-03 대형 스트림 → CL 부재(길이 미지) + 원문 정합', async () => {
    const raw = await app.fetchRaw('/stream', { headers: { 'accept-encoding': 'gzip' } });
    expect(raw.headers.get('content-length')).toBeNull();
    const res = await app.fetch('/stream', { headers: { 'accept-encoding': 'gzip' } });
    expect((await res.text()).length).toBe(STREAM_TEXT.length);
  });

  it('E2E-ST-04 클라이언트 조기 종료 → 서버는 후속 요청을 정상 처리', async () => {
    const controller = new AbortController();
    const pending = app.fetch('/stream', {
      headers: { 'accept-encoding': 'gzip' },
      signal: controller.signal,
    });
    controller.abort();
    await pending.catch(() => { /* abort는 기대된 실패 */ });

    // 서버 생존 확인 — 동일 라우트 재요청이 완전한 응답을 반환해야 한다
    const res = await app.fetch('/stream', { headers: { 'accept-encoding': 'gzip' } });
    expect(await res.text()).toBe(STREAM_TEXT);
  });
});
