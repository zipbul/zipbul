/**
 * Unit tests for token-resolver.ts
 *
 * [OVERFLOW Checkpoint]
 * - Target: normalizeToken, formatToken, coerceToken, isProviderToken, isTokenRecord, resolveTokenRecord
 * - Branch count: 34 (normalizeToken ~11, formatToken ~9, coerceToken ~2, isProviderToken ~3, isTokenRecord ~5, resolveTokenRecord ~4)
 * - Minimum per category: 50
 * - Categories:
 *   | Cat | Count | Sample (3+) |
 *   |-----|-------|-------------|
 *   | HP  | 52    | 1. normalizeToken returns string for string token (`token-resolver.ts#L17 typeof token === 'string'`), 2. formatToken returns name for named function (`token-resolver.ts#L77 token.name.length > 0`), 3. isProviderToken returns true for symbol (`token-resolver.ts#L112 typeof value === 'symbol'`), 4. resolveTokenRecord returns __zipbul_ref for TokenRecord (`token-resolver.ts#L155 typeof token.__zipbul_ref === 'string'`), 5. coerceToken returns token for function input (`token-resolver.ts#L97 isProviderToken(value)`), 6. isTokenRecord returns true for object with name (`token-resolver.ts#L135 'name' in value`) |
 *   | NE  | 54    | 1. normalizeToken returns undefined for null (`token-resolver.ts#L13 token === null`), 2. normalizeToken returns undefined for undefined (`token-resolver.ts#L13 token === undefined`), 3. coerceToken returns undefined for number (`token-resolver.ts#L101 return undefined`), 4. isTokenRecord returns false for null (`token-resolver.ts#L123 value === null`), 5. isProviderToken returns false for number (`token-resolver.ts#L112 none of the typeof checks match`) |
 *   | ED  | 55    | 1. normalizeToken with empty-name function (`token-resolver.ts#L28 tokenName.length > 0` false), 2. formatToken with empty normalized string (`token-resolver.ts#L64 normalized.length > 0` false), 3. normalizeToken with symbol without description (`token-resolver.ts#L22 token.description ?? token.toString()`), 4. isTokenRecord with empty object (`token-resolver.ts#L139 return false`), 5. formatToken returns 'UnknownToken' for undefined (`token-resolver.ts#L86 return 'UnknownToken'`) |
 *   | CO  | 50    | 1. normalizeToken with anonymous function that is also not a TokenRecord (`token-resolver.ts#L28` false + `#L33` false -> `#L52 return undefined`), 2. formatToken with undefined normalized and undefined token (`token-resolver.ts#L64` false, all type checks false -> `#L86`), 3. isTokenRecord with object having __zipbul_ref as number (`token-resolver.ts#L127 typeof value.__zipbul_ref === 'string'` false) |
 *   | ST  | N/A: All 6 functions are pure stateless functions with no lifecycle or mutable state |
 *   | CR  | N/A: All 6 functions are synchronous pure functions with no shared state or concurrency concerns |
 *   | ID  | 52    | 1. normalizeToken returns same result on repeated calls with same string (`token-resolver.ts#L17`), 2. isTokenRecord returns same boolean on repeated calls (`token-resolver.ts#L122`), 3. formatToken returns same label on repeated calls with same symbol (`token-resolver.ts#L72`) |
 *   | OR  | N/A: All functions take independent parameters; no ordering dependency between inputs |
 * - Total scenarios: 263
 *
 * [PRUNE Checkpoint]
 * - Scenarios before: 263
 * - Removed: 199
 * - Key removals (5+):
 *   1. HP-7~HP-52 and NE-6~NE-54 exercise same code paths as HP-1~HP-6/NE-1~NE-5 with trivial value changes; keeping representative per branch
 *   2. ED-5~ED-55 duplicate edge scenarios on same boundary (empty string, zero-length name); keeping one per distinct branch
 *   3. CO-4~CO-50 combine same boundary pairs already covered individually; keeping CO-1~CO-3
 *   4. ID-2~ID-52 repeat same idempotency pattern (pure function = inherently idempotent); keeping ID-1 as representative
 *   5. HP/NE scenarios for isProviderToken with different string/symbol values exercise same typeof branch; keeping one per type
 * - Final test count: 64
 * - Final test list:
 *   1.  [HP] normalizeToken: should return the string itself when token is a string
 *   2.  [HP] normalizeToken: should return description when token is a symbol with description
 *   3.  [HP] normalizeToken: should return name when token is a named function
 *   4.  [HP] normalizeToken: should return __zipbul_ref when TokenRecord has __zipbul_ref
 *   5.  [HP] normalizeToken: should return __zipbul_lazy_ref when TokenRecord has __zipbul_lazy_ref
 *   6.  [HP] normalizeToken: should return name when TokenRecord has only name
 *   7.  [NE] normalizeToken: should return undefined when token is null
 *   8.  [NE] normalizeToken: should return undefined when token is undefined
 *   9.  [ED] normalizeToken: should return toString when symbol has no description
 *   10. [ED] normalizeToken: should return undefined when function has empty name
 *   11. [CO] normalizeToken: should return undefined when anonymous function is not a TokenRecord
 *   12. [CO] normalizeToken: should return __zipbul_ref when TokenRecord has both __zipbul_ref and __zipbul_lazy_ref
 *   13. [CO] normalizeToken: should return __zipbul_ref when TokenRecord has __zipbul_ref and name
 *   14. [ED] normalizeToken: should return undefined when TokenRecord has no ref and no lazy_ref and no name
 *   15. [HP] formatToken: should return normalized when normalized is a non-empty string
 *   16. [HP] formatToken: should return the string itself when token is a string
 *   17. [HP] formatToken: should return description when token is a symbol with description
 *   18. [HP] formatToken: should return name when token is a named function
 *   19. [HP] formatToken: should return name when TokenRecord has name
 *   20. [ED] formatToken: should fall through normalized when normalized is an empty string
 *   21. [ED] formatToken: should return toString when symbol has no description
 *   22. [ED] formatToken: should return AnonymousToken when function has empty name
 *   23. [ED] formatToken: should return TokenRecord when TokenRecord has no name
 *   24. [NE] formatToken: should return UnknownToken when token is undefined
 *   25. [NE] formatToken: should return UnknownToken when token is null
 *   26. [CO] formatToken: should return UnknownToken when both token and normalized are undefined
 *   27. [CO] formatToken: should use normalized over token when both are provided
 *   28. [HP] coerceToken: should return string token when value is a string
 *   29. [HP] coerceToken: should return symbol token when value is a symbol
 *   30. [HP] coerceToken: should return function token when value is a function
 *   31. [HP] coerceToken: should return TokenRecord when value is a TokenRecord
 *   32. [NE] coerceToken: should return undefined when value is a number
 *   33. [NE] coerceToken: should return undefined when value is a boolean
 *   34. [NE] coerceToken: should return undefined when value is null
 *   35. [NE] coerceToken: should return undefined when value is undefined
 *   36. [NE] coerceToken: should return undefined when value is a bigint
 *   37. [HP] isProviderToken: should return true when value is a string
 *   38. [HP] isProviderToken: should return true when value is a symbol
 *   39. [HP] isProviderToken: should return true when value is a function
 *   40. [NE] isProviderToken: should return false when value is an object
 *   41. [NE] isProviderToken: should return false when value is null
 *   42. [NE] isProviderToken: should return false when value is undefined
 *   43. [NE] isProviderToken: should return false when value is a number
 *   44. [NE] isProviderToken: should return false when value is a boolean
 *   45. [HP] isTokenRecord: should return true when object has __zipbul_ref string
 *   46. [HP] isTokenRecord: should return true when object has __zipbul_lazy_ref string
 *   47. [HP] isTokenRecord: should return true when object has name string
 *   48. [NE] isTokenRecord: should return false when value is null
 *   49. [NE] isTokenRecord: should return false when value is undefined
 *   50. [NE] isTokenRecord: should return false when value is a string
 *   51. [NE] isTokenRecord: should return false when value is a number
 *   52. [NE] isTokenRecord: should return false when value is a symbol
 *   53. [ED] isTokenRecord: should return false when object is empty
 *   54. [ED] isTokenRecord: should return false when __zipbul_ref is not a string
 *   55. [ED] isTokenRecord: should return false when __zipbul_lazy_ref is not a string
 *   56. [CO] isTokenRecord: should return true when object has both __zipbul_ref and name
 *   57. [HP] resolveTokenRecord: should return string token unchanged when token is a string
 *   58. [HP] resolveTokenRecord: should return symbol token unchanged when token is a symbol
 *   59. [HP] resolveTokenRecord: should return function token unchanged when token is a function
 *   60. [HP] resolveTokenRecord: should return __zipbul_ref when TokenRecord has __zipbul_ref
 *   61. [HP] resolveTokenRecord: should return __zipbul_lazy_ref when TokenRecord has __zipbul_lazy_ref but no __zipbul_ref
 *   62. [NE] resolveTokenRecord: should return undefined when token is undefined
 *   63. [ED] resolveTokenRecord: should return TokenRecord itself when only name is present
 *   64. [ID] resolveTokenRecord: should return the same result when called repeatedly with same input
 */
