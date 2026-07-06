import { describe, expect, it } from 'bun:test';
import { isErr } from '@zipbul/result';

import { compressionMiddleware, CompressionErrorReason } from '../../index';
import { CompressionCodec } from '../../src/enums';

function expectErr(result: ReturnType<typeof compressionMiddleware>, reason: CompressionErrorReason) {
  expect(isErr(result)).toBe(true);
  if (isErr(result)) {
    expect(result.data.reason).toBe(reason);
  }
}

describe('factory (생성 검증)', () => {
  // ── HP ──
  it('FAC-01 옵션 없음·빈 객체·부분 옵션 → 정상 정의 반환', () => {
    expect(isErr(compressionMiddleware())).toBe(false);
    expect(isErr(compressionMiddleware({}))).toBe(false);
    expect(isErr(compressionMiddleware({ threshold: 512 }))).toBe(false);
    expect(isErr(compressionMiddleware({ encodings: [CompressionCodec.Zstd] }))).toBe(false);
  });

  // ── NE ──
  it('FAC-02 encodings: [] → Err(EmptyEncodings)', () => {
    expectErr(compressionMiddleware({ encodings: [] }), CompressionErrorReason.EmptyEncodings);
  });

  it('[§2.2.1] FAC-03 미등록 인코딩 lz4 → Err(InvalidEncodings)', () => {
    expectErr(
      compressionMiddleware({ encodings: ['lz4' as unknown as CompressionCodec] }),
      CompressionErrorReason.InvalidEncodings,
    );
  });

  it('FAC-04 threshold 음수·NaN·Infinity → Err(InvalidThreshold)', () => {
    for (const threshold of [-1, NaN, Infinity]) {
      expectErr(compressionMiddleware({ threshold }), CompressionErrorReason.InvalidThreshold);
    }
  });

  it('[§5.4.3] FAC-05 레벨 범위 밖·소수 → Err(InvalidLevel)', () => {
    expectErr(compressionMiddleware({ level: { [CompressionCodec.Gzip]: 0 } }), CompressionErrorReason.InvalidLevel);
    expectErr(compressionMiddleware({ level: { [CompressionCodec.Gzip]: 10 } }), CompressionErrorReason.InvalidLevel);
    expectErr(compressionMiddleware({ level: { [CompressionCodec.Br]: 12 } }), CompressionErrorReason.InvalidLevel);
    expectErr(compressionMiddleware({ level: { [CompressionCodec.Zstd]: 0 } }), CompressionErrorReason.InvalidLevel);
    expectErr(
      compressionMiddleware({ encodings: [CompressionCodec.Zstd], level: { [CompressionCodec.Zstd]: 20 } }),
      CompressionErrorReason.InvalidLevel,
    );
    expectErr(compressionMiddleware({ level: { [CompressionCodec.Gzip]: 5.5 } }), CompressionErrorReason.InvalidLevel);
  });

  it('FAC-06 breach.maxPadding 0·-1·1.5·4097·NaN → Err(InvalidBreach)', () => {
    for (const maxPadding of [0, -1, 1.5, 4097, NaN]) {
      expectErr(compressionMiddleware({ breach: { maxPadding } }), CompressionErrorReason.InvalidBreach);
    }
  });

  it('FAC-07 breach + BREACH-safe 인코딩 전무 → Err(InvalidBreach)', () => {
    expectErr(
      compressionMiddleware({ encodings: [CompressionCodec.Br], breach: { maxPadding: 32 } }),
      CompressionErrorReason.InvalidBreach,
    );
    expectErr(
      compressionMiddleware({ encodings: [CompressionCodec.Deflate], breach: { maxPadding: 32 } }),
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
      expect(isErr(compressionMiddleware({ level: { [codec]: level } }))).toBe(false);
    }
  });

  // ── SE ──
  it('FAC-09 Err 반환 시 재호출·정상 생성에 영향 없음(전역 부수효과 없음)', () => {
    expect(isErr(compressionMiddleware({ encodings: [] }))).toBe(true);
    expect(isErr(compressionMiddleware())).toBe(false);
    expect(isErr(compressionMiddleware({ encodings: [] }))).toBe(true);
    expect(isErr(compressionMiddleware())).toBe(false);
  });

  it('FAC: breach + safe 인코딩 혼재 → 정상 생성', () => {
    expect(isErr(compressionMiddleware({
      encodings: [CompressionCodec.Br, CompressionCodec.Zstd],
      breach: { maxPadding: 32 },
    }))).toBe(false);
  });
});
