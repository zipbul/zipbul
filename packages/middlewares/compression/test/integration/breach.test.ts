import { describe, expect, it } from 'bun:test';

import { compressionMiddleware } from '../../index';
import { CompressionCodec } from '../../src/enums';
import { LARGE_BODY_OBJ, makeRequestHeaders, mockContext, mockHttpResponse, unwrap } from './helpers';

function runBreach(opts: Parameters<typeof compressionMiddleware>[0], ae: string) {
  const m = unwrap(compressionMiddleware(opts));
  const response = mockHttpResponse({ body: LARGE_BODY_OBJ, contentType: 'application/json' });
  m.handler(mockContext({ headers: makeRequestHeaders(ae) }, response));
  return response;
}

describe('breach (HTB padding)', () => {
  // ── HP ──
  it('[§6.1.1] BRC-01 gzip 패딩: FEXTRA 플래그 + ZP 서브필드 + 라운드트립 무손상', () => {
    const res = runBreach({ breach: { maxPadding: 32 } }, 'gzip');
    const body = res.getBody() as Uint8Array;
    expect((body[3] ?? 0) & 0x04).toBe(0x04); // FEXTRA
    expect(body[12]).toBe(0x5a); // 'Z'
    expect(body[13]).toBe(0x50); // 'P'
    const decompressed = Bun.gunzipSync(new Uint8Array(body));
    expect(JSON.parse(Buffer.from(decompressed).toString())).toEqual(LARGE_BODY_OBJ);
  });

  it('[§6.2.1·§6.2.2] BRC-02 zstd 패딩: skippable magic 0x184D2A50(LE) + 라운드트립 무손상', () => {
    const res = runBreach({ encodings: [CompressionCodec.Zstd], breach: { maxPadding: 32 } }, 'zstd');
    const body = res.getBody() as Uint8Array;
    expect(body[0]).toBe(0x50);
    expect(body[1]).toBe(0x2a);
    expect(body[2]).toBe(0x4d);
    expect(body[3]).toBe(0x18);
    const decompressed = Bun.zstdDecompressSync(body);
    expect(JSON.parse(Buffer.from(decompressed).toString())).toEqual(LARGE_BODY_OBJ);
  });

  it('[§9.3.1] BRC-03 30회 반복 → 출력 크기 분산 존재 (gzip·zstd 각)', () => {
    const cases: Array<[Parameters<typeof compressionMiddleware>[0], string]> = [
      [{ breach: { maxPadding: 64 } }, 'gzip'],
      [{ encodings: [CompressionCodec.Zstd], breach: { maxPadding: 64 } }, 'zstd'],
    ];
    for (const [opts, ae] of cases) {
      const sizes = new Set<number>();
      for (let i = 0; i < 30; i++) {
        sizes.add((runBreach(opts, ae).getBody() as Uint8Array).byteLength);
      }
      expect(sizes.size).toBeGreaterThan(1);
    }
  });

  // ── NE ──
  it('[§9.3.1] BRC-04 breach 설정 + br 협상 요청 → BREACH-safe 코딩으로 폴백', () => {
    const res = runBreach({
      encodings: [CompressionCodec.Br, CompressionCodec.Gzip, CompressionCodec.Deflate],
      breach: { maxPadding: 16 },
    }, 'br, gzip, deflate');
    expect(res.getHeader('content-encoding')).toBe('gzip');
  });

  it('[§9.3.1] BRC-05 breach 미설정 → 패딩 없음(FEXTRA 미설정)', () => {
    const res = runBreach(undefined, 'gzip');
    const body = res.getBody() as Uint8Array;
    expect((body[3] ?? 0) & 0x04).toBe(0);
  });

  it('[§9.3.1] BRC-12 breach 활성 + 클라 AE에 BREACH-safe 코딩 무포함 → identity(무압축)', () => {
    // effectiveEncodings=[gzip] (br은 padding 불가로 제외), 클라는 br만 수락 →
    // 협상 실패 → identity 송출. body는 원본 그대로여야 한다
    const res = runBreach({
      encodings: [CompressionCodec.Gzip, CompressionCodec.Br],
      breach: { maxPadding: 16 },
    }, 'br');
    expect(res.getHeader('content-encoding')).toBeNull();
    expect(res.getBody()).toBe(LARGE_BODY_OBJ);
  });

  // ── ED ──
  it('[§6.1.1] BRC-06 maxPadding=1 → 정확히 1바이트 패딩(XLEN=5)', () => {
    const res = runBreach({ breach: { maxPadding: 1 } }, 'gzip');
    const body = res.getBody() as Uint8Array;
    const xlen = (body[10] ?? 0) | ((body[11] ?? 0) << 8);
    expect(xlen).toBe(5); // 4(subfield header) + 1
    expect(() => Bun.gunzipSync(new Uint8Array(body))).not.toThrow();
  });

  it('[§6.1.1] BRC-07 maxPadding=4096 상한 정상 동작', () => {
    const res = runBreach({ breach: { maxPadding: 4096 } }, 'gzip');
    const body = res.getBody() as Uint8Array;
    const xlen = (body[10] ?? 0) | ((body[11] ?? 0) << 8);
    expect(xlen).toBeGreaterThanOrEqual(5);
    expect(xlen).toBeLessThanOrEqual(4 + 4096);
    expect(() => Bun.gunzipSync(new Uint8Array(body))).not.toThrow();
  });

  // BRC-08 (구 XLEN 오버플로 임계) 삭제 — 통합 경로에선 오버플로 도달 불가라
  // gunzip 무throw만 확인하던 공허 단언이었다. 실 오버플로 경계는 htb.spec.ts의
  // "XLEN boundary" 유닛 테스트가 결정적으로 검증한다.

  it('[§6.2.1] BRC-09 zstd Frame_Size 리틀엔디언 인코딩 정확성', () => {
    const res = runBreach({ encodings: [CompressionCodec.Zstd], breach: { maxPadding: 16 } }, 'zstd');
    const body = res.getBody() as Uint8Array;
    const frameSize = (body[4] ?? 0) | ((body[5] ?? 0) << 8) | ((body[6] ?? 0) << 16) | ((body[7] ?? 0) << 24);
    expect(frameSize).toBeGreaterThanOrEqual(1);
    expect(frameSize).toBeLessThanOrEqual(16);
    expect(body.byteLength).toBeGreaterThan(8 + frameSize);
  });

  // ── SE ──
  it('[§2.3.3] BRC-10 패딩 후에도 CL = 최종 바이트 수 (gzip·zstd 각)', () => {
    const gz = runBreach({ breach: { maxPadding: 32 } }, 'gzip');
    expect(gz.getHeader('content-length')).toBe(String((gz.getBody() as Uint8Array).byteLength));
    const zs = runBreach({ encodings: [CompressionCodec.Zstd], breach: { maxPadding: 32 } }, 'zstd');
    expect(zs.getHeader('content-length')).toBe(String((zs.getBody() as Uint8Array).byteLength));
  });

  it('[§9.3.1] BRC-11 패딩 데이터 zero-fill(정보 누출 없음)', () => {
    const res = runBreach({ breach: { maxPadding: 32 } }, 'gzip');
    const body = res.getBody() as Uint8Array;
    const xlen = (body[10] ?? 0) | ((body[11] ?? 0) << 8);
    const padLen = xlen - 4;
    const padding = body.subarray(16, 16 + padLen);
    expect(padding.every((b) => b === 0)).toBe(true);
  });
});
