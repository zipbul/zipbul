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

  it('[§4.1.1] EXC-18 Vary는 AE-협상 가능한 응답에만: 비협상 경로는 무Vary (RFC 9110 §12.5.5)', () => {
    // §12.5.5: Vary는 "콘텐츠 선택에 영향을 준" 요청 필드만 나열한다.
    // 협상 도달 전 스킵 (204) → AE 무관 → 무Vary
    const notReached = runWith(mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json', status: 204 }));
    expect(notReached.getHeader('vary')).toBeNull();
    // 비압축 content-type(image/png)은 AE 값과 무관하게 항상 identity → AE가 표현 선택에 영향 없음 → Vary 과잉선언 금지
    const incompressible = runWith(mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'image/png' }));
    expect(incompressible.getHeader('vary')).toBeNull();
    // no-transform은 변환 금지 → AE 영향 없음 → 무Vary
    const noTransform = runWith(mockHttpResponse({
      body: LARGE_BODY_OBJ, contentType: 'application/json', headers: { 'cache-control': 'no-transform' },
    }));
    expect(noTransform.getHeader('vary')).toBeNull();
  });

  it('[§4.1.1] EXC-19 AE-협상 가능한 응답은 압축 안 돼도 Vary 유지 (identity 협상·AE 부재)', () => {
    // 압축가능 리소스는 이 요청에서 압축이 안 돼도(identity/AE부재) 다른 AE 값이면 표현이 달라지므로
    // Vary: Accept-Encoding을 생성해야 shared cache의 표현 선택이 깨지지 않는다 (§4.1 · RFC 9111 §4.1).
    const absentAE = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
    middleware.handler(mockContext({ headers: makeRequestHeaders(undefined) }, absentAE));
    expect(absentAE.getHeader('content-encoding')).toBeNull();
    expect(absentAE.getHeader('vary')).toContain('accept-encoding');

    const identity = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
    middleware.handler(mockContext({ headers: makeRequestHeaders('identity') }, identity));
    expect(identity.getHeader('content-encoding')).toBeNull();
    expect(identity.getHeader('vary')).toContain('accept-encoding');
  });
});