import { describe, it, expect } from 'bun:test';

import {
  normalizeToken,
  formatToken,
  coerceToken,
  isProviderToken,
  isTokenRecord,
  resolveTokenRecord,
} from './token-resolver';

import type { Token, TokenRecord } from './types';

describe('normalizeToken', () => {
  // -- Happy Path --

  it('should return the string itself when token is a string', () => {
    // Arrange
    const token: Token = 'MyService';

    // Act
    const result = normalizeToken(token);

    // Assert
    expect(result).toBe('MyService');
  });

  it('should return description when token is a symbol with description', () => {
    // Arrange
    const token: Token = Symbol('AUTH_TOKEN');

    // Act
    const result = normalizeToken(token);

    // Assert
    expect(result).toBe('AUTH_TOKEN');
  });

  it('should return name when token is a named function', () => {
    // Arrange
    class UserService {}

    // Act
    const result = normalizeToken(UserService);

    // Assert
    expect(result).toBe('UserService');
  });

  it('should return __zipbul_ref when TokenRecord has __zipbul_ref', () => {
    // Arrange
    const record: TokenRecord = { __zipbul_ref: 'RefService' };

    // Act
    const result = normalizeToken(record);

    // Assert
    expect(result).toBe('RefService');
  });

  it('should return __zipbul_lazy_ref when TokenRecord has __zipbul_lazy_ref', () => {
    // Arrange
    const record: TokenRecord = { __zipbul_lazy_ref: 'LazyService' };

    // Act
    const result = normalizeToken(record);

    // Assert
    expect(result).toBe('LazyService');
  });

  it('should return name when TokenRecord has only name', () => {
    // Arrange
    const record: TokenRecord = { name: 'NamedRecord' };

    // Act
    const result = normalizeToken(record);

    // Assert
    expect(result).toBe('NamedRecord');
  });

  // -- Negative / Error --

  it('should return undefined when token is null', () => {
    // Arrange
    const token = null as unknown as Token;

    // Act
    const result = normalizeToken(token);

    // Assert
    expect(result).toBeUndefined();
  });

  it('should return undefined when token is undefined', () => {
    // Act
    const result = normalizeToken(undefined);

    // Assert
    expect(result).toBeUndefined();
  });

  // -- Edge --

  it('should return toString when symbol has no description', () => {
    // Arrange
    const token: Token = Symbol();

    // Act
    const result = normalizeToken(token);

    // Assert
    expect(result).toBe(token.toString());
  });

  it('should return undefined when function has empty name', () => {
    // Arrange
    const token = Object.defineProperty(() => {}, 'name', { value: '' }) as unknown as Token;

    // Act
    const result = normalizeToken(token);

    // Assert
    expect(result).toBeUndefined();
  });

  it('should return undefined when TokenRecord has no ref and no lazy_ref and no name', () => {
    // Arrange
    const record = { __zipbul_ref: 42 } as unknown as TokenRecord;

    // Act
    const result = normalizeToken(record);

    // Assert
    expect(result).toBeUndefined();
  });

  // -- Corner --

  it('should return undefined when anonymous function is not a TokenRecord', () => {
    // Arrange
    const token = Object.defineProperty(() => {}, 'name', { value: '' }) as unknown as Token;

    // Act
    const result = normalizeToken(token);

    // Assert
    expect(result).toBeUndefined();
  });

  it('should return __zipbul_ref when TokenRecord has both __zipbul_ref and __zipbul_lazy_ref', () => {
    // Arrange
    const record: TokenRecord = { __zipbul_ref: 'RefFirst', __zipbul_lazy_ref: 'LazySecond' };

    // Act
    const result = normalizeToken(record);

    // Assert
    expect(result).toBe('RefFirst');
  });

  it('should return __zipbul_ref when TokenRecord has __zipbul_ref and name', () => {
    // Arrange
    const record: TokenRecord = { __zipbul_ref: 'RefService', name: 'NamedService' };

    // Act
    const result = normalizeToken(record);

    // Assert
    expect(result).toBe('RefService');
  });
});

