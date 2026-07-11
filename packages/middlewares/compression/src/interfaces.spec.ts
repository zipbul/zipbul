import { describe, expect, it } from 'bun:test';

import { CompressionError } from './interfaces';
import { CompressionErrorReason } from './enums';

// CompressionError 는 .reason 을 실은 공개 Error 서브클래스다(throw 기반 호출부용으로 export).
// constructor 가 message 를 super 로 전달하고 name/reason 을 세팅하는 동작만 검증한다.
describe('CompressionError', () => {
  it('should forward message to Error and expose name and reason', () => {
    const err = new CompressionError({
      reason: CompressionErrorReason.InvalidLevel,
      message: 'gzip level must be an integer between 1 and 9, got 99',
    });

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CompressionError');
    expect(err.message).toBe('gzip level must be an integer between 1 and 9, got 99');
    expect(err.reason).toBe(CompressionErrorReason.InvalidLevel);
  });
});
