import { describe, expect, expectTypeOf, test } from 'bun:test';
import { runInNewContext } from 'node:vm';

import { err } from './err';
import { safe } from './safe';
import type { Result, ResultAsync } from './types';

const fail = (message: string): never => {
  throw new Error(message);
};

const withThrowingGetter = (key: 'constructor' | 'then'): Promise<number> =>
  Object.defineProperty(Promise.resolve(1), key, {
    get: () => fail(key),
  });

describe('safe', () => {
  describe('sync function', () => {
    test.each([
      ['a value', () => 42, 42],
      ['null', () => null, null],
      ['undefined', () => undefined, undefined],
    ])('returns %s returned by fn', (_label, fn, expected) => {
      // Act / Assert
      expect(safe(fn)).toBe(expected);
    });

    test('returns a Promise returned by fn as the success value', () => {
      // Arrange
      const inner = Promise.resolve(99);
      // Act / Assert
      expect(safe(() => inner)).toBe(inner);
    });

    test('returns an Err-like value returned by fn as the success value', () => {
      // Arrange
      const errLike = { data: 'not an Err' };
      // Act / Assert
      expect(safe(() => errLike)).toBe(errLike);
    });

    test.each([
      ['an Error', new Error('boom')],
      ['a string', 'boom'],
      ['null', null],
      ['undefined', undefined],
    ])('returns Err carrying %s thrown by fn', (_label, thrown) => {
      // Act
      const result = safe(() => {
        throw thrown;
      });
      // Assert
      expect(result).toEqual(err(thrown));
    });

    test('returns Err carrying the TypeError when fn is a revoked Proxy', () => {
      // Arrange
      const { proxy, revoke } = Proxy.revocable(() => 1, {});
      revoke();
      // Act
      const result = safe(proxy);
      // Assert
      expect(result).toEqual(err(expect.any(TypeError)));
    });
  });

  describe('sync function with mapErr', () => {
    test('returns Err carrying the mapped value', () => {
      // Act
      const result = safe(
        () => fail('boom'),
        (thrown) => (thrown as Error).message,
      );
      // Assert
      expect(result).toEqual(err('boom'));
    });

    test('passes the exact thrown value to mapErr', () => {
      // Arrange
      const thrown = { code: 'X' };
      // Act
      const result = safe(
        () => {
          throw thrown;
        },
        (value) => value === thrown,
      );
      // Assert
      expect(result).toEqual(err(true));
    });

    test('returns the value without calling mapErr when fn succeeds', () => {
      // Act
      const result = safe(
        () => 'ok',
        () => fail('mapErr called'),
      );
      // Assert
      expect(result).toBe('ok');
    });

    test('throws what mapErr throws', () => {
      // Act / Assert
      expect(() =>
        safe(
          () => fail('original'),
          () => fail('mapErr panic'),
        ),
      ).toThrow('mapErr panic');
    });
  });

  describe('promise', () => {
    test.each([
      ['a value', Promise.resolve(42), 42],
      ['undefined', Promise.resolve(undefined), undefined],
      ['a value from a Promise subclass', (class Sub<T> extends Promise<T> {}).resolve(77), 77],
    ])('resolves to %s', async (_label, promise, expected) => {
      // Act / Assert
      expect(await safe(promise)).toBe(expected);
    });

    test.each([
      ['an Error', new Error('boom')],
      ['a string', 'boom'],
      ['null', null],
    ])('resolves to Err carrying %s the promise rejects with', async (_label, reason) => {
      // Act
      const result = await safe(Promise.reject(reason));
      // Assert
      expect(result).toEqual(err(reason));
    });

    test('resolves to the value of a promise from another realm', async () => {
      // Arrange
      const foreign = runInNewContext('Promise.resolve(42)') as Promise<number>;
      // Act / Assert
      expect(await safe(foreign)).toBe(42);
    });

    test('resolves to Err when a promise from another realm rejects', async () => {
      // Arrange
      const foreign = runInNewContext('Promise.reject("boom")') as Promise<never>;
      // Act / Assert
      expect(await safe(foreign)).toEqual(err('boom'));
    });

    test.each([['constructor' as const], ['then' as const]])(
      'resolves to Err when reading the promise %s throws',
      async (key) => {
        // Act
        const result = safe(withThrowingGetter(key));
        // Assert
        expect(await result).toEqual(err(new Error(key)));
      },
    );

    test('resolves to Err when calling the promise then throws', async () => {
      // Arrange
      const promise = Promise.resolve(1);
      promise.then = () => fail('then');
      // Act
      const result = safe(promise);
      // Assert
      expect(await result).toEqual(err(new Error('then')));
    });

    test('resolves to Err when given a revoked Proxy', async () => {
      // Arrange
      const { proxy, revoke } = Proxy.revocable(Promise.resolve(1), {});
      revoke();
      // Act
      const result = safe(proxy);
      // Assert
      expect(await result).toEqual(err(expect.any(TypeError)));
    });
  });

  describe('promise with mapErr', () => {
    test('resolves to Err carrying the mapped value', async () => {
      // Act
      const result = await safe(Promise.reject(new Error('boom')), (reason) => (reason as Error).message);
      // Assert
      expect(result).toEqual(err('boom'));
    });

    test('passes the exact rejection reason to mapErr', async () => {
      // Arrange
      const reason = { code: 'Y' };
      // Act
      const result = await safe(Promise.reject(reason), (value) => value === reason);
      // Assert
      expect(result).toEqual(err(true));
    });

    test('resolves to the value without calling mapErr when the promise resolves', async () => {
      // Act
      const result = await safe(Promise.resolve('ok'), () => fail('mapErr called'));
      // Assert
      expect(result).toBe('ok');
    });

    test('rejects with what mapErr throws', async () => {
      // Act / Assert
      await expect(safe(Promise.reject(new Error('original')), () => fail('mapErr panic'))).rejects.toThrow(
        'mapErr panic',
      );
    });
  });

  describe('types', () => {
    test('types a sync call as Result<T, unknown>', () => {
      // Act / Assert
      expectTypeOf(safe(() => 1)).toEqualTypeOf<Result<number, unknown>>();
    });

    test('types a sync call with mapErr as Result<T, E>', () => {
      // Act / Assert
      expectTypeOf(safe(() => 1, String)).toEqualTypeOf<Result<number, string>>();
    });

    test('types a promise call as ResultAsync<T, unknown>', async () => {
      // Act / Assert
      expectTypeOf(safe(Promise.resolve(1))).toEqualTypeOf<ResultAsync<number, unknown>>();
    });

    test('types a promise call with mapErr as ResultAsync<T, E>', async () => {
      // Act / Assert
      expectTypeOf(safe(Promise.resolve(1), String)).toEqualTypeOf<ResultAsync<number, string>>();
    });
  });
});
