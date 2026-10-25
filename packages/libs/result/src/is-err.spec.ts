import { describe, expect, expectTypeOf, test } from 'bun:test';

import { err } from './err';
import { isErr } from './is-err';
import type { Err, Result } from './types';

// The registry key is the cross-copy and cross-version contract, so it is pinned literally.
const MARKER = Symbol.for('@zipbul/result');

interface Page {
  data: string[];
  total: number;
}
type PageResult = Result<Page, { code: 'X' }>;
type MultiResult = Result<number, { code: 'X' }> | Result<number, { code: 'Y' }>;

const pageError = (result: PageResult) => (isErr(result) ? result : undefined);
const pageSuccess = (result: PageResult) => (isErr(result) ? undefined : result);
const multiErrorData = (result: MultiResult) => (isErr(result) ? result.data : undefined);
const errorOf = <T, E>(result: Result<T, E>): E | undefined => (isErr(result) ? result.data : undefined);
const valueOf = <T, E>(result: Result<T, E>): T | undefined => (isErr(result) ? undefined : result);

describe('isErr', () => {
  describe('returns true', () => {
    test.each([
      ['err()', err()],
      ['err(data)', err({ code: 'A' })],
      ['an object marked with the registry symbol', { [MARKER]: true }],
    ])('for %s', (_label, value) => {
      // Act / Assert
      expect(isErr(value)).toBe(true);
    });
  });

  describe('returns false', () => {
    test.each([
      ['null', null],
      ['undefined', undefined],
      ['a string', 'hello'],
      ['a number', 42],
      ['true', true],
      ['false', false],
      ['a symbol', Symbol('s')],
      ['a bigint', 42n],
      ['a function', () => {}],
      ['an empty object', {}],
      ['a plain { data } object', { data: 'x' }],
      ['an array', []],
      ['an Error', new Error('x')],
      ['a null-prototype object', Object.create(null)],
    ])('for %s', (_label, value) => {
      // Act / Assert
      expect(isErr(value)).toBe(false);
    });

    test.each([
      ['false', false],
      ['the string "true"', 'true'],
      ['the number 1', 1],
      ['a boxed Boolean(true)', Object(true)],
    ])('when the marker is %s', (_label, marker) => {
      // Act / Assert
      expect(isErr({ [MARKER]: marker })).toBe(false);
    });

    test('for an Err that went through JSON', () => {
      // Arrange
      const revived: unknown = JSON.parse(JSON.stringify(err('x')));
      // Act / Assert
      expect(isErr(revived)).toBe(false);
    });

    test('for a Proxy that throws on property access', () => {
      // Arrange
      const hostile = new Proxy(
        {},
        {
          get() {
            throw new Error('trap');
          },
        },
      );
      // Act / Assert
      expect(isErr(hostile)).toBe(false);
    });

    test('for a revoked Proxy', () => {
      // Arrange
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();
      // Act / Assert
      expect(isErr(proxy)).toBe(false);
    });
  });

  describe('types', () => {
    test('takes no type argument and guards to Err<unknown>', () => {
      // Act / Assert
      expectTypeOf(isErr).toEqualTypeOf<(value: unknown) => value is Err<unknown>>();
    });

    test('narrows a success type that has a data property out of the error branch', () => {
      // Act / Assert
      expectTypeOf(pageError).returns.toEqualTypeOf<Err<{ code: 'X' }> | undefined>();
    });

    test('narrows a success type that has a data property into the success branch', () => {
      // Act / Assert
      expectTypeOf(pageSuccess).returns.toEqualTypeOf<Page | undefined>();
    });

    test('keeps every error type of a multi-error union in the error branch', () => {
      // Act / Assert
      expectTypeOf(multiErrorData).returns.toEqualTypeOf<{ code: 'X' } | { code: 'Y' } | undefined>();
    });

    test('narrows a generic Result to E in the error branch', () => {
      // Act / Assert
      expect(errorOf<number, string>(err('x'))).toBe('x');
    });

    test('narrows a generic Result to T in the success branch', () => {
      // Act / Assert
      expect(valueOf<number, string>(7)).toBe(7);
    });
  });
});
