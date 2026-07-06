import { describe, expect, it } from 'bun:test';

import { compressionMiddleware } from '../../index';
import { LARGE_BODY_OBJ, makeRequestHeaders, mockContext, mockHttpResponse, unwrap } from './helpers';
import type { MockResponse } from './helpers';

const middleware = unwrap(compressionMiddleware());

function runWith(response: MockResponse, method = 'GET') {
  const ctx = mockContext({ headers: makeRequestHeaders('gzip'), method }, response);
  middleware.handler(ctx);
  return response;
}

describe('exclusions', () => {
  // ── HP: 정상 스킵 ──
  it('[§3.1.1] EXC-01 1xx(100·101) → 무압축·무Vary', () => {
    for (const status of [100, 101]) {
      const res = runWith(mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json', status }));
      expect(res.getHeader('content-encoding')).toBeNull();
      expect(res.getHeader('vary')).toBeNull();
    }
  });

  it('[§3.1.1] EXC-02 204 → 무압축·무Vary', () => {
    const res = runWith(mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json', status: 204 }));
    expect(res.getHeader('content-encoding')).toBeNull();
    expect(res.getHeader('vary')).toBeNull();
  });

  it('[§3.1.1] EXC-03 304 → 무압축·무Vary', () => {
    const res = runWith(mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json', status: 304 }));
    expect(res.getHeader('content-encoding')).toBeNull();
    expect(res.getHeader('vary')).toBeNull();
  });

  it('[§3.1.2] EXC-04 205 → 무압축', () => {
    const res = runWith(mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json', status: 205 }));
    expect(res.getHeader('content-encoding')).toBeNull();
  });

  it('[§3.2.1·§3.2.2] EXC-05 HEAD 요청 → body·헤더 불간섭', () => {
    const res = runWith(
      mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' }),
      'HEAD',
    );
    expect(res.getHeader('content-encoding')).toBeNull();
    expect(res.getBody()).toBe(LARGE_BODY_OBJ);
  });

  it('[§3.3.2] EXC-06 206 + Content-Range → 무압축', () => {
    const res = runWith(mockHttpResponse({
      body: LARGE_BODY_OBJ,
      contentType: 'application/json',
      status: 206,
      headers: { 'content-range': 'bytes 0-2060/9999' },
    }));
    expect(res.getHeader('content-encoding')).toBeNull();
    expect(res.getBody()).toBe(LARGE_BODY_OBJ);
  });

  it('[§3.4.1] EXC-07 Cache-Control: no-transform → 무압축', () => {
    const res = runWith(mockHttpResponse({
      body: LARGE_BODY_OBJ,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-transform' },
    }));
    expect(res.getHeader('content-encoding')).toBeNull();
  });

  it('[§2.4.1] EXC-08 기존 Content-Encoding: gzip → 불간섭', () => {
    const res = runWith(mockHttpResponse({
      body: 'already-compressed',
      contentType: 'text/plain',
      headers: { 'content-encoding': 'gzip' },
    }));
    expect(res.getBody()).toBe('already-compressed');
  });

  // ── NE: 스킵하면 안 되는 것 ──
  it('[§3] EXC-09 200 → 압축 (대조군)', () => {
    const res = runWith(mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json', status: 200 }));
    expect(res.getHeader('content-encoding')).toBe('gzip');
  });

  it('[§3] EXC-10 201·207 등 기타 2xx → 압축 허용', () => {
    for (const status of [201, 207]) {
      const res = runWith(mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json', status }));
      expect(res.getHeader('content-encoding')).toBe('gzip');
    }
  });

  it('[§3.4.1] EXC-11 다중 지시어 public, no-transform, max-age → 스킵', () => {
    const res = runWith(mockHttpResponse({
      body: LARGE_BODY_OBJ,
      contentType: 'application/json',
      headers: { 'cache-control': 'public, no-transform, max-age=3600' },
    }));
    expect(res.getHeader('content-encoding')).toBeNull();
  });

  it('[§3.4.1] EXC-12 유사 토큰 no-transformable → 스킵 아님(오탐 방지)', () => {
    const res = runWith(mockHttpResponse({
      body: LARGE_BODY_OBJ,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-transformable' },
    }));
    expect(res.getHeader('content-encoding')).toBe('gzip');
  });

  // ── ED ──
  it('[§3.1.1] EXC-13 상태코드 경계: 199 스킵 · 200 압축 · 0(미설정) 스킵', () => {
    expect(runWith(mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json', status: 199 }))
      .getHeader('content-encoding')).toBeNull();
    expect(runWith(mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json', status: 200 }))
      .getHeader('content-encoding')).toBe('gzip');
    expect(runWith(mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json', status: 0 }))
      .getHeader('content-encoding')).toBeNull();
  });

  it('[§2.4.1] EXC-14 기존 Content-Encoding: identity → 불간섭(중복 적용 금지)', () => {
    const res = runWith(mockHttpResponse({
      body: LARGE_BODY_OBJ,
      contentType: 'application/json',
      headers: { 'content-encoding': 'identity' },
    }));
    expect(res.getBody()).toBe(LARGE_BODY_OBJ);
  });

  it('[§3.4.1] EXC-15 NO-TRANSFORM 대소문자 변형 → 스킵', () => {
    const res = runWith(mockHttpResponse({
      body: LARGE_BODY_OBJ,
      contentType: 'application/json',
      headers: { 'cache-control': 'NO-TRANSFORM' },
    }));
    expect(res.getHeader('content-encoding')).toBeNull();
  });

  it('[§3.2.1] EXC-16 비HEAD 메서드(GET·POST·PUT) → 압축 정상', () => {
    for (const method of ['GET', 'POST', 'PUT']) {
      const res = runWith(mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' }), method);
      expect(res.getHeader('content-encoding')).toBe('gzip');
    }
  });

  // ── SE ──
  it('[§3] EXC-17 모든 스킵 경로에서 body·ETag·CL·CT 완전 불변', () => {
    const cases = [
      mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json', status: 204, headers: { etag: '"x"', 'content-length': '10' } }),
      mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json', headers: { 'cache-control': 'no-transform', etag: '"x"', 'content-length': '10' } }),
      mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'image/png', headers: { etag: '"x"', 'content-length': '10' } }),
    ];
    for (const res of cases) {
      runWith(res);
      expect(res.getBody()).toBe(LARGE_BODY_OBJ);
      expect(res.getHeader('etag')).toBe('"x"');
      expect(res.getHeader('content-length')).toBe('10');
      expect(res.getHeader('content-encoding')).toBeNull();
    }
  });

  it('[§4.1.1] EXC-18 스킵 경로별 Vary 정책: 협상 도달 전 스킵=무Vary, 도달 후 스킵=Vary', () => {
    // 협상 도달 전 (204)
    const pre = runWith(mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json', status: 204 }));
    expect(pre.getHeader('vary')).toBeNull();
    // 협상 판단에 도달한 뒤 스킵 (filter 제외)
    const post = runWith(mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'image/png' }));
    expect(post.getHeader('vary')).toContain('accept-encoding');
  });
});
