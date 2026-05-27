import { describe, expect, it } from 'bun:test';

import { CorsErrorReason } from './enums';
import { CorsError } from './interfaces';

describe('CorsError', () => {
  it('should set name to the literal "CorsError"', () => {
    const err = new CorsError({ reason: CorsErrorReason.InvalidOrigin, message: 'x' });
    expect(err.name).toBe('CorsError');
  });

  it('should set message from data.message', () => {
    const err = new CorsError({ reason: CorsErrorReason.InvalidOrigin, message: 'origin is invalid' });
    expect(err.message).toBe('origin is invalid');
  });

  it('should set reason from data.reason', () => {
    const err = new CorsError({ reason: CorsErrorReason.InvalidMaxAge, message: 'x' });
    expect(err.reason).toBe(CorsErrorReason.InvalidMaxAge);
  });

  it('should be an instance of Error', () => {
    const err = new CorsError({ reason: CorsErrorReason.InvalidOrigin, message: 'x' });
    expect(err).toBeInstanceOf(Error);
  });

  it('should be an instance of CorsError', () => {
    const err = new CorsError({ reason: CorsErrorReason.InvalidOrigin, message: 'x' });
    expect(err).toBeInstanceOf(CorsError);
  });

  it('should preserve original thrown value in cause when data.cause is provided', () => {
    const original = new Error('boom');
    const err = new CorsError({ reason: CorsErrorReason.OriginFunctionError, message: 'x', cause: original });
    expect(err.cause).toBe(original);
  });

  it('should leave cause undefined when data.cause is omitted', () => {
    const err = new CorsError({ reason: CorsErrorReason.InvalidOrigin, message: 'x' });
    expect(err.cause).toBeUndefined();
  });

  // ── own-property immutability + instance extensibility ──

  it('should mark reason as non-writable', () => {
    'use strict';
    const err = new CorsError({ reason: CorsErrorReason.InvalidOrigin, message: 'x' });
    expect(() => {
      (err as unknown as { reason: string }).reason = CorsErrorReason.InvalidMaxAge;
    }).toThrow(TypeError);
    expect(err.reason).toBe(CorsErrorReason.InvalidOrigin);
  });

  it('should mark reason as non-configurable', () => {
    const err = new CorsError({ reason: CorsErrorReason.InvalidOrigin, message: 'x' });
    expect(() =>
      Object.defineProperty(err, 'reason', { value: CorsErrorReason.InvalidMaxAge, writable: true }),
    ).toThrow(TypeError);
  });

  it('should mark message as non-writable', () => {
    'use strict';
    const err = new CorsError({ reason: CorsErrorReason.InvalidOrigin, message: 'origin is invalid' });
    expect(() => {
      (err as unknown as { message: string }).message = 'rewritten';
    }).toThrow(TypeError);
    expect(err.message).toBe('origin is invalid');
  });

  it('should mark cause as non-writable when provided', () => {
    'use strict';
    const original = new Error('boom');
    const err = new CorsError({ reason: CorsErrorReason.OriginFunctionError, message: 'x', cause: original });
    expect(() => {
      (err as unknown as { cause: unknown }).cause = new Error('other');
    }).toThrow(TypeError);
    expect(err.cause).toBe(original);
  });

  it('should keep the instance extensible so subclasses can add own properties', () => {
    class AppCorsError extends CorsError {
      public readonly requestId: string;
      constructor(requestId: string) {
        super({ reason: CorsErrorReason.InvalidOrigin, message: 'x' });
        this.requestId = requestId;
      }
    }
    const err = new AppCorsError('req-42');
    expect(err.requestId).toBe('req-42');
    expect(err.reason).toBe(CorsErrorReason.InvalidOrigin);
    expect(err).toBeInstanceOf(CorsError);
  });
});
