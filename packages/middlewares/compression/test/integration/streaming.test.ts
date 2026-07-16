import { describe, expect, it } from 'bun:test';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';

import { ResponseBodyKind } from '@zipbul/http-adapter';

import { compressionMiddleware } from '../../index';
import { CompressionCodec } from '../../src/enums';
import { drainStream, makeRequestHeaders, mockContext, mockHttpResponse, streamOf, unwrap } from './helpers';
import type { CompressionOptions } from '../../index';

const TEXT = 'streaming payload — the quick brown fox. '.repeat(100);

function runStream(
  body: unknown,
  contentType: string | null,
  ae = 'gzip',
  opts?: CompressionOptions,
) {
  const m = unwrap(compressionMiddleware(opts));
  const response = mockHttpResponse({ body, contentType });
  m.handler(mockContext({ headers: makeRequestHeaders(ae) }, response));
  return response;
}

async function wireBytes(res: ReturnType<typeof mockHttpResponse>): Promise<Uint8Array> {
  expect(res.bodyKind).toBe(ResponseBodyKind.Stream);
  const stream = res.getBodyStream();
  expect(stream).not.toBeNull();
  return drainStream(stream!);
}

describe('streaming', () => {
  // ── HP ──
  it('[§7.1.1] STR-01 ReadableStream body + AE: gzip → 압축 스트림 + CE 설정, 라운드트립 정합', async () => {
    const res = runStream(streamOf(TEXT), 'text/plain');
    expect(res.getHeader('content-encoding')).toBe('gzip');
    const bytes = await wireBytes(res);
    expect(bytes[0]).toBe(0x1f);
    expect(bytes[1]).toBe(0x8b);
    expect(gunzipSync(bytes).toString('utf-8')).toBe(TEXT);
  });

  it('[§7.1.1] STR-02 Blob body → 스트림 경로 압축 + 구 CL 무효', async () => {
    const blob = new Blob([TEXT], { type: 'text/plain' });
    const res = runStream(blob, 'text/plain');
    expect(res.getHeader('content-encoding')).toBe('gzip');
    // 스트림 경로는 길이 미지 — Blob 저장 시 설정된 CL은 정확히 제거되어야 한다
    expect(res.getHeader('content-length')).toBeNull();
    const bytes = await wireBytes(res);
    expect(gunzipSync(bytes).toString('utf-8')).toBe(TEXT);
  });

  it('[§7.2.1] STR-03 deflate 스트림 → zlib-wrapped(CMF 하위 4비트=8, raw 아님)', async () => {
    const res = runStream(streamOf(TEXT), 'text/plain', 'deflate', {
      encodings: [CompressionCodec.Deflate],
    });
    expect(res.getHeader('content-encoding')).toBe('deflate');
    const bytes = await wireBytes(res);
    expect((bytes[0] ?? 0) & 0x0f).toBe(8);
    expect(inflateSync(bytes).toString('utf-8')).toBe(TEXT);
  });

  it('[§7.1.1] STR-04 brotli 스트림(WHATWG 표준 포맷) 라운드트립', async () => {
    const res = runStream(streamOf(TEXT), 'text/plain', 'br', {
      encodings: [CompressionCodec.Br],
    });
    expect(res.getHeader('content-encoding')).toBe('br');
    const bytes = await wireBytes(res);
    expect(brotliDecompressSync(bytes).toString('utf-8')).toBe(TEXT);
  });

  it('[§7.1.2] STR-05 zstd 스트림(런타임 확장 경로) 라운드트립', async () => {
    const res = runStream(streamOf(TEXT), 'text/plain', 'zstd', {
      encodings: [CompressionCodec.Zstd],
    });
    expect(res.getHeader('content-encoding')).toBe('zstd');
    const bytes = await wireBytes(res);
    expect(new TextDecoder().decode(Bun.zstdDecompressSync(Buffer.from(bytes)))).toBe(TEXT);
  });

  // ── NE ──
  it('[§9.2.1] STR-06 스트림 + 비압축성 CT(event-stream·png) → 원스트림 불간섭', async () => {
    for (const ct of ['text/event-stream', 'image/png']) {
      const res = runStream(streamOf(TEXT), ct);
      expect(res.getHeader('content-encoding')).toBeNull();
      const bytes = await wireBytes(res);
      expect(new TextDecoder().decode(bytes)).toBe(TEXT);
    }
  });

  it('[§1.1.7] STR-07 스트림 + AE 무매칭 → 원스트림 유지', async () => {
    const res = runStream(streamOf(TEXT), 'text/plain', 'br', {
      encodings: [CompressionCodec.Gzip],
    });
    expect(res.getHeader('content-encoding')).toBeNull();
    const bytes = await wireBytes(res);
    expect(new TextDecoder().decode(bytes)).toBe(TEXT);
  });

  it('[§9.3.1] STR: breach 활성 시 스트림은 압축하지 않음(패딩 불가 → 보호 우선)', async () => {
    const res = runStream(streamOf(TEXT), 'text/plain', 'gzip', {
      breach: { maxPadding: 32 },
    });
    expect(res.getHeader('content-encoding')).toBeNull();
    const bytes = await wireBytes(res);
    expect(new TextDecoder().decode(bytes)).toBe(TEXT);
  });

  // ── ED ──
  it('[§7.1.1] STR-08 빈 스트림·단일 청크·다수 청크 각각 라운드트립', async () => {
    const cases: Array<[ReadableStream<Uint8Array>, string]> = [
      [streamOf(), ''],
      [streamOf(TEXT), TEXT],
      [streamOf('chunk-1|', 'chunk-2|', 'chunk-3'), 'chunk-1|chunk-2|chunk-3'],
    ];
    for (const [stream, expected] of cases) {
      const res = runStream(stream, 'text/plain');
      expect(res.getHeader('content-encoding')).toBe('gzip');
      const bytes = await wireBytes(res);
      expect(gunzipSync(bytes).toString('utf-8')).toBe(expected);
    }
  });

  // ── EX ──
  it('[§7] STR-09 원 스트림 mid-stream error → 소비자에게 전파(무한 대기·크래시 없음)', async () => {
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('first chunk'));
        controller.error(new Error('upstream failure'));
      },
    });
    const res = runStream(failing, 'text/plain');
    expect(res.getHeader('content-encoding')).toBe('gzip');
    expect(res.bodyKind).toBe(ResponseBodyKind.Stream);
    await expect(drainStream(res.getBodyStream()!)).rejects.toThrow();
  });

  it('[§2.4.1] STR-12 native Response 자체에 Content-Encoding 존재 → 불간섭(이중 압축 금지)', async () => {
    // 핸들러가 이미 압축된 raw Response를 반환한 경우 — CE는 _headers가 아니라
    // native Response 내부 헤더에 있다. 미들웨어는 이것도 존중해야 한다.
    const gzipped = Bun.gzipSync(new TextEncoder().encode(TEXT));
    const nativeRes = new Response(new Blob([new Uint8Array(gzipped)]).stream(), {
      headers: { 'content-encoding': 'gzip', 'content-type': 'text/plain' },
    });
    const m = unwrap(compressionMiddleware());
    const response = mockHttpResponse({ nativeResponse: nativeRes, contentType: 'text/plain' });
    m.handler(mockContext({ headers: makeRequestHeaders('gzip') }, response));
    // 핸들러가 이미 gzip으로 인코딩했으므로 미들웨어는 손대지 않는다 — 전송될 CE는
    // 핸들러가 설정한 값 하나뿐이고(이중 인코딩이면 'gzip, gzip'이 된다), body도 원본이다.
    expect(response.getHeader('content-encoding')).toBe('gzip');
    const bytes = await drainStream(response.getBodyStream()!);
    expect(Buffer.from(Bun.gunzipSync(new Uint8Array(bytes))).toString()).toBe(TEXT);
  });

  it('[§9.2.1] STR-13 native Response 자체 CT가 event-stream(_headers CT 부재) → 불간섭', async () => {
    // SSE류 raw Response — CT가 native 내부에만 있어도 필터가 보호해야 한다
    const nativeRes = new Response(streamOf('data: x\n\n'), {
      headers: { 'content-type': 'text/event-stream' },
    });
    const m = unwrap(compressionMiddleware());
    const response = mockHttpResponse({ nativeResponse: nativeRes, contentType: null });
    m.handler(mockContext({ headers: makeRequestHeaders('gzip') }, response));
    expect(response.getHeader('content-encoding')).toBeNull();
    const bytes = await drainStream(response.getBodyStream()!);
    expect(new TextDecoder().decode(bytes)).toBe('data: x\n\n');
  });

  it('[§2.4.1] STR-14 압축된 스트림 응답에 이중 통과 → 잠긴 body 재독 시도 없이 무해', async () => {
    const m = unwrap(compressionMiddleware());
    const response = mockHttpResponse({ body: streamOf(TEXT), contentType: 'text/plain' });
    const ctx = () => mockContext({ headers: makeRequestHeaders('gzip') }, response);
    m.handler(ctx());
    expect(response.getHeader('content-encoding')).toBe('gzip');
    // 재진입 — CE가 이미 있으므로 스킵해야 하며 throw 없어야 한다
    expect(() => m.handler(ctx())).not.toThrow();
    const bytes = await drainStream(response.getBodyStream()!);
    expect(Buffer.from(Bun.gunzipSync(new Uint8Array(bytes))).toString()).toBe(TEXT);
  });

  it('[§4.2.1] STR-15 스트림 경로 strong ETag "s" → 압축 후 W/"s"로 약화', async () => {
    // 스트림/native-Response body에도 content transformation이 일어나므로
    // strong validator는 §8.8.1에 따라 weak로 약화되어야 한다
    const nativeRes = new Response(streamOf('x'.repeat(2000)));
    const m = unwrap(compressionMiddleware());
    const response = mockHttpResponse({
      nativeResponse: nativeRes,
      headers: { etag: '"s"', 'content-type': 'text/plain' },
    });
    m.handler(mockContext({ headers: makeRequestHeaders('gzip') }, response));
    expect(response.getHeader('content-encoding')).toBe('gzip');
    expect(response.getHeader('etag')).toBe('W/"s"');
    const bytes = await drainStream(response.getBodyStream()!);
    expect(gunzipSync(bytes).toString('utf-8')).toBe('x'.repeat(2000));
  });

  it('[§4.2.2] STR-16 스트림 경로 기형 ETag(무인용) → 불변 유지', async () => {
    // 유효한 entity-tag 문법이 아닌 값은 무효한 weak tag를 새로 만들지 않는다
    const nativeRes = new Response(streamOf('x'.repeat(2000)));
    const m = unwrap(compressionMiddleware());
    const response = mockHttpResponse({
      nativeResponse: nativeRes,
      headers: { etag: 'notquoted', 'content-type': 'text/plain' },
    });
    m.handler(mockContext({ headers: makeRequestHeaders('gzip') }, response));
    expect(response.getHeader('content-encoding')).toBe('gzip');
    expect(response.getHeader('etag')).toBe('notquoted');
    const bytes = await drainStream(response.getBodyStream()!);
    expect(gunzipSync(bytes).toString('utf-8')).toBe('x'.repeat(2000));
  });

  // ── SE ──
  it('[§2.3.3] STR-10 스트림 경로에서 CL 미설정(길이 미지)', () => {
    const res = runStream(streamOf(TEXT), 'text/plain');
    expect(res.getHeader('content-encoding')).toBe('gzip');
    expect(res.getHeader('content-length')).toBeNull();
  });

  it('[§7] STR-11 압축 후 원 스트림은 소비(잠금)되고 응답 스트림은 잠기지 않은 새 스트림', async () => {
    const source = streamOf(TEXT);
    const res = runStream(source, 'text/plain');
    expect(res.getHeader('content-encoding')).toBe('gzip');
    // 원 스트림은 파이프에 잠겨 직접 읽기 불가
    expect(source.locked).toBe(true);
    // 응답 스트림은 소비 가능해야 한다
    const out = res.getBodyStream()!;
    expect(out.locked).toBe(false);
    expect(gunzipSync(await drainStream(out)).toString('utf-8')).toBe(TEXT);
  });
});