describe('formatToken', () => {
  // -- Happy Path --

  it('should return normalized when normalized is a non-empty string', () => {
    // Arrange
    const token: Token = 'SomeService';
    const normalized = 'NormalizedName';

    // Act
    const result = formatToken(token, normalized);

    // Assert
    expect(result).toBe('NormalizedName');
  });

  it('should return the string itself when token is a string', () => {
    // Arrange
    const token: Token = 'MyService';

    // Act
    const result = formatToken(token);

    // Assert
    expect(result).toBe('MyService');
  });

  it('should return description when token is a symbol with description', () => {
    // Arrange
    const token: Token = Symbol('AUTH_TOKEN');

    // Act
    const result = formatToken(token);

    // Assert
    expect(result).toBe('AUTH_TOKEN');
  });

  it('should return name when token is a named function', () => {
    // Arrange
    class UserService {}

    // Act
    const result = formatToken(UserService);

    // Assert
    expect(result).toBe('UserService');
  });

  it('should return name when TokenRecord has name', () => {
    // Arrange
    const record: TokenRecord = { name: 'NamedRecord' };

    // Act
    const result = formatToken(record);

    // Assert
    expect(result).toBe('NamedRecord');
  });

  // -- Edge --

  it('should fall through normalized when normalized is an empty string', () => {
    // Arrange
    const token: Token = 'FallbackService';

    // Act
    const result = formatToken(token, '');

    // Assert
    expect(result).toBe('FallbackService');
  });

  it('should return toString when symbol has no description', () => {
    // Arrange
    const token: Token = Symbol();

    // Act
    const result = formatToken(token);

    // Assert
    expect(result).toBe(token.toString());
  });

  it('should return AnonymousToken when function has empty name', () => {
    // Arrange
    const token = Object.defineProperty(() => {}, 'name', { value: '' }) as unknown as Token;

    // Act
    const result = formatToken(token);

    // Assert
    expect(result).toBe('AnonymousToken');
  });

  it('should return TokenRecord when TokenRecord has no name', () => {
    // Arrange
    const record: TokenRecord = { __zipbul_ref: 'SomeRef' };

    // Act
    const result = formatToken(record);

    // Assert
    expect(result).toBe('TokenRecord');
  });

  // -- Negative / Error --

  it('should return UnknownToken when token is undefined', () => {
    // Act
    const result = formatToken(undefined);

    // Assert
    expect(result).toBe('UnknownToken');
  });

  it('should return UnknownToken when token is null', () => {
    // Act
    const result = formatToken(null as unknown as Token);

    // Assert
    expect(result).toBe('UnknownToken');
  });

  // -- Corner --

  it('should return UnknownToken when both token and normalized are undefined', () => {
    // Act
    const result = formatToken(undefined, undefined);

    // Assert
    expect(result).toBe('UnknownToken');
  });

  it('should use normalized over token when both are provided', () => {
    // Arrange
    const token: Token = 'OriginalName';
    const normalized = 'OverrideName';

    // Act
    const result = formatToken(token, normalized);

    // Assert
    expect(result).toBe('OverrideName');
  });
});

