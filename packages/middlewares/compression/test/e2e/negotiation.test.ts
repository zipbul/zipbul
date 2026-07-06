import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { CompressionCodec } from '../../src/enums';
import { bootCompressionApp, LARGE_TEXT, rawRequest, setupSilentLogger } from './helpers';
import type { CompressionTestApp } from './helpers';

describe('e2e negotiation', () => {
  setupSilentLogger();

  let app: CompressionTestApp;

  beforeAll(async () => {
    app = await bootCompressionApp(
      {
        text: (ctx) => {
          ctx.response.setContentType('text/plain');
          return LARGE_TEXT;
        },
      },
      { encodings: [CompressionCodec.Br, CompressionCodec.Gzip] },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('[§1.1.6] E2E-NG-01 실 AE 헤더 서버 순서 협상 (gzip, br → 서버 선호 br)', async () => {
    const res = await app.fetchRaw('/text', { headers: { 'accept-encoding': 'gzip, br' } });
    expect(res.headers.get('content-encoding')).toBe('br');
  });

  it('[§1.1.7·§1.1.8] E2E-NG-02 identity;q=0 + 무매칭 → wire 406, identity 미송출', async () => {
    // 서버는 br/gzip 지원 — 클라이언트가 둘 다 배제하고 identity도 배제
    const res = await app.fetchRaw('/text', {
      headers: { 'accept-encoding': 'identity;q=0, br;q=0, gzip;q=0' },
    });
    expect(res.status).toBe(406);
    expect(res.headers.get('content-encoding')).toBeNull();
    expect((await res.text()).includes('quick brown fox')).toBe(false);
  });

  it('[§9.1.2] E2E-NG-03 빈 AE 실요청 → 무압축', async () => {
    const res = await app.fetchRaw('/text', { headers: { 'accept-encoding': '' } });
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(await res.text()).toBe(LARGE_TEXT);
  });

  it('[§1] E2E-NG-04 브라우저 실전 AE 문자열 정상 협상', async () => {
    const res = await app.fetchRaw('/text', { headers: { 'accept-encoding': 'gzip, deflate, br, zstd' } });
    expect(res.headers.get('content-encoding')).toBe('br');
  });

  it('[§1.1.3·§1.1.6] E2E-NG-05 raw 소켓 다중 AE field line → 단일 comma-join과 동일 협상', async () => {
    const multi = await rawRequest(app.port, '/text', [
      'Accept-Encoding: gzip;q=0.9',
      'Accept-Encoding: br;q=0.4',
    ]);
    const single = await rawRequest(app.port, '/text', [
      'Accept-Encoding: gzip;q=0.9, br;q=0.4',
    ]);
    expect(multi.status).toBe(200);
    expect(single.status).toBe(200);
    expect(multi.headers['content-encoding']).toEqual(single.headers['content-encoding']);
    expect(single.headers['content-encoding']?.[0]).toBe('gzip');
  });

  it('[§1.1.1·§9.1.2] E2E-NG: AE 헤더 완전 부재(raw) → 무압축(정책)', async () => {
    const res = await rawRequest(app.port, '/text', []);
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(new TextDecoder().decode(res.body)).toBe(LARGE_TEXT);
  });
});
