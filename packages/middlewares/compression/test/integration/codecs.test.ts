import { describe, expect, it, spyOn } from 'bun:test';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';

import { compressionMiddleware } from '../../index';
import { CompressionCodec } from '../../src/enums';
import { LARGE_BODY_OBJ, LARGE_JSON, largeBody, makeRequestHeaders, mockContext, mockHttpResponse, unwrap } from './helpers';

function compressWith(codec: CompressionCodec, ae: string, body: unknown, contentType: string | null, opts?: object) {
  const m = unwrap(compressionMiddleware({ encodings: [codec], ...opts }));
  const response = mockHttpResponse({ body, contentType });
  m.handler(mockContext({ headers: makeRequestHeaders(ae) }, response));
  return response;
}

describe('codecs', () => {
  // ── HP: 라운드트립 ──
  it('[§5.1.1] COD-01 gzip 라운드트립', () => {
    const res = compressWith(CompressionCodec.Gzip, 'gzip', LARGE_BODY_OBJ, 'application/json');
    const decompressed = gunzipSync(res.getBody() as Uint8Array).toString('utf-8');
    expect(decompressed).toBe(LARGE_JSON);
  });

  it('[§5.3.1] COD-02 br 라운드트립', () => {
    const res = compressWith(CompressionCodec.Br, 'br', LARGE_BODY_OBJ, 'application/json');
    const decompressed = brotliDecompressSync(res.getBody() as Uint8Array).toString('utf-8');
    expect(decompressed).toBe(LARGE_JSON);
  });

  it('[§5.2.1] COD-03 deflate 라운드트립 (zlib-wrapped 해제)', () => {
    const res = compressWith(CompressionCodec.Deflate, 'deflate', LARGE_BODY_OBJ, 'application/json');
    const decompressed = inflateSync(res.getBody() as Uint8Array);
    expect(new TextDecoder().decode(decompressed)).toBe(LARGE_JSON);
  });

  it('[§5.4.1] COD-04 zstd 라운드트립', () => {
    const res = compressWith(CompressionCodec.Zstd, 'zstd', LARGE_BODY_OBJ, 'application/json');
    const decompressed = Bun.zstdDecompressSync(Buffer.from(res.getBody() as Uint8Array));
    expect(new TextDecoder().decode(decompressed)).toBe(LARGE_JSON);
  });

  it('[§5.1.2] COD-05 gzip 출력: ID1·ID2·CM 헤더 + trailer CRC32·ISIZE 원문 일치', () => {
    const res = compressWith(CompressionCodec.Gzip, 'gzip', LARGE_BODY_OBJ, 'application/json');
    const out = res.getBody() as Uint8Array;
    // 헤더 (RFC 1952 §2.3.1)
    expect(out[0]).toBe(0x1f);
    expect(out[1]).toBe(0x8b);
    expect(out[2]).toBe(0x08);
    // trailer: CRC32(원문) + ISIZE = 원문 길이 mod 2^32 (RFC 1952 §2.3.1)
    const original = new TextEncoder().encode(LARGE_JSON);
    const view = new DataView(out.buffer, out.byteOffset + out.byteLength - 8, 8);
    const crc32 = view.getUint32(0, true);
    const isize = view.getUint32(4, true);
    expect(isize).toBe(original.byteLength >>> 0);
    expect(crc32).toBe(Bun.hash.crc32(original) >>> 0);
  });

  it('[§5.2.1] COD-06 deflate 출력 CMF 하위 4비트 = 8 (zlib wrapper, raw 아님)', () => {
    const res = compressWith(CompressionCodec.Deflate, 'deflate', LARGE_BODY_OBJ, 'application/json');
    const out = res.getBody() as Uint8Array;
    expect((out[0] ?? 0) & 0x0f).toBe(8);
  });

  it('[§9.2.1] COD-07 레벨 반영: gzip level 1 vs 9 출력 크기 차등', () => {
    const highlyCompressible = { data: 'abcdefghij'.repeat(20_000) };
    const l1 = compressWith(CompressionCodec.Gzip, 'gzip', highlyCompressible, 'application/json', { level: { [CompressionCodec.Gzip]: 1 } });
    const l9 = compressWith(CompressionCodec.Gzip, 'gzip', highlyCompressible, 'application/json', { level: { [CompressionCodec.Gzip]: 9 } });
    const s1 = (l1.getBody() as Uint8Array).byteLength;
    const s9 = (l9.getBody() as Uint8Array).byteLength;
    expect(s9).toBeLessThanOrEqual(s1);
    // 라운드트립도 각각 성립
    expect(gunzipSync(l1.getBody() as Uint8Array).toString()).toBe(JSON.stringify(highlyCompressible));
    expect(gunzipSync(l9.getBody() as Uint8Array).toString()).toBe(JSON.stringify(highlyCompressible));
  });

  // ── ED ──
  it('[§9.2.1] COD-08 정확히 threshold 크기 body → 압축(경계 포함)', () => {
    const m = unwrap(compressionMiddleware({ threshold: 64 }));
    const response = mockHttpResponse({ body: 'a'.repeat(64), contentType: 'text/plain' });
    m.handler(mockContext({ headers: makeRequestHeaders('gzip') }, response));
    expect(response.getHeader('content-encoding')).toBe('gzip');
  });

  it('[§5.1.1] COD-09 멀티바이트 유니코드 body 라운드트립', () => {
    const unicode = '한글과 émoji 🗜️ mixed content — '.repeat(100);
    const res = compressWith(CompressionCodec.Gzip, 'gzip', unicode, 'text/plain');
    expect(gunzipSync(res.getBody() as Uint8Array).toString('utf-8')).toBe(unicode);
  });

  it('[§5.1.1] COD-10 Uint8Array·ArrayBuffer body 라운드트립', () => {
    const text = 'binary payload '.repeat(200);
    const u8 = compressWith(CompressionCodec.Gzip, 'gzip', new TextEncoder().encode(text), null, { threshold: 0 });
    expect(gunzipSync(u8.getBody() as Uint8Array).toString('utf-8')).toBe(text);
    const ab = compressWith(CompressionCodec.Gzip, 'gzip', new TextEncoder().encode(text).buffer, null, { threshold: 0 });
    expect(gunzipSync(ab.getBody() as Uint8Array).toString('utf-8')).toBe(text);
  });

  it('[§5.4.2·§5.4.3] COD-11 대형 body zstd → Frame Header Window_Size ≤ 8MB', () => {
    // 4MB 저압축성 body로 window descriptor 상한 검증
    const big = largeBody(4 * 1024 * 1024);
    const res = compressWith(CompressionCodec.Zstd, 'zstd', big, 'text/plain');
    const out = res.getBody() as Uint8Array;
    // Magic 0xFD2FB528 (LE)
    expect(out[0]).toBe(0x28);
    expect(out[1]).toBe(0xb5);
    expect(out[2]).toBe(0x2f);
    expect(out[3]).toBe(0xfd);
    // Frame_Header_Descriptor(byte 4): Single_Segment_Flag(bit 5)이 0이면 byte 5가 Window_Descriptor
    const fhd = out[4] ?? 0;
    const singleSegment = (fhd & 0x20) !== 0;
    if (!singleSegment) {
      const wd = out[5] ?? 0;
      const exponent = wd >> 3;
      const mantissa = wd & 0x07;
      const windowBase = 2 ** (10 + exponent);
      const windowSize = windowBase + (windowBase / 8) * mantissa;
      expect(windowSize).toBeLessThanOrEqual(8 * 1024 * 1024);
    } else {
      // Single segment: window = Frame_Content_Size — 4MB 원문이므로 8MB 이하
      expect(big.length).toBeLessThanOrEqual(8 * 1024 * 1024);
    }
    // 라운드트립
    expect(new TextDecoder().decode(Bun.zstdDecompressSync(Buffer.from(out)))).toBe(big);
  });

  it('[§5.4.4] COD-12 zstd 출력이 유효한 프레임 시퀀스(디코더 정상 소비)', () => {
    const res = compressWith(CompressionCodec.Zstd, 'zstd', LARGE_BODY_OBJ, 'application/json');
    expect(() => Bun.zstdDecompressSync(Buffer.from(res.getBody() as Uint8Array))).not.toThrow();
  });

  // ── EX ──
  it('[§9.2.3] COD-13 압축기 throw 시 원본 body·헤더 유지', () => {
    const spy = spyOn(Bun, 'gzipSync').mockImplementation(() => {
      throw new Error('injected compressor failure');
    });
    try {
      const m = unwrap(compressionMiddleware({ threshold: 0 }));
      const response = mockHttpResponse({
        body: LARGE_BODY_OBJ,
        contentType: 'application/json',
        headers: { 'content-length': '2061', etag: '"keep"' },
      });
      expect(() => m.handler(mockContext({ headers: makeRequestHeaders('gzip') }, response))).not.toThrow();
      // 압축 실패 → 원본 그대로, CE/CL/ETag 무변조
      expect(response.getBody()).toBe(LARGE_BODY_OBJ);
      expect(response.getHeader('content-encoding')).toBeNull();
      expect(response.getHeader('content-length')).toBe('2061');
      expect(response.getHeader('etag')).toBe('"keep"');
    } finally {
      spy.mockRestore();
    }
  });

  // ── SE ──
  it('[§5] COD-14 동일 입력·레벨 반복 압축 → 결정적 출력', () => {
    const a = compressWith(CompressionCodec.Gzip, 'gzip', LARGE_BODY_OBJ, 'application/json');
    const b = compressWith(CompressionCodec.Gzip, 'gzip', LARGE_BODY_OBJ, 'application/json');
    expect(a.getBody() as Uint8Array).toEqual(b.getBody() as Uint8Array);
  });
});