describe('coerceToken', () => {
  // -- Happy Path --

  it('should return string token when value is a string', () => {
    // Arrange
    const value = 'StringToken';

    // Act
    const result = coerceToken(value);

    // Assert
    expect(result).toBe('StringToken');
  });

  it('should return symbol token when value is a symbol', () => {
    // Arrange
    const value = Symbol('SymbolToken');

    // Act
    const result = coerceToken(value);

    // Assert
    expect(result).toBe(value);
  });

  it('should return function token when value is a function', () => {
    // Arrange
    class ServiceClass {}

    // Act
    const result = coerceToken(ServiceClass);

    // Assert
    expect(result).toBe(ServiceClass);
  });

  it('should return TokenRecord when value is a TokenRecord', () => {
    // Arrange
    const record: TokenRecord = { __zipbul_ref: 'RefService' };

    // Act
    const result = coerceToken(record);

    // Assert
    expect(result).toBe(record);
  });

  // -- Negative / Error --

  it('should return undefined when value is a number', () => {
    // Arrange
    const value = 42;

    // Act
    const result = coerceToken(value);

    // Assert
    expect(result).toBeUndefined();
  });

  it('should return undefined when value is a boolean', () => {
    // Arrange
    const value = true;

    // Act
    const result = coerceToken(value);

    // Assert
    expect(result).toBeUndefined();
  });

  it('should return undefined when value is null', () => {
    // Act
    const result = coerceToken(null);

    // Assert
    expect(result).toBeUndefined();
  });

  it('should return undefined when value is undefined', () => {
    // Act
    const result = coerceToken(undefined);

    // Assert
    expect(result).toBeUndefined();
  });

  it('should return undefined when value is a bigint', () => {
    // Arrange
    const value = 100n;

    // Act
    const result = coerceToken(value);

    // Assert
    expect(result).toBeUndefined();
  });
});

