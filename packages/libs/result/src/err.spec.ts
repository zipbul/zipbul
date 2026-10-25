import { describe, expect, expectTypeOf, test } from 'bun:test';

import { ERR } from './constants';
import { err } from './err';
import type { Err } from './types';

describe('err', () => {
  describe('data', () => {
    test.each([
      ['object', { code: 'A' }],
      ['string', 'msg'],
      ['empty string', ''],
      ['number', 42],
      ['zero', 0],
      ['false', false],
      ['null', null],
    ])('keeps %s data as given', (_label, data) => {
      // Act
      const result = err(data);
      // Assert
      expect(result.data).toBe(data);
    });

    test('sets data to undefined when called without arguments', () => {
      // Act
      const result = err();
      // Assert
      expect(result.data).toBeUndefined();
    });

    test('does not deep-freeze data', () => {
      // Arrange
      const data = { x: 1 };
      const result = err(data);
      // Act
      data.x = 2;
      // Assert
      expect(result.data.x).toBe(2);
    });
  });

  describe('shape', () => {
    test('tags the value with the ERR marker', () => {
      // Act
      const result = err('x');
      // Assert
      expect(result[ERR]).toBe(true);
    });

    test('serializes to data only', () => {
      // Act
      const json = JSON.stringify(err('x'));
      // Assert
      expect(json).toBe('{"data":"x"}');
    });

    test('returns a frozen object', () => {
      // Act
      const result = err('x');
      // Assert
      expect(Object.isFrozen(result)).toBe(true);
    });

    test('returns a new object on every call', () => {
      // Act
      const first = err('x');
      const second = err('x');
      // Assert
      expect(first).not.toBe(second);
    });
  });

  describe('no-throw guarantee', () => {
    test('does not throw when data is a hostile Proxy', () => {
      // Arrange
      const hostile = new Proxy(
        {},
        {
          get() {
            throw new Error('trap');
          },
          has() {
            throw new Error('trap');
          },
        },
      );
      // Act / Assert
      expect(() => err(hostile)).not.toThrow();
    });

    test('does not throw when data is circular', () => {
      // Arrange
      const circular: Record<string, unknown> = {};
      circular['self'] = circular;
      // Act / Assert
      expect(() => err(circular)).not.toThrow();
    });
  });

  describe('types', () => {
    test('types err() as Err<undefined>', () => {
      // Act / Assert
      expectTypeOf(err()).toEqualTypeOf<Err<undefined>>();
    });

    test('infers E from data', () => {
      // Act / Assert
      expectTypeOf(err('x')).toEqualTypeOf<Err<string>>();
    });

    test('rejects a plain { data } object as Err', () => {
      // Act / Assert
      expectTypeOf<{ data: string }>().not.toExtend<Err<string>>();
    });
  });
});
