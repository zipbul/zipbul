import { describe, expect, it } from 'bun:test';
import { ZIPBUL_REF, ZIPBUL_UNRESOLVABLE } from '@zipbul/common';

import { isClassMetadata, isUnresolvable } from './type-guards';

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

describe('isClassMetadata', () => {
  // DI is inject()-only; `constructorParams` was removed from ClassMetadata, so
  // the guard must accept a class that never carried that field.
  const base = { className: 'Service', decorators: [], methods: [], properties: [], imports: {} };

  it('should return true for a minimal valid ClassMetadata without constructorParams', () => {
    expect(isClassMetadata(base)).toBe(true);
  });

  it('should return true when an unrelated extra field is present', () => {
    expect(isClassMetadata({ ...base, heritage: { typeName: 'Base' } })).toBe(true);
  });

  it('should return false when className is not a string', () => {
    expect(isClassMetadata({ ...base, className: 42 })).toBe(false);
  });

  it('should return false when decorators is not an array', () => {
    expect(isClassMetadata({ ...base, decorators: {} })).toBe(false);
  });

  it('should return false when methods is not an array', () => {
    expect(isClassMetadata({ ...base, methods: 'oops' })).toBe(false);
  });

  it('should return false when properties is not an array', () => {
    expect(isClassMetadata({ ...base, properties: undefined })).toBe(false);
  });

  it('should return false when imports is missing', () => {
    const { imports: _imports, ...withoutImports } = base;

    expect(isClassMetadata(withoutImports)).toBe(false);
  });

  it('should return false when value is null', () => {
    expect(isClassMetadata(null)).toBe(false);
  });

  it('should return false when value is not a record', () => {
    expect(isClassMetadata('Service')).toBe(false);
  });
});