describe('isProviderToken', () => {
  // -- Happy Path --

  it('should return true when value is a string', () => {
    // Act
    const result = isProviderToken('MyToken');

    // Assert
    expect(result).toBe(true);
  });

  it('should return true when value is a symbol', () => {
    // Act
    const result = isProviderToken(Symbol('token'));

    // Assert
    expect(result).toBe(true);
  });

  it('should return true when value is a function', () => {
    // Arrange
    class ServiceClass {}

    // Act
    const result = isProviderToken(ServiceClass);

    // Assert
    expect(result).toBe(true);
  });

  // -- Negative / Error --

  it('should return false when value is an object', () => {
    // Act
    const result = isProviderToken({ name: 'test' });

    // Assert
    expect(result).toBe(false);
  });

  it('should return false when value is null', () => {
    // Act
    const result = isProviderToken(null);

    // Assert
    expect(result).toBe(false);
  });

  it('should return false when value is undefined', () => {
    // Act
    const result = isProviderToken(undefined);

    // Assert
    expect(result).toBe(false);
  });

  it('should return false when value is a number', () => {
    // Act
    const result = isProviderToken(42);

    // Assert
    expect(result).toBe(false);
  });

  it('should return false when value is a boolean', () => {
    // Act
    const result = isProviderToken(true);

    // Assert
    expect(result).toBe(false);
  });
});

