import { describe, expect, it } from 'bun:test';

import { CompressionCodec } from './enums';

describe('CompressionCodec', () => {
  // [§2.2.1] 생성하는 content coding 이름은 IANA HTTP Content Coding Registry의
  // 등록 이름과 byte-for-byte 일치해야 한다 (2025-10-02 갱신판 기준)
  it('[§2.2.1] should use IANA-registered content coding names as wire values', () => {
    expect(CompressionCodec.Gzip).toBe('gzip' as CompressionCodec);
    expect(CompressionCodec.Br).toBe('br' as CompressionCodec);
    expect(CompressionCodec.Deflate).toBe('deflate' as CompressionCodec);
    expect(CompressionCodec.Zstd).toBe('zstd' as CompressionCodec);
  });

  it('[§2.1.2] should not define identity as an applicable coding', () => {
    expect(Object.values(CompressionCodec)).not.toContain('identity');
  });

  it('should define exactly the four supported codecs (adding one requires compressor/level entries)', () => {
    expect((Object.values(CompressionCodec) as string[]).sort()).toEqual(['br', 'deflate', 'gzip', 'zstd']);
  });
});
