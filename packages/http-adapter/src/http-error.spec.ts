import { describe, expect, it } from 'bun:test';
import { HttpStatus } from './enums';
import { isErr } from '@zipbul/result';

import { httpError } from './http-error';

describe('httpError', () => {
  it('defaults message to RFC reason phrase', () => {
    const result = httpError(HttpStatus.NotFound);
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.data.status).toBe(404);
    expect(result.data.message).toBe('Not Found');
    expect(result.data.errors).toBeUndefined();
  });

  it('uses RFC 9110 phrase override for 413', () => {
    const result = httpError(HttpStatus.ContentTooLarge);
    if (!isErr(result)) throw new Error('expected err');
    expect(result.data.status).toBe(413);
    expect(result.data.message).toBe('Content Too Large');
  });

  it('uses RFC 9110 phrase override for 414', () => {
    const result = httpError(HttpStatus.UriTooLong);
    if (!isErr(result)) throw new Error('expected err');
    expect(result.data.message).toBe('URI Too Long');
  });

  it('uses RFC 9110 phrase override for 416', () => {
    const result = httpError(HttpStatus.RangeNotSatisfiable);
    if (!isErr(result)) throw new Error('expected err');
    expect(result.data.message).toBe('Range Not Satisfiable');
  });

  it('uses RFC 9110 phrase override for 422', () => {
    const result = httpError(HttpStatus.UnprocessableContent);
    if (!isErr(result)) throw new Error('expected err');
    expect(result.data.message).toBe('Unprocessable Content');
  });

  it('accepts a custom message overriding defaults', () => {
    const result = httpError(HttpStatus.BadRequest, 'Empty body');
    if (!isErr(result)) throw new Error('expected err');
    expect(result.data.message).toBe('Empty body');
  });

  it('attaches errors array when provided', () => {
    const result = httpError(HttpStatus.UnprocessableContent, 'Validation failed', [
      { field: 'email', code: 'invalid' },
    ]);
    if (!isErr(result)) throw new Error('expected err');
    expect(result.data.errors).toEqual([{ field: 'email', code: 'invalid' }]);
  });

  it('omits errors property when undefined (exactOptionalPropertyTypes)', () => {
    const result = httpError(HttpStatus.BadRequest);
    if (!isErr(result)) throw new Error('expected err');
    expect('errors' in result.data).toBe(false);
  });

  it('falls back to http-status-codes phrase for non-override statuses', () => {
    const result = httpError(HttpStatus.Forbidden);
    if (!isErr(result)) throw new Error('expected err');
    expect(result.data.message).toBe('Forbidden');
  });
});
