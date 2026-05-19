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
});
