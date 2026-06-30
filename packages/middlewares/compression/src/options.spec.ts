import { describe, expect, it } from 'bun:test';
import { CompressionCodec } from './enums';
import { isErr } from '@zipbul/result';
import { resolveCompressionOptions, validateCompressionOptions } from './options';
import { DEFAULT_ENCODINGS, DEFAULT_FILTER, DEFAULT_LEVELS, DEFAULT_THRESHOLD } from './constants';
import { CompressionErrorReason } from './enums';
import type { CompressionOptions } from './interfaces';
import type { ResolvedCompressionOptions } from './types';

function makeResolved(overrides?: Partial<ResolvedCompressionOptions>): ResolvedCompressionOptions {
  return {
    encodings: [CompressionCodec.Gzip],
    threshold: 1024,
    filter: () => true,
    level: { ...DEFAULT_LEVELS },
    ...overrides,
  };
}

describe('resolveCompressionOptions', () => {
  it('should return all defaults when options is undefined', () => {
    const result = resolveCompressionOptions(undefined);

    expect(result.encodings).toEqual(DEFAULT_ENCODINGS);
    expect(result.threshold).toBe(DEFAULT_THRESHOLD);
    expect(result.filter).toBe(DEFAULT_FILTER);
    expect(result.level).toEqual(DEFAULT_LEVELS);
  });

  it('should return all defaults when options is empty object', () => {
    const result = resolveCompressionOptions({});

    expect(result.encodings).toEqual(DEFAULT_ENCODINGS);
    expect(result.threshold).toBe(DEFAULT_THRESHOLD);
    expect(result.filter).toBe(DEFAULT_FILTER);
    expect(result.level).toEqual(DEFAULT_LEVELS);
  });

  it('should use provided values when all fields specified', () => {
    const filter = (ct: string) => ct === 'text/plain';
    const result = resolveCompressionOptions({
      encodings: [CompressionCodec.Zstd],
      threshold: 512,
      filter,
      level: { [CompressionCodec.Br]: 8, [CompressionCodec.Gzip]: 3, [CompressionCodec.Deflate]: 2, [CompressionCodec.Zstd]: 10 },
    });

    expect(result.encodings).toEqual([CompressionCodec.Zstd]);
    expect(result.threshold).toBe(512);
    expect(result.filter).toBe(filter);
    expect(result.level).toEqual({ [CompressionCodec.Br]: 8, [CompressionCodec.Gzip]: 3, [CompressionCodec.Deflate]: 2, [CompressionCodec.Zstd]: 10 });
  });

  it('should merge partial level with defaults via spread', () => {
    const result = resolveCompressionOptions({ level: { [CompressionCodec.Gzip]: 1 } });

    expect(result.level[CompressionCodec.Gzip]).toBe(1);
    expect(result.level[CompressionCodec.Br]).toBe(DEFAULT_LEVELS[CompressionCodec.Br]);
    expect(result.level[CompressionCodec.Deflate]).toBe(DEFAULT_LEVELS[CompressionCodec.Deflate]);
    expect(result.level[CompressionCodec.Zstd]).toBe(DEFAULT_LEVELS[CompressionCodec.Zstd]);
  });

  it('should pass through empty encodings array without validation', () => {
    const result = resolveCompressionOptions({ encodings: [] });

    expect(result.encodings).toEqual([]);
  });

  it('should pass through NaN threshold without validation', () => {
    const result = resolveCompressionOptions({ threshold: NaN });

    expect(result.threshold).toBeNaN();
  });

  it('should not default threshold=0 when given falsy but not nullish value', () => {
    const result = resolveCompressionOptions({ threshold: 0 });

    expect(result.threshold).toBe(0);
  });

  it('should produce equal result for undefined and empty object', () => {
    const fromUndefined = resolveCompressionOptions(undefined);
    const fromEmpty = resolveCompressionOptions({});

    expect(fromUndefined.encodings).toEqual(fromEmpty.encodings);
    expect(fromUndefined.threshold).toBe(fromEmpty.threshold);
    expect(fromUndefined.filter).toBe(fromEmpty.filter);
    expect(fromUndefined.level).toEqual(fromEmpty.level);
  });

  it('should override only specified levels via spread when partial level provided', () => {
    const result = resolveCompressionOptions({ level: { [CompressionCodec.Zstd]: 15 } });

    expect(result.level[CompressionCodec.Zstd]).toBe(15);
    expect(result.level[CompressionCodec.Gzip]).toBe(DEFAULT_LEVELS[CompressionCodec.Gzip]);
  });

  it('should return same result when given same input', () => {
    const opts: CompressionOptions = { encodings: [CompressionCodec.Gzip], threshold: 100 };
    const a = resolveCompressionOptions(opts);
    const b = resolveCompressionOptions(opts);

    expect(a.encodings).toEqual(b.encodings);
    expect(a.threshold).toBe(b.threshold);
    expect(a.level).toEqual(b.level);
  });
});

