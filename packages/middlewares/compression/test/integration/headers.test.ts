import { describe, expect, it } from 'bun:test';

import { compressionMiddleware } from '../../index';
import { CompressionCodec } from '../../src/enums';
import { LARGE_BODY_OBJ, LARGE_JSON, makeRequestHeaders, mockContext, mockHttpResponse, unwrap } from './helpers';
import type { MockResponse } from './helpers';

const middleware = unwrap(compressionMiddleware());

function runWith(response: MockResponse, ae = 'gzip') {
  const ctx = mockContext({ headers: makeRequestHeaders(ae) }, response);
  middleware.handler(ctx);
  return response;
}

describe('headers', () => {
  // ── HP ──
  it('[§2.1.1] HDR-01 압축 후 Content-Encoding = 협상 코딩', () => {
    const res = runWith(mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' }));
    expect(res.getHeader('content-encoding')).toBe('gzip');
  });

  it('[§2.3.2] HDR-02 압축 후 비인코딩 기준 기존 CL 제거', () => {
    const res = runWith(mockHttpResponse({
      body: LARGE_BODY_OBJ,
      contentType: 'application/json',
      headers: { 'content-length': String(new TextEncoder().encode(LARGE_JSON).byteLength) },
    }));
    expect(res.getHeader('content-length')).not.toBe(String(new TextEncoder().encode(LARGE_JSON).byteLength));
  });

  it('[§2.3.3] HDR-03 압축 후 Content-Length = 압축 바이트 수 재설정', () => {
    const res = runWith(mockHttpResponse({
      body: LARGE_BODY_OBJ,
      contentType: 'application/json',
      headers: { 'content-length': '2061' },
    }));
    const body = res.getBody() as Uint8Array;
    expect(body).toBeInstanceOf(Uint8Array);
    expect(res.getHeader('content-length')).toBe(String(body.byteLength));
  });

  it('[§4.1.1] HDR-04 압축 후 Vary: Accept-Encoding 존재', () => {
    const res = runWith(mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' }));
    expect(res.getHeader('vary')).toContain('accept-encoding');
  });

  it('[§4.2.1·§4.2.2] HDR-05 strong ETag "abc" → W/"abc"', () => {
    const res = runWith(mockHttpResponse({
      body: LARGE_BODY_OBJ,
      contentType: 'application/json',
      headers: { etag: '"abc123"' },
    }));
    expect(res.getHeader('etag')).toBe('W/"abc123"');
  });

  // ── NE ──
  it('[§2.1.2] HDR-06 어떤 경로에서도 Content-Encoding: identity 미생성', () => {
    const paths = [
      runWith(mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' })),
      runWith(mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' }), 'identity'),
      runWith(mockHttpResponse({ body: 'x', contentType: 'text/plain' })),
    ];
    for (const res of paths) {
      expect(res.getHeader('content-encoding')).not.toBe('identity');
    }
  });

  it('[§2.3.2] HDR-07 압축 스킵 시 기존 CL 유지', () => {
    const res = runWith(mockHttpResponse({
      body: LARGE_BODY_OBJ,
      contentType: 'image/png',
      headers: { 'content-length': '2061' },
    }));
    expect(res.getHeader('content-length')).toBe('2061');
  });

  it('[§4.2.2] HDR-08 압축 스킵 시 ETag 불변', () => {
    const res = runWith(mockHttpResponse({
      body: LARGE_BODY_OBJ,
      contentType: 'image/png',
      headers: { etag: '"abc"' },
    }));
    expect(res.getHeader('etag')).toBe('"abc"');
  });

  // ── ED ──
  it('[§4.1.1] HDR-09 기존 Vary: Origin → append', () => {
    const res = runWith(mockHttpResponse({
      body: LARGE_BODY_OBJ,
      contentType: 'application/json',
      headers: { vary: 'Origin' },
    }));
    expect(res.getHeader('vary')).toBe('Origin, accept-encoding');
  });

  it('[§4.1.1] HDR-10 기존 Vary: accept-encoding(소문자) → 중복 없음', () => {
    const res = runWith(mockHttpResponse({
      body: LARGE_BODY_OBJ,
      contentType: 'application/json',
      headers: { vary: 'accept-encoding' },
    }));
    expect(res.getHeader('vary')).toBe('accept-encoding');
  });

  it('[§4.1.2] HDR-11 기존 Vary: * → append 안 함 (압축 자체는 수행)', () => {
    const res = runWith(mockHttpResponse({
      body: LARGE_BODY_OBJ,
      contentType: 'application/json',
      headers: { vary: '*' },
    }));
    expect(res.getHeader('vary')).toBe('*');
    expect(res.getHeader('content-encoding')).toBe('gzip');
  });

  it('[§4.2.2] HDR-12 ETag 부재 → 미생성', () => {
    const res = runWith(mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' }));
    expect(res.getHeader('etag')).toBeNull();
  });

  it('[§4.2.2] HDR-13 기존 weak W/"abc" → 그대로 유지', () => {
    const res = runWith(mockHttpResponse({
      body: LARGE_BODY_OBJ,
      contentType: 'application/json',
      headers: { etag: 'W/"abc"' },
    }));
    expect(res.getHeader('etag')).toBe('W/"abc"');
  });

  it('[§4.2.2] HDR-14 특수 ETag(""·W/"") → 안전 처리', () => {
    const empty = runWith(mockHttpResponse({
      body: LARGE_BODY_OBJ, contentType: 'application/json', headers: { etag: '""' },
    }));
    expect(empty.getHeader('etag')).toBe('W/""');
    const weakEmpty = runWith(mockHttpResponse({
      body: LARGE_BODY_OBJ, contentType: 'application/json', headers: { etag: 'W/""' },
    }));
    expect(weakEmpty.getHeader('etag')).toBe('W/""');
  });

  it('[§2.3.3] HDR-15 BREACH 패딩 적용 시에도 CL = 최종(패딩 포함) 바이트 수', () => {
    const m = unwrap(compressionMiddleware({ breach: { maxPadding: 32 } }));
    const res = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
    m.handler(mockContext({ headers: makeRequestHeaders('gzip') }, res));
    const body = res.getBody() as Uint8Array;
    expect(res.getHeader('content-length')).toBe(String(body.byteLength));
  });

  it('[§4.2.2] HDR-19 기형 ETag(무인용·소문자 w/·목록형) → 무효한 weak tag를 새로 만들지 않음', () => {
    // 유효한 entity-tag 문법(§8.8.3: [W/]DQUOTE...DQUOTE)이 아닌 값은 불변으로 남긴다
    for (const malformed of ['abc', 'w/"x"', '"a", "b"']) {
      const res = runWith(mockHttpResponse({
        body: LARGE_BODY_OBJ,
        contentType: 'application/json',
        headers: { etag: malformed },
      }));
      expect(res.getHeader('etag')).toBe(malformed);
      expect(res.getHeader('content-encoding')).toBe('gzip');
    }
  });

  // HDR-20(다중 Vary field line)은 실제 Headers.append 시맨틱이 필요 — e2e wire-headers로 이동

  it('[§2.3.3] HDR-21 기존 Transfer-Encoding 존재 + 압축 → CL을 새로 설정하지 않음', () => {
    // §2.3.3의 전제는 "Transfer-Encoding이 없고" — TE가 있으면 CL 생성 금지(RFC 9112 §6.2와 충돌)
    const res = runWith(mockHttpResponse({
      body: LARGE_BODY_OBJ,
      contentType: 'application/json',
      headers: { 'transfer-encoding': 'chunked' },
    }));
    expect(res.getHeader('content-encoding')).toBe('gzip');
    expect(res.getHeader('content-length')).toBeNull();
  });

  // ── SE ──
  it('[§2] HDR-16 헤더 조작이 CT·Cache-Control 등 무관 헤더 불변', () => {
    const res = runWith(mockHttpResponse({
      body: LARGE_BODY_OBJ,
      contentType: 'application/json',
      headers: { 'cache-control': 'public, max-age=60', 'x-custom': 'keep' },
    }));
    expect(res.getHeader('cache-control')).toBe('public, max-age=60');
    expect(res.getHeader('x-custom')).toBe('keep');
    expect(res.getContentType()).toBe('application/json');
  });

  it('[§2.3.1] HDR-17 압축 후 표현 metadata가 coded form 기준으로 일관(CE 설정·비인코딩 CL 부재)', () => {
    const res = runWith(mockHttpResponse({
      body: LARGE_BODY_OBJ,
      contentType: 'application/json',
      headers: { 'content-length': '9999' },
    }));
    expect(res.getHeader('content-encoding')).toBe('gzip');
    expect(res.getHeader('content-length')).not.toBe('9999');
  });

  it('[§2.4.1] HDR-18 동일 응답 이중 통과(재진입) → CE 중복 적용 없음', () => {
    const res = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
    runWith(res);
    const firstBody = res.getBody();
    runWith(res);
    expect(res.getBody()).toBe(firstBody);
    expect(res.getHeader('content-encoding')).toBe('gzip');
  });

  it('[§2.1.1] HDR: 각 코덱별 CE 값 정확성 (br·deflate·zstd)', () => {
    for (const [codec, ae] of [
      [CompressionCodec.Br, 'br'],
      [CompressionCodec.Deflate, 'deflate'],
      [CompressionCodec.Zstd, 'zstd'],
    ] as const) {
      const m = unwrap(compressionMiddleware({ encodings: [codec] }));
      const res = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      m.handler(mockContext({ headers: makeRequestHeaders(ae) }, res));
      expect(res.getHeader('content-encoding')).toBe(ae);
    }
  });
});
