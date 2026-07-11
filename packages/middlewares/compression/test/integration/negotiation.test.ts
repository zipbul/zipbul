import { describe, expect, it } from 'bun:test';

import { compressionMiddleware } from '../../index';
import { CompressionCodec } from '../../src/enums';
import { LARGE_BODY_OBJ, makeRequestHeaders, mockContext, mockHttpResponse, unwrap } from './helpers';

const middleware = unwrap(compressionMiddleware());

function run(acceptEncoding: string | undefined, opts?: Parameters<typeof compressionMiddleware>[0]) {
  const m = opts === undefined ? middleware : unwrap(compressionMiddleware(opts));
  const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
  const ctx = mockContext({ headers: makeRequestHeaders(acceptEncoding) }, response);
  m.handler(ctx);
  return response;
}

describe('negotiation', () => {
  // ── HP ──
  it('[§1.1.3] NEG-01 AE: gzip → gzip 압축 적용', () => {
    const res = run('gzip');
    expect(res.getHeader('content-encoding')).toBe('gzip');
    expect(res.getBody()).toBeInstanceOf(Uint8Array);
  });

  it('[§1.1.6] NEG-02 최고 non-zero qvalue 선택 (deflate;q=0.9 > gzip;q=0.5 > br;q=0.3)', () => {
    const res = run('gzip;q=0.5, deflate;q=0.9, br;q=0.3', {
      encodings: [CompressionCodec.Gzip, CompressionCodec.Deflate, CompressionCodec.Br],
    });
    expect(res.getHeader('content-encoding')).toBe('deflate');
  });

  it('[§1.1.5] NEG-03 미나열 코딩의 wildcard 매칭 (서버 zstd + AE: *)', () => {
    const res = run('*', { encodings: [CompressionCodec.Zstd] });
    expect(res.getHeader('content-encoding')).toBe('zstd');
  });

  it('[§1.2.3] NEG-04 q 무지정 = weight 1 (gzip > br;q=0.5)', () => {
    const res = run('gzip, br;q=0.5', { encodings: [CompressionCodec.Br, CompressionCodec.Gzip] });
    expect(res.getHeader('content-encoding')).toBe('gzip');
  });

  it('[§1.2.2] NEG-05 대문자 Q 파라미터 인식', () => {
    const res = run('gzip;Q=0', { encodings: [CompressionCodec.Gzip] });
    expect(res.getHeader('content-encoding')).toBeNull();
  });

  it('[§1.3.1] NEG-06 x-gzip → gzip 별칭, 응답 CE는 gzip', () => {
    const res = run('x-gzip', { encodings: [CompressionCodec.Gzip] });
    expect(res.getHeader('content-encoding')).toBe('gzip');
  });

  it('[§1.3.2] NEG-07 x-compress → compress 별칭 (서버 미지원 → 무압축, 크래시 없음)', () => {
    const res = run('x-compress');
    expect(res.getHeader('content-encoding')).toBeNull();
  });

  it('[§9.2.2] NEG-08 동일 qvalue → 서버 선호 순서 tie-break', () => {
    const r1 = run('gzip, br', { encodings: [CompressionCodec.Gzip, CompressionCodec.Br] });
    const r2 = run('gzip, br', { encodings: [CompressionCodec.Br, CompressionCodec.Gzip] });
    expect(r1.getHeader('content-encoding')).toBe('gzip');
    expect(r2.getHeader('content-encoding')).toBe('br');
  });

  // ── NE ──
  it('[§1.1.2] NEG-09 빈 AE field value → 무압축', () => {
    const res = run('');
    expect(res.getHeader('content-encoding')).toBeNull();
  });

  it('[§1.1.3] NEG-10 gzip;q=0 → gzip 배제, 무압축', () => {
    const res = run('gzip;q=0', { encodings: [CompressionCodec.Gzip] });
    expect(res.getHeader('content-encoding')).toBeNull();
  });

  it('[§1.1.4·§1.1.7] NEG-11 *;q=0 (identity 미명시) → 406: body null·CE/CL 부재·Vary 유지', () => {
    const m = unwrap(compressionMiddleware());
    const res = mockHttpResponse({
      body: LARGE_BODY_OBJ,
      contentType: 'application/json',
      headers: { 'content-length': '2061' },
    });
    m.handler(mockContext({ headers: makeRequestHeaders('*;q=0') }, res));
    expect(res.getStatus()).toBe(406);
    expect(res.getBody()).toBeNull();
    expect(res.getHeader('content-encoding')).toBeNull();
    expect(res.getHeader('content-length')).toBeNull();
    // 협상이 상태를 결정했으므로 Vary는 남아야 한다
    expect(res.getHeader('vary')).toContain('accept-encoding');
    // CT 처리는 어댑터 build()의 소관(계약 제외 — TEST-PLAN 참조)
  });

  it('[§1.1.7·§1.1.8] NEG-12 identity;q=0 + 무매칭 → 406 / 매칭 존재 → 정상 압축', () => {
    // identity 배제 + acceptable 코딩 없음(클라 br, 서버 gzip) → identity 송출 금지 → 406
    const rejected = run('identity;q=0, br', { encodings: [CompressionCodec.Gzip] });
    expect(rejected.getStatus()).toBe(406);
    expect(rejected.getBody()).toBeNull();
    expect(rejected.getHeader('content-length')).toBeNull();
    // identity 배제여도 acceptable 코딩이 있으면 정상 압축
    const ok = run('identity;q=0, gzip', { encodings: [CompressionCodec.Gzip] });
    expect(ok.getStatus()).toBe(200);
    expect(ok.getHeader('content-encoding')).toBe('gzip');
  });

  it('[§1.1.7] NEG-13 AE: br + 서버 gzip만 → 무압축 (identity 허용)', () => {
    const res = run('br', { encodings: [CompressionCodec.Gzip] });
    expect(res.getHeader('content-encoding')).toBeNull();
  });

  it('[§1.1.4] NEG-14 identity만 수락 → 무압축', () => {
    const res = run('identity');
    expect(res.getHeader('content-encoding')).toBeNull();
  });

  // ── ED ──
  it('[§1.2.1] NEG-15 q=0.001 최소 양수 → 선택됨', () => {
    const res = run('gzip;q=0.001', { encodings: [CompressionCodec.Gzip] });
    expect(res.getHeader('content-encoding')).toBe('gzip');
  });

  it('[§1.2.1] NEG-16 문법 밖 q값(q=abc, q=, q=1.5, q=-1) → 관용 처리·크래시 없음', () => {
    for (const ae of ['gzip;q=abc', 'gzip;q=', 'gzip;q=1.5', 'gzip;q=-1']) {
      const res = run(ae, { encodings: [CompressionCodec.Gzip] });
      expect(res.getHeader('content-encoding')).toBe('gzip');
    }
  });

  it('[§1.2.1] NEG-17 소수 4자리 q=0.1234 → 관용 파싱', () => {
    const res = run('gzip;q=0.1234', { encodings: [CompressionCodec.Gzip] });
    expect(res.getHeader('content-encoding')).toBe('gzip');
  });

  it('[§1.1.3] NEG-18 빈 list 요소(gzip,,br / 단독 콤마) → 무시', () => {
    expect(run('gzip,,br').getHeader('content-encoding')).not.toBeNull();
    expect(run(',').getHeader('content-encoding')).toBeNull();
  });

  it('[§1.1.3] NEG-19 중복 코딩 gzip;q=0.8, gzip;q=0.2 → 결정적 처리(압축 수행)', () => {
    const res = run('gzip;q=0.8, gzip;q=0.2', { encodings: [CompressionCodec.Gzip] });
    expect(res.getHeader('content-encoding')).toBe('gzip');
  });

  it('[§1.2.1] NEG-20 공백 변형 gzip ; q = 0.6 → 정상 파싱', () => {
    const res = run('gzip ; q = 0.6', { encodings: [CompressionCodec.Gzip] });
    expect(res.getHeader('content-encoding')).toBe('gzip');
  });

  it('[§1.4.1] NEG-21 코딩명 대소문자 GZIP → gzip', () => {
    const res = run('GZIP', { encodings: [CompressionCodec.Gzip] });
    expect(res.getHeader('content-encoding')).toBe('gzip');
  });

  it('[§1.1.5] NEG-22 명시 배제 + wildcard 공존 (*, gzip;q=0 → gzip 배제, br은 wildcard)', () => {
    const res = run('*, gzip;q=0', { encodings: [CompressionCodec.Br, CompressionCodec.Gzip] });
    expect(res.getHeader('content-encoding')).toBe('br');
  });

  it('[§1.1.3·§1.1.6] NEG-28 중복 코딩 상충 q + 경쟁 코덱 → 중복이 코덱을 강등시키지 않음', () => {
    // Red R10: 현행 협상기는 clientMap.set 덮어쓰기로 마지막 중복 항목(q=0.2)이 이겨
    // gzip;q=0.8 > br;q=0.5 순위를 뒤집는다
    const res = run('gzip;q=0.8, br;q=0.5, gzip;q=0.2', {
      encodings: [CompressionCodec.Gzip, CompressionCodec.Br],
    });
    expect(res.getHeader('content-encoding')).toBe('gzip');
  });

  it('[§1.1.4·§1.1.7] NEG-29 전면 명시 배제(identity;q=0, *;q=0, gzip;q=0) → 406', () => {
    const res = run('identity;q=0, *;q=0, gzip;q=0', { encodings: [CompressionCodec.Gzip] });
    expect(res.getStatus()).toBe(406);
    expect(res.getBody()).toBeNull();
  });

  // ── EX ──
  it('[§1.1.3] NEG-23 수천 항목 초장문 AE → 안전 처리', () => {
    const huge = Array.from({ length: 5000 }, (_, i) => `enc${i};q=0.5`).join(', ') + ', gzip';
    const res = run(huge, { encodings: [CompressionCodec.Gzip] });
    expect(res.getHeader('content-encoding')).toBe('gzip');
  });

  it('[§1.1.3] NEG-24 제어문자·비ASCII octet 포함 AE → 크래시 없음', () => {
    // 실제 Headers는 set 단계에서 제어문자를 거부하므로 plain 객체로 우회 주입해
    // 미들웨어 파서 자체의 견고성을 검증한다
    const m = unwrap(compressionMiddleware({ encodings: [CompressionCodec.Gzip] }));
    for (const ae of ['gzip\u0000', '\u00ff\u00fe, gzip', 'gz\tip', 'gzip;q=1\u0007']) {
      const headers = { get: (name: string) => (name.toLowerCase() === 'accept-encoding' ? ae : null) };
      const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
      expect(() => m.handler(mockContext({ headers }, response))).not.toThrow();
      // 견고성뿐 아니라 결과도 검증: 결정적 결과(무압축 원본 유지 OR 온전한 gzip)여야
      // 하며 손상된 출력은 없어야 한다 — 단순 no-throw를 넘어선 결과 검증
      const ce = response.getHeader('content-encoding');
      if (ce === null) {
        expect(response.getBody()).toBe(LARGE_BODY_OBJ);
      } else {
        expect(ce).toBe('gzip');
        const decompressed = Bun.gunzipSync(new Uint8Array(response.getBody() as Uint8Array));
        expect(JSON.parse(Buffer.from(decompressed).toString())).toEqual(LARGE_BODY_OBJ);
      }
    }
  });

  // ── SE ──
  it('[§1.1.7] NEG-25 협상 실패 경로에서 body·CE·CL·ETag 완전 불변', () => {
    const m = unwrap(compressionMiddleware({ encodings: [CompressionCodec.Gzip] }));
    const response = mockHttpResponse({
      body: LARGE_BODY_OBJ,
      contentType: 'application/json',
      headers: { 'content-length': '123', etag: '"abc"' },
    });
    const ctx = mockContext({ headers: makeRequestHeaders('br') }, response);
    m.handler(ctx);
    expect(response.getBody()).toBe(LARGE_BODY_OBJ);
    expect(response.getHeader('content-encoding')).toBeNull();
    expect(response.getHeader('content-length')).toBe('123');
    expect(response.getHeader('etag')).toBe('"abc"');
  });

  it('[§1.1.1·§9.1.2] NEG-26 AE 부재 → 무압축(정책) + body 불변', () => {
    const res = run(undefined);
    expect(res.getHeader('content-encoding')).toBeNull();
    expect(res.getBody()).toBe(LARGE_BODY_OBJ);
  });

  it('[§1.1.6] NEG-27 동일 요청 2회 → 동일 협상 결과 (결정성)', () => {
    const a = run('gzip;q=0.8, br;q=0.9');
    const b = run('gzip;q=0.8, br;q=0.9');
    expect(a.getHeader('content-encoding')).toBe(b.getHeader('content-encoding'));
  });
});
