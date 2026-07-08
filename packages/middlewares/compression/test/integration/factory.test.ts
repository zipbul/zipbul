import { describe, expect, it } from 'bun:test';

import { compressionMiddleware, CompressionError, CompressionErrorReason } from '../../index';
import { CompressionCodec } from '../../src/enums';

// compressionMiddleware validates options at boot and THROWS CompressionError on
// invalid options (a programmer error), rather than returning a Result.
function expectThrows(fn: () => unknown, reason: CompressionErrorReason) {
  expect(fn).toThrow(CompressionError);
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(CompressionError);
    expect((e as CompressionError).reason).toBe(reason);
  }
}

describe('factory (생성 검증)', () => {
  // ── HP ──
  it('FAC-01 옵션 없음·빈 객체·부분 옵션 → 정상 정의 반환', () => {
    expect(() => compressionMiddleware()).not.toThrow();
    expect(() => compressionMiddleware({})).not.toThrow();
    expect(() => compressionMiddleware({ threshold: 512 })).not.toThrow();
    expect(() => compressionMiddleware({ encodings: [CompressionCodec.Zstd] })).not.toThrow();
  });

  // ── NE ──
  it('FAC-02 encodings: [] → throw(EmptyEncodings)', () => {
    expectThrows(() => compressionMiddleware({ encodings: [] }), CompressionErrorReason.EmptyEncodings);
  });

  it('[§2.2.1] FAC-03 미등록 인코딩 lz4 → throw(InvalidEncodings)', () => {
    expectThrows(
      () => compressionMiddleware({ encodings: ['lz4' as unknown as CompressionCodec] }),
      CompressionErrorReason.InvalidEncodings,
    );
  });

  it('FAC-04 threshold 음수·NaN·Infinity → throw(InvalidThreshold)', () => {
    for (const threshold of [-1, NaN, Infinity]) {
      expectThrows(() => compressionMiddleware({ threshold }), CompressionErrorReason.InvalidThreshold);
    }
  });

  it('[§5.4.3] FAC-05 레벨 범위 밖·소수 → throw(InvalidLevel)', () => {
    expectThrows(() => compressionMiddleware({ level: { [CompressionCodec.Gzip]: 0 } }), CompressionErrorReason.InvalidLevel);
    expectThrows(() => compressionMiddleware({ level: { [CompressionCodec.Gzip]: 10 } }), CompressionErrorReason.InvalidLevel);
    expectThrows(() => compressionMiddleware({ level: { [CompressionCodec.Br]: 12 } }), CompressionErrorReason.InvalidLevel);
    expectThrows(() => compressionMiddleware({ level: { [CompressionCodec.Zstd]: 0 } }), CompressionErrorReason.InvalidLevel);
    expectThrows(
      () => compressionMiddleware({ encodings: [CompressionCodec.Zstd], level: { [CompressionCodec.Zstd]: 20 } }),
      CompressionErrorReason.InvalidLevel,
    );
    expectThrows(() => compressionMiddleware({ level: { [CompressionCodec.Gzip]: 5.5 } }), CompressionErrorReason.InvalidLevel);
  });

  it('FAC-06 breach.maxPadding 0·-1·1.5·4097·NaN → throw(InvalidBreach)', () => {
    for (const maxPadding of [0, -1, 1.5, 4097, NaN]) {
      expectThrows(() => compressionMiddleware({ breach: { maxPadding } }), CompressionErrorReason.InvalidBreach);
    }
  });

  it('FAC-07 breach + BREACH-safe 인코딩 전무 → throw(InvalidBreach)', () => {
    expectThrows(
      () => compressionMiddleware({ encodings: [CompressionCodec.Br], breach: { maxPadding: 32 } }),
      CompressionErrorReason.InvalidBreach,
    );
    expectThrows(
      () => compressionMiddleware({ encodings: [CompressionCodec.Deflate], breach: { maxPadding: 32 } }),
      CompressionErrorReason.InvalidBreach,
    );
  });

  // ── ED ──
  it('FAC-08 각 코덱 레벨 min/max 경계 정확 수용', () => {
    const boundaries: Array<[CompressionCodec, number]> = [
      [CompressionCodec.Gzip, 1], [CompressionCodec.Gzip, 9],
      [CompressionCodec.Deflate, 1], [CompressionCodec.Deflate, 9],
      [CompressionCodec.Br, 0], [CompressionCodec.Br, 11],
      [CompressionCodec.Zstd, 1], [CompressionCodec.Zstd, 19],
    ];
    for (const [codec, level] of boundaries) {
      expect(() => compressionMiddleware({ level: { [codec]: level } })).not.toThrow();
    }
  });

  // ── SE ──
  it('FAC-09 throw 후 재호출·정상 생성에 영향 없음(전역 부수효과 없음)', () => {
    expect(() => compressionMiddleware({ encodings: [] })).toThrow();
    expect(() => compressionMiddleware()).not.toThrow();
    expect(() => compressionMiddleware({ encodings: [] })).toThrow();
    expect(() => compressionMiddleware()).not.toThrow();
  });

  it('FAC: breach + safe 인코딩 혼재 → 정상 생성', () => {
    expect(() => compressionMiddleware({
      encodings: [CompressionCodec.Br, CompressionCodec.Zstd],
      breach: { maxPadding: 32 },
    })).not.toThrow();
  });
});