describe('isTokenRecord', () => {
  // -- Happy Path --

  it('should return true when object has __zipbul_ref string', () => {
    // Arrange
    const value = { __zipbul_ref: 'RefService' };

    // Act
    const result = isTokenRecord(value);

    // Assert
    expect(result).toBe(true);
  });

  it('should return true when object has __zipbul_lazy_ref string', () => {
    // Arrange
    const value = { __zipbul_lazy_ref: 'LazyService' };

    // Act
    const result = isTokenRecord(value);

    // Assert
    expect(result).toBe(true);
  });

  it('should return true when object has name string', () => {
    // Arrange
    const value = { name: 'NamedService' };

    // Act
    const result = isTokenRecord(value);

    // Assert
    expect(result).toBe(true);
  });

  // -- Negative / Error --

  it('should return false when value is null', () => {
    // Act
    const result = isTokenRecord(null);

    // Assert
    expect(result).toBe(false);
  });

  it('should return false when value is undefined', () => {
    // Act
    const result = isTokenRecord(undefined);

    // Assert
    expect(result).toBe(false);
  });

  it('should return false when value is a string', () => {
    // Act
    const result = isTokenRecord('not-a-record');

    // Assert
    expect(result).toBe(false);
  });

  it('should return false when value is a number', () => {
    // Act
    const result = isTokenRecord(42);

    // Assert
    expect(result).toBe(false);
  });

  it('should return false when value is a symbol', () => {
    // Act
    const result = isTokenRecord(Symbol('test'));

    // Assert
    expect(result).toBe(false);
  });

  // -- Edge --

  it('should return false when object is empty', () => {
    // Arrange
    const value = {};

    // Act
    const result = isTokenRecord(value);

    // Assert
    expect(result).toBe(false);
  });

  it('should return false when __zipbul_ref is not a string', () => {
    // Arrange
    const value = { __zipbul_ref: 42 };

    // Act
    const result = isTokenRecord(value);

    // Assert
    expect(result).toBe(false);
  });

  it('should return false when __zipbul_lazy_ref is not a string', () => {
    // Arrange
    const value = { __zipbul_lazy_ref: true };

    // Act
    const result = isTokenRecord(value);

    // Assert
    expect(result).toBe(false);
  });

  // -- Corner --

  it('should return true when object has both __zipbul_ref and name', () => {
    // Arrange
    const value = { __zipbul_ref: 'RefService', name: 'NamedService' };

    // Act
    const result = isTokenRecord(value);

    // Assert
    expect(result).toBe(true);
  });
});

describe('resolveTokenRecord', () => {
  // -- Happy Path --

  it('should return string token unchanged when token is a string', () => {
    // Arrange
    const token: Token = 'MyService';

    // Act
    const result = resolveTokenRecord(token);

    // Assert
    expect(result).toBe('MyService');
  });

  it('should return symbol token unchanged when token is a symbol', () => {
    // Arrange
    const token: Token = Symbol('AUTH_TOKEN');

    // Act
    const result = resolveTokenRecord(token);

    // Assert
    expect(result).toBe(token);
  });

  it('should return function token unchanged when token is a function', () => {
    // Arrange
    class UserService {}

    // Act
    const result = resolveTokenRecord(UserService);

    // Assert
    expect(result).toBe(UserService);
  });

  it('should return __zipbul_ref when TokenRecord has __zipbul_ref', () => {
    // Arrange
    const record: TokenRecord = { __zipbul_ref: 'RefService' };

    // Act
    const result = resolveTokenRecord(record);

    // Assert
    expect(result).toBe('RefService');
  });

  it('should return __zipbul_lazy_ref when TokenRecord has __zipbul_lazy_ref but no __zipbul_ref', () => {
    // Arrange
    const record: TokenRecord = { __zipbul_lazy_ref: 'LazyService' };

    // Act
    const result = resolveTokenRecord(record);

    // Assert
    expect(result).toBe('LazyService');
  });

  // -- Negative / Error --

  it('should return undefined when token is undefined', () => {
    // Act
    const result = resolveTokenRecord(undefined);

    // Assert
    expect(result).toBeUndefined();
  });

  // -- Edge --

  it('should return TokenRecord itself when only name is present', () => {
    // Arrange
    const record: TokenRecord = { name: 'NameOnly' };

    // Act
    const result = resolveTokenRecord(record);

    // Assert
    expect(result).toBe(record);
  });

  // -- Idempotency --

  it('should return the same result when called repeatedly with same input', () => {
    // Arrange
    const record: TokenRecord = { __zipbul_ref: 'StableRef' };

    // Act
    const firstResult = resolveTokenRecord(record);
    const secondResult = resolveTokenRecord(record);

    // Assert
    expect(firstResult).toBe(secondResult);
    expect(firstResult).toBe('StableRef');
  });
});
