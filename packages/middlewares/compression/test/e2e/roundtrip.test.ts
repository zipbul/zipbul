import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';

import { CompressionCodec } from '../../src/enums';
import { bootCompressionApp, LARGE_OBJ, LARGE_TEXT, setupSilentLogger } from './helpers';
import type { CompressionTestApp } from './helpers';

describe('e2e roundtrip', () => {
  setupSilentLogger();

  let app: CompressionTestApp;

  beforeAll(async () => {
    app = await bootCompressionApp(
      {
        json: (ctx) => {
          ctx.response.setContentType('application/json');
          return LARGE_OBJ;
        },
        text: (ctx) => {
          ctx.response.setContentType('text/plain');
          return LARGE_TEXT;
        },
        unicode: (ctx) => {
          ctx.response.setContentType('text/plain');
          return '한글과 émoji 🗜️ — '.repeat(500);
        },
        big: (ctx) => {
          ctx.response.setContentType('text/plain');
          return 'payload-'.repeat(150_000); // ~1.2MB
        },
      },
      { encodings: [CompressionCodec.Br, CompressionCodec.Gzip, CompressionCodec.Deflate, CompressionCodec.Zstd] },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  // no-op 미들웨어로도 통과하는 동어반복을 막기 위해, 각 코덱은
  // (1) wire CE 헤더 + 포맷 증거(매직 바이트/직접 해제)와 (2) 클라이언트 자동 해제 정합을 모두 단언한다.

  it('[§5.1.1] E2E-RT-01 gzip: wire CE·매직 바이트 + 실클라이언트 해제 정합', async () => {
    const raw = await app.fetchRaw('/text', { headers: { 'accept-encoding': 'gzip' } });
    expect(raw.headers.get('content-encoding')).toBe('gzip');
    const bytes = new Uint8Array(await raw.arrayBuffer());
    expect(bytes[0]).toBe(0x1f);
    expect(bytes[1]).toBe(0x8b);
    expect(gunzipSync(bytes).toString('utf-8')).toBe(LARGE_TEXT);

    const res = await app.fetch('/text', { headers: { 'accept-encoding': 'gzip' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(LARGE_TEXT);
  });

  it('[§5.3.1] E2E-RT-02 br: wire CE + 직접 해제 + 클라이언트 해제 정합', async () => {
    const raw = await app.fetchRaw('/text', { headers: { 'accept-encoding': 'br' } });
    expect(raw.headers.get('content-encoding')).toBe('br');
    const bytes = new Uint8Array(await raw.arrayBuffer());
    expect(brotliDecompressSync(bytes).toString('utf-8')).toBe(LARGE_TEXT);

    const res = await app.fetch('/text', { headers: { 'accept-encoding': 'br' } });
    expect(await res.text()).toBe(LARGE_TEXT);
  });

  it('[§5.2.1] E2E-RT-03 deflate: wire CE·zlib CMF + 직접 해제 정합', async () => {
    const raw = await app.fetchRaw('/text', { headers: { 'accept-encoding': 'deflate' } });
    expect(raw.headers.get('content-encoding')).toBe('deflate');
    const bytes = new Uint8Array(await raw.arrayBuffer());
    expect((bytes[0] ?? 0) & 0x0f).toBe(8); // RFC 1950 zlib wrapper
    expect(inflateSync(bytes).toString('utf-8')).toBe(LARGE_TEXT);
  });

  it('[§5.4.1] E2E-RT-04 zstd: wire CE·매직 바이트 + 직접 해제 + 클라이언트 해제 정합', async () => {
    const raw = await app.fetchRaw('/text', { headers: { 'accept-encoding': 'zstd' } });
    expect(raw.headers.get('content-encoding')).toBe('zstd');
    const bytes = new Uint8Array(await raw.arrayBuffer());
    expect(bytes[0]).toBe(0x28);
    expect(bytes[1]).toBe(0xb5);
    expect(bytes[2]).toBe(0x2f);
    expect(bytes[3]).toBe(0xfd);
    expect(new TextDecoder().decode(Bun.zstdDecompressSync(Buffer.from(bytes)))).toBe(LARGE_TEXT);

    const res = await app.fetch('/text', { headers: { 'accept-encoding': 'zstd' } });
    expect(await res.text()).toBe(LARGE_TEXT);
  });

  it('E2E-RT-05 JSON object 핸들러 반환 → wire CE 확인 + 해제 후 JSON.parse 정합', async () => {
    const raw = await app.fetchRaw('/json', { headers: { 'accept-encoding': 'gzip' } });
    expect(raw.headers.get('content-encoding')).toBe('gzip');
    const res = await app.fetch('/json', { headers: { 'accept-encoding': 'gzip' } });
    expect(await res.json()).toEqual(LARGE_OBJ);
  });

  it('E2E-RT-06 대형 body(1MB+) 라운드트립', async () => {
    const res = await app.fetch('/big', { headers: { 'accept-encoding': 'gzip' } });
    expect(await res.text()).toBe('payload-'.repeat(150_000));
  });

  it('E2E-RT-07 멀티바이트 유니코드 라운드트립', async () => {
    const res = await app.fetch('/unicode', { headers: { 'accept-encoding': 'br' } });
    expect(await res.text()).toBe('한글과 émoji 🗜️ — '.repeat(500));
  });
});
