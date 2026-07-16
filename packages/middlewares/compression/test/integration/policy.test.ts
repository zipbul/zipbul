import { describe, expect, it, spyOn } from 'bun:test';

import { compressionMiddleware } from '../../index';
import { CompressionCodec } from '../../src/enums';
import { LARGE_BODY_OBJ, largeBody, makeRequestHeaders, mockContext, mockHttpResponse, unwrap } from './helpers';
import type { CompressionOptions } from '../../index';

function run(opts: CompressionOptions | undefined, body: unknown, contentType: string | null, ae = 'gzip') {
  const m = unwrap(compressionMiddleware(opts));
  const response = mockHttpResponse({ body, contentType });
  m.handler(mockContext({ headers: makeRequestHeaders(ae) }, response));
  return response;
}

describe('policy', () => {
  // ── HP ──
  it('[§9.2.1] POL-01 threshold 미달 body → 무압축', () => {
    const res = run({ threshold: 1024 }, 'tiny', 'text/plain');
    expect(res.getHeader('content-encoding')).toBeNull();
    expect(res.getBody()).toBe('tiny');
  });

  it('[§9.2.1] POL-02 threshold=0 → 소형(압축 이득 있는) body도 압축', () => {
    const res = run({ threshold: 0 }, { a: 'x'.repeat(64) }, 'application/json');
    expect(res.getHeader('content-encoding')).toBe('gzip');
  });

  it('[§9.2.1] POL-03 커스텀 filter 함수 적용', () => {
    const body = 'hello world! '.repeat(16);
    const res = run({ filter: (ct) => ct.includes('custom'), threshold: 0 }, body, 'text/custom');
    expect(res.getHeader('content-encoding')).toBe('gzip');
    const excluded = run({ filter: (ct) => ct.includes('custom'), threshold: 0 }, body, 'text/plain');
    expect(excluded.getHeader('content-encoding')).toBeNull();
  });

  it('[§9.2.1] POL-04 기본 filter 허용: text/html·application/json·image/svg+xml', () => {
    for (const ct of ['text/html', 'application/json', 'image/svg+xml']) {
      const res = run(undefined, largeBody(2048), ct);
      expect(res.getHeader('content-encoding')).toBe('gzip');
    }
  });

  // ── NE ──
  it('[§9.2.1] POL-05 기본 filter 거부: image/png·application/octet-stream·video/mp4', () => {
    for (const ct of ['image/png', 'application/octet-stream', 'video/mp4']) {
      const res = run({ threshold: 0 }, largeBody(2048), ct);
      expect(res.getHeader('content-encoding')).toBeNull();
    }
  });

  it('[§9.2.1] POL-06 text/event-stream(SSE) 거부 — charset·대소문자 변형 포함', () => {
    for (const ct of ['text/event-stream', 'text/event-stream; charset=utf-8', 'TEXT/EVENT-STREAM']) {
      const res = run({ threshold: 0 }, largeBody(2048), ct);
      expect(res.getHeader('content-encoding')).toBeNull();
    }
  });

  it('[§9.2.3] POL-07 팽창 가드: 압축 결과 ≥ 원본 → 무압축·원본 송출 (결정적 주입)', () => {
    // 랜덤 입력의 팽창은 "사실상 확실"일 뿐 보장이 아니므로, 압축기가 원본보다
    // 큰 결과를 반환하도록 주입해 가드 동작을 결정적으로 검증한다
    const body = 'guarded '.repeat(64);
    const inflated = new Uint8Array(body.length + 1);
    const spy = spyOn(Bun, 'gzipSync').mockReturnValue(inflated);
    try {
      const res = run({ threshold: 0 }, body, 'text/plain');
      expect(res.getHeader('content-encoding')).toBeNull();
      expect(res.getBody()).toBe(body);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('[§9.2.3] POL-18 팽창 가드 경계: 압축 결과 == 원본 크기 → 무압축 (>= 이므로 == 도 스킵)', () => {
    // 가드는 `compressed.byteLength >= bytes.byteLength` — 정확히 같은 크기도 이득이
    // 없으므로 원본을 유지한다. gzipSync가 입력과 동일 길이를 반환하도록 주입해
    // 경계가 `>`가 아니라 `>=`임을 증명한다
    const body = 'guarded '.repeat(64); // 512 ASCII bytes
    const sameSize = new Uint8Array(body.length); // == 512 bytes
    const spy = spyOn(Bun, 'gzipSync').mockReturnValue(sameSize);
    try {
      const res = run({ threshold: 0 }, body, 'text/plain');
      expect(res.getHeader('content-encoding')).toBeNull();
      expect(res.getBody()).toBe(body);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('[§3] POL-19 status 200 + null body → body 부재 조기반환(Vary 이전): CE·Vary 모두 부재', () => {
    // 빈 문자열/빈 바이너리와 달리 null body는 표현 자체가 없어 Vary 블록 이전에
    // 반환된다 — 협상에 도달하지 않으므로 Vary도 남지 않는다
    const res = run({ threshold: 0 }, null, 'text/plain');
    expect(res.getHeader('content-encoding')).toBeNull();
    expect(res.getHeader('vary')).toBeNull();
    expect(res.getBody()).toBeNull();
  });

  // ── ED ──
  it('[§9.2.1] POL-08 threshold 경계 -1바이트 → 무압축', () => {
    const res = run({ threshold: 64 }, 'a'.repeat(63), 'text/plain');
    expect(res.getHeader('content-encoding')).toBeNull();
  });

  it('[§9.2.1] POL-09 CT 부재 body → 압축 시도(현행 정책 고정)', () => {
    const res = run({ threshold: 0 }, 'hello world '.repeat(16), null);
    expect(res.getHeader('content-encoding')).toBe('gzip');
  });

  it('[§9.2.1] POL-14 object body의 직렬화 후 바이트 수 기준 threshold 판정', () => {
    // JSON.stringify({ a: 'x'.repeat(64) }) = {"a":"xx...x"} = 8 + 64 = 72 bytes
    const obj = { a: 'x'.repeat(64) };
    const serialized = JSON.stringify(obj).length;
    expect(run({ threshold: serialized + 1 }, obj, 'application/json').getHeader('content-encoding')).toBeNull();
    expect(run({ threshold: serialized }, obj, 'application/json').getHeader('content-encoding')).toBe('gzip');
  });

  it('[§9.2.1] POL-15 원시·공백 body(number·boolean·빈 값) → 팽창 가드로 원본 무압축 통과', () => {
    // 초소형 원시값은 압축하면 반드시 커지므로(§9.2.3 가드) 원본 그대로 통과가 정답
    const num = run({ threshold: 0 }, 42, 'application/json');
    expect(num.getHeader('content-encoding')).toBeNull();
    expect(num.getBody()).toBe(42);
    const bool = run({ threshold: 0 }, true, 'application/json');
    expect(bool.getHeader('content-encoding')).toBeNull();
    expect(bool.getBody()).toBe(true);
    // 빈 문자열·빈 바이너리 — 크래시 없이 원본 유지
    const empty = run({ threshold: 0 }, '', 'text/plain');
    expect(empty.getBody()).toBe('');
    expect(empty.getHeader('content-encoding')).toBeNull();
    const emptyBinBody = new Uint8Array(0);
    const emptyBin = run({ threshold: 0 }, emptyBinBody, null);
    expect(emptyBin.getHeader('content-encoding')).toBeNull();
    expect(emptyBin.getBody()).toBe(emptyBinBody);
  });

  it('[§9.2.1] POL-16 파라미터 있는 CT: json;charset 허용 · event-stream;charset 거부', () => {
    expect(run({ threshold: 0 }, largeBody(64), 'application/json; charset=utf-8').getHeader('content-encoding')).toBe('gzip');
    expect(run({ threshold: 0 }, largeBody(64), 'text/event-stream; charset=utf-8').getHeader('content-encoding')).toBeNull();
  });

  // ── EX ──
  it('[§9] POL-10 직렬화 불가 body(순환 참조·BigInt) → throw 없이 스킵', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    for (const body of [circular, { big: 1n }]) {
      const m = unwrap(compressionMiddleware({ threshold: 0 }));
      const response = mockHttpResponse({ body, contentType: 'application/json' });
      expect(() => m.handler(mockContext({ headers: makeRequestHeaders('gzip') }, response))).not.toThrow();
      // 직렬화 불가 body(순환 참조·BigInt)는 손대지 않고 그대로 남는다 — identity 비교
      expect(response.getBody()).toBe(body as never);
      expect(response.getHeader('content-encoding')).toBeNull();
    }
  });

  it('[§9.2.1] POL-11 filter 함수 throw → 안전 처리(무압축·원본 유지)', () => {
    const m = unwrap(compressionMiddleware({
      threshold: 0,
      filter: () => { throw new Error('filter exploded'); },
    }));
    const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
    expect(() => m.handler(mockContext({ headers: makeRequestHeaders('gzip') }, response))).not.toThrow();
    expect(response.getBody()).toBe(LARGE_BODY_OBJ);
    expect(response.getHeader('content-encoding')).toBeNull();
  });

  // ── SE ──
  it('[§9] POL-12 인스턴스 재사용: 연속 상이 요청 간 상태 격리', () => {
    const m = unwrap(compressionMiddleware());
    const r1 = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
    m.handler(mockContext({ headers: makeRequestHeaders('gzip') }, r1));
    const r2 = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
    m.handler(mockContext({ headers: makeRequestHeaders('br') }, r2));
    const r3 = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
    m.handler(mockContext({ headers: makeRequestHeaders() }, r3));
    expect(r1.getHeader('content-encoding')).toBe('gzip');
    expect(r2.getHeader('content-encoding')).toBe('br');
    expect(r3.getHeader('content-encoding')).toBeNull();
  });

  it('[§9] POL-13 옵션 객체 사후 변조 → 동작 불변 (encodings 비우기·breach 오염 각각)', () => {
    // (a) breach 없는 경로: 현행은 encodings 배열 참조를 공유한다 — 비우면 협상이 실패해선 안 된다
    const plain = { encodings: [CompressionCodec.Gzip], threshold: 0 };
    const m1 = unwrap(compressionMiddleware(plain));
    plain.encodings.length = 0;
    const r1 = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
    m1.handler(mockContext({ headers: makeRequestHeaders('gzip') }, r1));
    expect(r1.getHeader('content-encoding')).toBe('gzip');

    // (b) breach 객체 오염: 검증을 통과한 생성 시점 값(4096)이 유지되어야 한다
    const padded = { encodings: [CompressionCodec.Gzip], threshold: 0, breach: { maxPadding: 4096 } };
    const m2 = unwrap(compressionMiddleware(padded));
    padded.breach.maxPadding = -999;
    const r2 = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
    expect(() => m2.handler(mockContext({ headers: makeRequestHeaders('gzip') }, r2))).not.toThrow();
    expect(r2.getHeader('content-encoding')).toBe('gzip');
    const body = new Uint8Array(r2.getBody() as Uint8Array);
    // 유효한 패딩(FEXTRA padLen ≥ 1)이 실제로 적용된 온전한 gzip이어야 한다
    expect((body[3] ?? 0) & 0x04).toBe(0x04);
    const xlen = (body[10] ?? 0) | ((body[11] ?? 0) << 8);
    expect(xlen).toBeGreaterThanOrEqual(5);
    expect(() => Bun.gunzipSync(body)).not.toThrow();
  });

  it('[§9] POL-17 동시(async interleaved) 상이 AE 요청 → 교차 오염 없음', async () => {
    const m = unwrap(compressionMiddleware());
    const results = await Promise.all([
      (async () => {
        const r = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
        await Promise.resolve(); // interleave
        m.handler(mockContext({ headers: makeRequestHeaders('gzip') }, r));
        return r;
      })(),
      (async () => {
        const r = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
        m.handler(mockContext({ headers: makeRequestHeaders('br') }, r));
        await Promise.resolve();
        return r;
      })(),
      (async () => {
        const r = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
        await Promise.resolve();
        m.handler(mockContext({ headers: makeRequestHeaders() }, r));
        return r;
      })(),
    ]);
    expect(results[0].getHeader('content-encoding')).toBe('gzip');
    expect(results[1].getHeader('content-encoding')).toBe('br');
    expect(results[2].getHeader('content-encoding')).toBeNull();
  });
});