describe('validateCompressionOptions', () => {
  it('should return undefined when all options are valid', () => {
    const resolved = makeResolved();
    const result = validateCompressionOptions(resolved);
    expect(result).toBeUndefined();
  });

  it('should accept gzip level at min boundary when level is 1', () => {
    const resolved = makeResolved({ level: { ...DEFAULT_LEVELS, [CompressionCodec.Gzip]: 1 } });
    const result = validateCompressionOptions(resolved);
    expect(result).toBeUndefined();
  });

  it('should accept gzip level at max boundary when level is 9', () => {
    const resolved = makeResolved({ level: { ...DEFAULT_LEVELS, [CompressionCodec.Gzip]: 9 } });
    const result = validateCompressionOptions(resolved);
    expect(result).toBeUndefined();
  });

  it('should accept brotli level at min boundary when level is 0', () => {
    const resolved = makeResolved({ level: { ...DEFAULT_LEVELS, [CompressionCodec.Br]: 0 } });
    const result = validateCompressionOptions(resolved);
    expect(result).toBeUndefined();
  });

  it('should accept brotli level at max boundary when level is 11', () => {
    const resolved = makeResolved({ level: { ...DEFAULT_LEVELS, [CompressionCodec.Br]: 11 } });
    const result = validateCompressionOptions(resolved);
    expect(result).toBeUndefined();
  });

  it('should accept zstd level boundaries when level is 1 and 19', () => {
    const minResult = validateCompressionOptions(
      makeResolved({ level: { ...DEFAULT_LEVELS, [CompressionCodec.Zstd]: 1 } }),
    );
    const maxResult = validateCompressionOptions(
      makeResolved({ level: { ...DEFAULT_LEVELS, [CompressionCodec.Zstd]: 19 } }),
    );
    expect(minResult).toBeUndefined();
    expect(maxResult).toBeUndefined();
  });

  it('should accept deflate level boundaries when level is 1 and 9', () => {
    const minResult = validateCompressionOptions(
      makeResolved({ level: { ...DEFAULT_LEVELS, [CompressionCodec.Deflate]: 1 } }),
    );
    const maxResult = validateCompressionOptions(
      makeResolved({ level: { ...DEFAULT_LEVELS, [CompressionCodec.Deflate]: 9 } }),
    );
    expect(minResult).toBeUndefined();
    expect(maxResult).toBeUndefined();
  });

  it('should return EmptyEncodings when encodings is empty', () => {
    const resolved = makeResolved({ encodings: [] });
    const result = validateCompressionOptions(resolved);

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) throw new Error("expected Err"); expect(result.data.reason).toBe(CompressionErrorReason.EmptyEncodings);
  });

  it('should return InvalidEncodings when unknown encoding provided', () => {
    const resolved = makeResolved({ encodings: ['lz4' as CompressionCodec] });
    const result = validateCompressionOptions(resolved);

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) throw new Error("expected Err"); expect(result.data.reason).toBe(CompressionErrorReason.InvalidEncodings);
  });

  it('should return InvalidThreshold when threshold is negative', () => {
    const resolved = makeResolved({ threshold: -1 });
    const result = validateCompressionOptions(resolved);

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) throw new Error("expected Err"); expect(result.data.reason).toBe(CompressionErrorReason.InvalidThreshold);
  });

  it('should return InvalidThreshold when threshold is NaN', () => {
    const resolved = makeResolved({ threshold: NaN });
    const result = validateCompressionOptions(resolved);

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) throw new Error("expected Err"); expect(result.data.reason).toBe(CompressionErrorReason.InvalidThreshold);
  });

  it('should return InvalidLevel when level exceeds max', () => {
    const resolved = makeResolved({ level: { ...DEFAULT_LEVELS, [CompressionCodec.Gzip]: 10 } });
    const result = validateCompressionOptions(resolved);

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) throw new Error("expected Err"); expect(result.data.reason).toBe(CompressionErrorReason.InvalidLevel);
  });

  it('should return InvalidLevel when level is below min', () => {
    const resolved = makeResolved({ level: { ...DEFAULT_LEVELS, [CompressionCodec.Gzip]: 0 } });
    const result = validateCompressionOptions(resolved);

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) throw new Error("expected Err"); expect(result.data.reason).toBe(CompressionErrorReason.InvalidLevel);
  });

  it('should return InvalidLevel when level is fractional', () => {
    const resolved = makeResolved({ level: { ...DEFAULT_LEVELS, [CompressionCodec.Gzip]: 5.5 } });
    const result = validateCompressionOptions(resolved);

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) throw new Error("expected Err"); expect(result.data.reason).toBe(CompressionErrorReason.InvalidLevel);
  });

  it('should accept threshold=0 as valid when threshold is exactly 0', () => {
    const resolved = makeResolved({ threshold: 0 });
    const result = validateCompressionOptions(resolved);
    expect(result).toBeUndefined();
  });

  it('should accept threshold=-0 as valid when threshold is negative zero', () => {
    const resolved = makeResolved({ threshold: -0 });
    const result = validateCompressionOptions(resolved);
    expect(result).toBeUndefined();
  });

  it('should skip level validation when level is undefined for an encoding', () => {
    const resolved = makeResolved({
      level: {
        [CompressionCodec.Gzip]: 6,
        [CompressionCodec.Deflate]: 6,
      } as Record<CompressionCodec, number>,
    });
    const result = validateCompressionOptions(resolved);
    expect(result).toBeUndefined();
  });

  it('should check empty encodings before threshold when both are invalid', () => {
    const resolved = makeResolved({ encodings: [], threshold: -1 });
    const result = validateCompressionOptions(resolved);

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) throw new Error("expected Err"); expect(result.data.reason).toBe(CompressionErrorReason.EmptyEncodings);
  });

  it('should check invalid threshold before levels when both are invalid', () => {
    const resolved = makeResolved({
      threshold: NaN,
      level: { ...DEFAULT_LEVELS, [CompressionCodec.Gzip]: 100 },
    });
    const result = validateCompressionOptions(resolved);

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) throw new Error("expected Err"); expect(result.data.reason).toBe(CompressionErrorReason.InvalidThreshold);
  });

  it('should validate level for all ContentEncoding enum values regardless of encodings array', () => {
    const resolved = makeResolved({
      encodings: [CompressionCodec.Gzip],
      level: { ...DEFAULT_LEVELS, [CompressionCodec.Br]: 99 },
    });
    const result = validateCompressionOptions(resolved);

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) throw new Error("expected Err"); expect(result.data.reason).toBe(CompressionErrorReason.InvalidLevel);
  });

  // --- Breach validation ---

  it('should accept valid breach options', () => {
    const resolved = makeResolved({ encodings: [CompressionCodec.Gzip] });
    const result = validateCompressionOptions(resolved, { maxPadding: 32 });
    expect(result).toBeUndefined();
  });

  it('should return InvalidBreach when maxPadding is 0', () => {
    const resolved = makeResolved({ encodings: [CompressionCodec.Gzip] });
    const result = validateCompressionOptions(resolved, { maxPadding: 0 });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) throw new Error("expected Err"); expect(result.data.reason).toBe(CompressionErrorReason.InvalidBreach);
  });

  it('should return InvalidBreach when maxPadding is negative', () => {
    const resolved = makeResolved({ encodings: [CompressionCodec.Gzip] });
    const result = validateCompressionOptions(resolved, { maxPadding: -1 });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) throw new Error("expected Err"); expect(result.data.reason).toBe(CompressionErrorReason.InvalidBreach);
  });

  it('should return InvalidBreach when maxPadding is fractional', () => {
    const resolved = makeResolved({ encodings: [CompressionCodec.Gzip] });
    const result = validateCompressionOptions(resolved, { maxPadding: 1.5 });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) throw new Error("expected Err"); expect(result.data.reason).toBe(CompressionErrorReason.InvalidBreach);
  });

  it('should return InvalidBreach when maxPadding exceeds 4096', () => {
    const resolved = makeResolved({ encodings: [CompressionCodec.Gzip] });
    const result = validateCompressionOptions(resolved, { maxPadding: 5000 });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) throw new Error("expected Err"); expect(result.data.reason).toBe(CompressionErrorReason.InvalidBreach);
  });

  it('should return InvalidBreach when maxPadding is NaN', () => {
    const resolved = makeResolved({ encodings: [CompressionCodec.Gzip] });
    const result = validateCompressionOptions(resolved, { maxPadding: NaN });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) throw new Error("expected Err"); expect(result.data.reason).toBe(CompressionErrorReason.InvalidBreach);
  });

  it('should return InvalidBreach when no BREACH-safe encoding available', () => {
    const resolved = makeResolved({ encodings: [CompressionCodec.Br] });
    const result = validateCompressionOptions(resolved, { maxPadding: 32 });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) throw new Error("expected Err"); expect(result.data.reason).toBe(CompressionErrorReason.InvalidBreach);
  });

  it('should accept breach when at least one BREACH-safe encoding exists', () => {
    const resolved = makeResolved({ encodings: [CompressionCodec.Br, CompressionCodec.Zstd] });
    const result = validateCompressionOptions(resolved, { maxPadding: 32 });
    expect(result).toBeUndefined();
  });

  it('should skip breach validation when breach is undefined', () => {
    const resolved = makeResolved({ encodings: [CompressionCodec.Br] });
    const result = validateCompressionOptions(resolved);
    expect(result).toBeUndefined();
  });
});
