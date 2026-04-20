import { describe, expect, it } from 'bun:test';
import { StatusCodes } from 'http-status-codes';

import { ContentType as ContentTypeDecorator, Header, Status } from './method-option.decorator';

describe('Status decorator (H14)', () => {
  it('accepts any StatusCodes enum member', () => {
    expect(typeof Status(StatusCodes.OK)).toBe('function');
    expect(typeof Status(StatusCodes.NOT_FOUND)).toBe('function');
    expect(typeof Status(StatusCodes.IM_A_TEAPOT)).toBe('function');
    expect(typeof Status(StatusCodes.INTERNAL_SERVER_ERROR)).toBe('function');
  });

  it('returns a no-op MethodDecorator (runtime is AOT-wired)', () => {
    const dec = Status(StatusCodes.CREATED);
    expect(() =>
      dec({} as unknown as object, 'm', {} as unknown as PropertyDescriptor),
    ).not.toThrow();
  });

  // Type-level rejection of non-enum numbers is enforced by `bunx tsc --noEmit`
  // (the `HttpStatus` literal union on the `Status` parameter). No runtime test.
});

describe('ContentType decorator', () => {
  it('accepts arbitrary media type strings (user sets what they need)', () => {
    expect(typeof ContentTypeDecorator('application/json')).toBe('function');
    expect(typeof ContentTypeDecorator('text/event-stream')).toBe('function');
    expect(typeof ContentTypeDecorator('application/vnd.api+json')).toBe('function');
    expect(typeof ContentTypeDecorator('image/png')).toBe('function');
  });
});

describe('Header decorator', () => {
  it('accepts arbitrary header names (user sets what they need)', () => {
    expect(typeof Header('Cache-Control', 'max-age=60')).toBe('function');
    expect(typeof Header('X-Request-Id', 'abc')).toBe('function');
    expect(typeof Header('ETag', 'W/"123"')).toBe('function');
  });
});
