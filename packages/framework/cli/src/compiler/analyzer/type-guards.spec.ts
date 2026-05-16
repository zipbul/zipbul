import { describe, expect, it } from 'bun:test';
import { ZIPBUL_REF, ZIPBUL_UNRESOLVABLE } from '@zipbul/common';

import { isUnresolvable } from './type-guards';

describe('isUnresolvable', () => {
  it('should return true when value is a valid UnresolvableExpression object', () => {
    const value = {
      [ZIPBUL_UNRESOLVABLE]: true,
      nodeType: 'ConditionalExpression',
      start: 10,
      end: 30,
    };

    expect(isUnresolvable(value)).toBe(true);
  });

  it('should return true when marker property exists with falsy value', () => {
    const value = {
      [ZIPBUL_UNRESOLVABLE]: false,
      nodeType: 'AwaitExpression',
      start: 0,
      end: 5,
    };

    expect(isUnresolvable(value)).toBe(true);
  });

  it('should return false when value is null', () => {
    expect(isUnresolvable(null)).toBe(false);
  });

  it('should return false when value is undefined', () => {
    expect(isUnresolvable(undefined)).toBe(false);
  });

  it('should return false when value is a string', () => {
    expect(isUnresolvable('some-string')).toBe(false);
  });

  it('should return false when value is a number', () => {
    expect(isUnresolvable(42)).toBe(false);
  });

  it('should return false when value is a boolean', () => {
    expect(isUnresolvable(true)).toBe(false);
  });

  it('should return false when value is an empty object without marker', () => {
    expect(isUnresolvable({})).toBe(false);
  });

  it('should return false when value is an array', () => {
    expect(isUnresolvable([1, 2, 3])).toBe(false);
  });

  it('should return false when value is a ZIPBUL_REF record without unresolvable marker', () => {
    const value = {
      [ZIPBUL_REF]: 'MyService',
    };

    expect(isUnresolvable(value)).toBe(false);
  });
});
