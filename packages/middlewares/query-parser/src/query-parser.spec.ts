/* oxlint-disable typescript-eslint/no-unsafe-type-assertion */

import { describe, expect, it } from 'bun:test';
import { isErr } from '@zipbul/result';
import type { Err, Result } from '@zipbul/result';

import { QueryParserErrorReason } from './enums';
import { QueryParserError } from './interfaces';
import type { QueryParserErrorData, QueryParserOptions } from './interfaces';
import type { QueryArray, QueryValue, QueryValueRecord } from './types';

import { QueryParser } from './query-parser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const expectQueryArray = (value: QueryValue | undefined): QueryArray => {
  if (!Array.isArray(value)) {
    throw new Error('Expected array');
  }

  return value;
};

const expectQueryRecord = (value: QueryValue | undefined): QueryValueRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected record');
  }

  return value;
};

const catchError = (fn: () => void): QueryParserError => {
  try {
    fn();
  } catch (error: unknown) {
    if (error instanceof QueryParserError) {
      return error;
    }

    throw error;
  }

  throw new Error('Expected QueryParserError to be thrown');
};

/**
 * Textbook naive recursive merge (no `__proto__`/prototype-name guard of its
 * own) — the kind of downstream consumer code an N-1 pollution gadget targets.
 * Used only to prove the parser never hands such a consumer a live gadget.
 */
const naiveMerge = (target: Record<string, unknown>, source: Record<string, unknown>): void => {
  for (const key in source) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) {
      continue;
    }

    const value = source[key];

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      if (typeof target[key] !== 'object' || target[key] === null) {
        target[key] = {};
      }

      naiveMerge(target[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      target[key] = value;
    }
  }
};

// ---------------------------------------------------------------------------
// QueryParser
// ---------------------------------------------------------------------------
describe('QueryParser', () => {
  // =========================================================================
  // create
  // =========================================================================
  describe('create', () => {
    it('should return a QueryParser instance when called with no arguments', () => {
      // Act
      const parser = QueryParser.create();

      // Assert
      expect(parser).toBeInstanceOf(QueryParser);
    });

    it('should return a QueryParser instance when called with valid partial options', () => {
      // Act
      const parser = QueryParser.create({ nesting: true, depth: 3 });

      // Assert
      expect(parser).toBeInstanceOf(QueryParser);
    });

    it('should throw QueryParserError when depth is invalid', () => {
      // Act
      const error = catchError(() => QueryParser.create({ depth: -1 }));

      // Assert
      expect(error).toBeInstanceOf(QueryParserError);
      expect(error.reason).toBe(QueryParserErrorReason.InvalidDepth);
    });

    it('should throw QueryParserError when maxParams is invalid', () => {
      // Act
      const error = catchError(() => QueryParser.create({ maxParams: 0 }));

      // Assert
      expect(error).toBeInstanceOf(QueryParserError);
      expect(error.reason).toBe(QueryParserErrorReason.InvalidMaxParams);
    });

    it('should throw QueryParserError when duplicates is invalid', () => {
      // Act
      const error = catchError(() =>
        QueryParser.create({ duplicates: 'invalid' } as unknown as QueryParserOptions),
      );

      // Assert
      expect(error).toBeInstanceOf(QueryParserError);
      expect(error.reason).toBe(QueryParserErrorReason.InvalidDuplicates);
    });

    it('should throw QueryParserError when allowPrototypes is invalid', () => {
      // Act
      const error = catchError(() =>
        QueryParser.create({ allowPrototypes: 'x' } as unknown as QueryParserOptions),
      );

      // Assert
      expect(error).toBeInstanceOf(QueryParserError);
      expect(error.reason).toBe(QueryParserErrorReason.InvalidAllowPrototypes);
    });
  });

  // =========================================================================
  // Core RFC3986 Compliance
  // =========================================================================
  describe('core RFC3986 compliance', () => {
    const parser = QueryParser.create();

    it('should parse simple key=value pairs when query has pairs', () => {
      // Act & Assert
      expect(parser.parse('foo=bar')).toEqual({ foo: 'bar' });
      expect(parser.parse('foo=bar&baz=qux')).toEqual({ foo: 'bar', baz: 'qux' });
    });

    it('should parse percent-encoded keys and values when input is encoded', () => {
      // Act & Assert
      expect(parser.parse('a%20b=c%20d')).toEqual({ 'a b': 'c d' });
      expect(parser.parse('foo=%26%3D')).toEqual({ foo: '&=' });
      expect(parser.parse('path=%2fhome')).toEqual({ path: '/home' });
      expect(parser.parse('path=%2Fhome')).toEqual({ path: '/home' });
    });

    it('should parse empty values when key has no value', () => {
      // Act & Assert
      expect(parser.parse('foo=&bar=')).toEqual({ foo: '', bar: '' });
    });

    it('should parse keys without values when flags are used', () => {
      // Act & Assert
      expect(parser.parse('foo&bar')).toEqual({ foo: '', bar: '' });
    });

    it('should ignore leading question mark when query starts with ?', () => {
      // Act & Assert
      expect(parser.parse('?foo=bar')).toEqual({ foo: 'bar' });
      expect(parser.parse('??foo=bar')).toEqual({ '?foo': 'bar' });
    });

    it('should treat plus sign as literal when strict RFC 3986 applies', () => {
      // Act & Assert
      expect(parser.parse('hello+world=test')).toEqual({ 'hello+world': 'test' });
    });

    it('should not double-decode values when percent encoded twice', () => {
      // Act & Assert
      expect(parser.parse('key=%2520')).toEqual({ key: '%20' });
    });

    it('should handle multiple equals signs when value includes =', () => {
      // Act & Assert
      expect(parser.parse('a=b=c')).toEqual({ a: 'b=c' });
      expect(parser.parse('a==b')).toEqual({ a: '=b' });
    });
  });

  // =========================================================================
  // Empty Input & Boundary Conditions
  // =========================================================================
  describe('empty input and boundary conditions', () => {
    const parser = QueryParser.create();

    it('should return empty object when input is empty string', () => {
      // Act & Assert
      expect(parser.parse('')).toEqual({});
    });

    it('should return empty object when only question mark is provided', () => {
      // Act & Assert
      expect(parser.parse('?')).toEqual({});
    });

    it('should return empty object when only empty sequences are provided', () => {
      // §2.2 — '&'-only input is all empty sequences and produces no pairs.
      // Act & Assert
      expect(parser.parse('&')).toEqual({});
      expect(parser.parse('&&&&')).toEqual({});
    });

    it('should keep empty-name pairs whose segment is non-empty (§2.3)', () => {
      // Act & Assert — a '=' segment has an empty name but IS kept; duplicates
      // 'first' (default) collapses the repeated empty name to a single entry.
      expect(parser.parse('=')).toEqual({ '': '' });
      expect(parser.parse('=&=&=')).toEqual({ '': '' });
      expect(parser.parse('=value')).toEqual({ '': 'value' });
      expect(parser.parse('=value&foo=bar')).toEqual({ '': 'value', foo: 'bar' });
    });

    it('should handle extra ampersands when delimiters repeat', () => {
      // Act & Assert
      expect(parser.parse('a=1&&b=2')).toEqual({ a: '1', b: '2' });
      expect(parser.parse('a=1&')).toEqual({ a: '1' });
      expect(parser.parse('&a=1')).toEqual({ a: '1' });
      expect(parser.parse('a=1&&&&&b=2')).toEqual({ a: '1', b: '2' });
    });
  });

  // =========================================================================
  // nesting enabled
  // =========================================================================
  describe('nesting enabled', () => {
    const parser = QueryParser.create({ nesting: true });

    it('should parse nested object when brackets are used', () => {
      // Act & Assert
      expect(parser.parse('user[name]=alice')).toEqual({ user: { name: 'alice' } });
      expect(parser.parse('user[name]=alice&user[age]=20')).toEqual({
        user: { name: 'alice', age: '20' },
      });
    });

    it('should parse array with explicit indices when indexed brackets provided', () => {
      // Act
      const res = parser.parse('arr[0]=a&arr[1]=b');

      // Assert
      expect(expectQueryArray(res.arr)).toEqual(['a', 'b']);
    });

    it('should parse array with empty brackets when push-style syntax used', () => {
      // Act
      const res = parser.parse('arr[]=a&arr[]=b');

      // Assert
      expect(expectQueryArray(res.arr)).toEqual(['a', 'b']);
    });

    it('should parse mixed array in object when nested arrays appear', () => {
      // Act & Assert
      expect(parser.parse('user[phones][0]=123&user[phones][1]=456')).toEqual({
        user: { phones: ['123', '456'] },
      });
    });

    it('should parse object in array when nested objects appear', () => {
      // Act & Assert
      expect(parser.parse('users[0][name]=alice&users[1][name]=bob')).toEqual({
        users: [{ name: 'alice' }, { name: 'bob' }],
      });
    });

    it('should parse deeply nested structures when depth allows', () => {
      // Act & Assert
      expect(parser.parse('a[b][c][d][e]=deep')).toEqual({
        a: { b: { c: { d: { e: 'deep' } } } },
      });
    });

    it('should materialize to an object when indices skip positions (no hole)', () => {
      // arr[5] on a length-1 array is a hole (5 > 1) → materializes losslessly
      // instead of padding with null/undefined.
      // Act
      const res = parser.parse('arr[0]=a&arr[5]=b');
      const arr = expectQueryRecord(res.arr);

      // Assert
      expect(arr['0']).toBe('a');
      expect(arr['5']).toBe('b');
    });

    it('should materialize to an object when indices arrive out of order (no hole)', () => {
      // arr[2] on an empty array is a hole (2 > 0) → materializes immediately;
      // the later arr[0] lands as an ordinary object key.
      // Act
      const res = parser.parse('arr[2]=c&arr[0]=a');
      const arr = expectQueryRecord(res.arr);

      // Assert
      expect(arr['0']).toBe('a');
      expect(arr['2']).toBe('c');
    });

    it('should parse mixed bracket types when array contains object', () => {
      // Act & Assert
      expect(parser.parse('a[0][name]=alice')).toEqual({ a: [{ name: 'alice' }] });
    });
  });

  // =========================================================================
  // nesting disabled (default)
  // =========================================================================
  describe('nesting disabled', () => {
    const parser = QueryParser.create({ nesting: false });

    it('should treat brackets as literal key characters when nesting is false', () => {
      // Act & Assert
      expect(parser.parse('user[name]=alice')).toEqual({ 'user[name]': 'alice' });
      expect(parser.parse('arr[0]=a')).toEqual({ 'arr[0]': 'a' });
      expect(parser.parse('arr[]=a')).toEqual({ 'arr[]': 'a' });
      expect(parser.parse('a[b][c]=d')).toEqual({ 'a[b][c]': 'd' });
    });

    it('should keep percent-encoded brackets as literal key characters when nesting is false', () => {
      // Decode-then-parse: the key decodes to 'a[b]' but nesting is off, so the
      // decoded brackets stay literal in the key name.
      // Act & Assert
      expect(parser.parse('a%5Bb%5D=c')).toEqual({ 'a[b]': 'c' });
    });
  });

  // =========================================================================
  // depth
  // =========================================================================
  describe('depth', () => {
    it('should use default depth when no depth is provided', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true });

      // Act & Assert
      expect(parser.parse('a[b][c][d][e][f]=deep')).toEqual({
        a: { b: { c: { d: { e: { f: 'deep' } } } } },
      });
      expect(parser.parse('a[b][c][d][e][f][g]=blocked')).toEqual({
        a: { b: { c: { d: { e: { f: {} } } } } },
      });
    });

    it('should enforce depth 0 when nesting is disallowed', () => {
      // Arrange
      const parser = QueryParser.create({ depth: 0, nesting: true });

      // Act & Assert
      expect(parser.parse('a[b]=c')).toEqual({ a: {} });
    });

    it('should enforce depth 1 when one level is allowed', () => {
      // Arrange
      const parser = QueryParser.create({ depth: 1, nesting: true });

      // Act & Assert
      expect(parser.parse('a[b]=c')).toEqual({ a: { b: 'c' } });
      expect(parser.parse('a[b][c]=d')).toEqual({ a: { b: {} } });
    });
  });

  // =========================================================================
  // maxParams
  // =========================================================================
  describe('maxParams', () => {
    it('should use default maxParams when not provided', () => {
      // Arrange
      const parser = QueryParser.create();
      const params = Array.from({ length: 1001 }, (_, i) => `p${i}=${i}`).join('&');

      // Act
      const res = parser.parse(params);

      // Assert
      expect(Object.keys(res).length).toBe(1000);
    });

    it('should enforce maxParams 1 when limit is set', () => {
      // Arrange
      const parser = QueryParser.create({ maxParams: 1 });

      // Act & Assert
      expect(parser.parse('a=1&b=2&c=3')).toEqual({ a: '1' });
    });

    it('should enforce maxParams 2 when limit is set', () => {
      // Arrange
      const parser = QueryParser.create({ maxParams: 2 });

      // Act & Assert
      expect(parser.parse('a=1&b=2&c=3')).toEqual({ a: '1', b: '2' });
    });

    it('should keep all pairs when the pair count equals maxParams exactly', () => {
      // Arrange — boundary: the limit truncates only pairs BEYOND maxParams.
      const parser = QueryParser.create({ maxParams: 2 });

      // Act & Assert
      expect(parser.parse('a=1&b=2')).toEqual({ a: '1', b: '2' });
    });
  });

  // =========================================================================
  // arrayLimit
  // =========================================================================
  describe('arrayLimit', () => {
    it('should use default arrayLimit when not provided', () => {
      // Arrange — arr[20] alone is a hole on the empty array (20 > length(0)),
      // regardless of being within arrayLimit(20), so it materializes to an
      // object instead of padding indices 0-19 with null/undefined.
      const parser = QueryParser.create({ nesting: true });

      // Act
      const allowed = parser.parse('arr[20]=ok');
      const blocked = parser.parse('arr[21]=blocked');

      // Assert
      expect(expectQueryRecord(allowed.arr)).toEqual({ '20': 'ok' });
      expect(expectQueryRecord(blocked.arr)).toEqual({ '21': 'blocked' });
    });

    it('should enforce arrayLimit 0 when limit is set', () => {
      // Arrange
      const parser = QueryParser.create({ arrayLimit: 0, nesting: true });

      // Act
      const first = parser.parse('arr[0]=a');
      // arr[1] is over arrayLimit(0) on an already-populated array →
      // materializes losslessly instead of dropping the second pair.
      const filtered = parser.parse('arr[0]=a&arr[1]=b');
      const fallback = parser.parse('arr[1]=b');

      // Assert
      expect(expectQueryArray(first.arr)).toEqual(['a']);
      expect(expectQueryRecord(filtered.arr)).toEqual({ '0': 'a', '1': 'b' });
      expect(expectQueryRecord(fallback.arr)).toEqual({ '1': 'b' });
    });

    it('should create an object container for an over-limit index at an intermediate level', () => {
      // Arrange — shouldCreateArray rejects indices above arrayLimit at container
      // creation, so the intermediate level becomes an object and the value is kept.
      const parser = QueryParser.create({ nesting: true });

      // Act & Assert
      expect(parser.parse('arr[21][x]=y')).toEqual({ arr: { '21': { x: 'y' } } });
    });

    it('should enforce arrayLimit 10 when limit is set', () => {
      // Arrange — arr[10] on a length-1 array is a hole (10 > 1) regardless of
      // arrayLimit, so it materializes losslessly; arr[11] is additionally
      // over arrayLimit(10) and materializes the same way (no drop).
      const parser = QueryParser.create({ arrayLimit: 10, nesting: true });

      // Act
      const allowed = parser.parse('arr[0]=a&arr[10]=b');
      const blocked = parser.parse('arr[0]=a&arr[11]=blocked');

      // Assert
      expect(expectQueryRecord(allowed.arr)).toEqual({ '0': 'a', '10': 'b' });
      expect(expectQueryRecord(blocked.arr)).toEqual({ '0': 'a', '11': 'blocked' });
    });
  });

  // =========================================================================
  // duplicates
  // =========================================================================
  describe('duplicates', () => {
    it('should keep first value when duplicates is first', () => {
      // Arrange
      const parser = QueryParser.create({ duplicates: 'first' });

      // Act & Assert
      expect(parser.parse('id=1&id=2')).toEqual({ id: '1' });
      expect(parser.parse('x=a&x=b&x=c')).toEqual({ x: 'a' });
    });

    it('should keep last value when duplicates is last', () => {
      // Arrange
      const parser = QueryParser.create({ duplicates: 'last' });

      // Act & Assert
      expect(parser.parse('id=1&id=2')).toEqual({ id: '2' });
      expect(parser.parse('x=a&x=b&x=c')).toEqual({ x: 'c' });
    });

    it('should collect all values when duplicates is array', () => {
      // Arrange
      const parser = QueryParser.create({ duplicates: 'array' });

      // Act
      const two = parser.parse('id=1&id=2');
      const many = parser.parse('id=1&id=2&id=3&id=4');

      // Assert
      expect(expectQueryArray(two.id)).toEqual(['1', '2']);
      expect(expectQueryArray(many.id)).toEqual(['1', '2', '3', '4']);
    });

    it('should not wrap single value when duplicates is array', () => {
      // Arrange
      const parser = QueryParser.create({ duplicates: 'array' });

      // Act & Assert
      expect(parser.parse('id=1')).toEqual({ id: '1' });
    });

    it('should drop a scalar duplicate of a record-valued key when duplicates is array', () => {
      // Traced behavior: with duplicates 'array', a later scalar for a key that
      // already holds a RECORD (not an array) is silently dropped — only an
      // existing array collects the scalar. The record is never wrapped.
      const parser = QueryParser.create({ nesting: true, duplicates: 'array' });

      // Act & Assert
      expect(parser.parse('a[b]=1&a=2')).toEqual({ a: { b: '1' } });
    });

    it('should allow explicit array brackets when duplicates is first and nesting is true', () => {
      // Arrange
      const parser = QueryParser.create({ duplicates: 'first', nesting: true });

      // Act
      const res = parser.parse('arr[]=1&arr[]=2');

      // Assert
      expect(expectQueryArray(res.arr)).toEqual(['1', '2']);
    });

    it('should keep first value for a duplicate explicit array index when duplicates is first', () => {
      // Arrange — must be consistent with the object-key path (k[a]=1&k[a]=2 -> {k:{a:'1'}}).
      const parser = QueryParser.create({ duplicates: 'first', nesting: true });

      // Act & Assert
      expect(parser.parse('k[0]=1&k[0]=2')).toEqual({ k: ['1'] });
    });

    it('should keep last value for a duplicate explicit array index when duplicates is last', () => {
      // Arrange
      const parser = QueryParser.create({ duplicates: 'last', nesting: true });

      // Act & Assert
      expect(parser.parse('k[0]=1&k[0]=2')).toEqual({ k: ['2'] });
    });

    it('should collect values for a duplicate explicit array index when duplicates is array', () => {
      // Arrange — consistent with the object-key path (k[a] array -> {k:{a:['1','2']}}).
      const parser = QueryParser.create({ duplicates: 'array', nesting: true });

      // Act & Assert
      expect(parser.parse('k[0]=1&k[0]=2')).toEqual({ k: [['1', '2']] });
    });

    it('should apply the duplicates strategy to a duplicate index at a deeper position', () => {
      // Arrange — the index-leaf fix must fire at any depth, not just the top level.
      // Consistent with object path a[x][y]=1&a[x][y]=2 -> {a:{x:{y:'1'}}}.
      const parser = QueryParser.create({ duplicates: 'first', nesting: true });

      // Act & Assert
      expect(parser.parse('a[0][0]=1&a[0][0]=2')).toEqual({ a: [['1']] });
    });

    it('should apply the duplicates strategy when an explicit index duplicates a pushed element', () => {
      // Arrange — arr[]=1 pushes to index 0; arr[0]=2 then duplicates that same index.
      const parser = QueryParser.create({ duplicates: 'first', nesting: true });

      // Act & Assert
      expect(parser.parse('arr[]=1&arr[0]=2')).toEqual({ arr: ['1'] });
    });
  });

  // =========================================================================
  // Security: Prototype Pollution
  // =========================================================================
  describe('security: prototype pollution', () => {
    // Policy: by default (`allowPrototypes: false`), every own-property name of
    // `Object.prototype` (`constructor`, `toString`, `hasOwnProperty`,
    // `__defineGetter__`, …) is dropped from the parsed output at every position
    // — root, nested segment, and leaf — exactly like `__proto__` always was.
    // `__proto__` itself remains blocked unconditionally, even when
    // `allowPrototypes: true` re-admits the rest of the set. Dropping a key at a
    // SEGMENT/LEAF position still leaves the parent container shell in place
    // (e.g. `k[toString]=1` → `{ k: {} }`, not `{}`) — identical in shape to the
    // pre-existing `a[__proto__][x]=1` → `{ a: {} }` behavior. `prototype` is
    // NOT an own-property name of `Object.prototype` (it is an own-property of
    // function objects, not of `Object.prototype`), so it is never blocked — this is
    // qs-parity, not an oversight. The load-bearing, non-negotiable invariant
    // asserted throughout is that no GLOBAL prototype is ever polluted.

    /** Assert no global prototype was mutated by the vectors above. */
    const expectNoGlobalPollution = (): void => {
      expect((({}) as Record<string, unknown>).polluted).toBeUndefined();
      expect((({}) as Record<string, unknown>).x).toBeUndefined();
      expect((([] as unknown) as Record<string, unknown>).polluted).toBeUndefined();
      expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    };

    it('should block __proto__ as a flat key and leave no pollution', () => {
      // Arrange
      const parser = QueryParser.create();

      // Act & Assert — always blocked, regardless of allowPrototypes
      expect(parser.parse('__proto__=1')).toEqual({});
      expectNoGlobalPollution();
    });

    it('should drop constructor by default but keep prototype (qs-parity)', () => {
      // Arrange
      const parser = QueryParser.create();

      // Act & Assert — `constructor` is an Object.prototype own-name → dropped;
      // `prototype` is NOT (it's on Function.prototype) → kept, matching qs.
      expect(parser.parse('constructor=1')).toEqual({});
      expect(parser.parse('prototype=1')).toEqual({ prototype: '1' });
      expectNoGlobalPollution();
    });

    it('should drop __define*/__lookup* method names by default', () => {
      // Arrange
      const parser = QueryParser.create();

      // Act & Assert — Object.prototype own-names, dropped under the default policy
      expect(parser.parse('__defineGetter__=bad')).toEqual({});
      expect(parser.parse('__defineSetter__=bad')).toEqual({});
      expect(parser.parse('__lookupGetter__=bad')).toEqual({});
      expect(parser.parse('__lookupSetter__=bad')).toEqual({});
      expectNoGlobalPollution();
    });

    it('should block __proto__ at every nested position and leave no pollution', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true });

      // Act
      const protoRoot = parser.parse('__proto__[polluted]=true');
      const protoChild = parser.parse('a[__proto__][polluted]=true');
      const protoArrayChild = parser.parse('a[0][__proto__][polluted]=true');

      // Assert — root position: the poisoned root key is skipped entirely, so
      // no container is ever created for it.
      expect(protoRoot).toEqual({});

      // Assert — object-child position: the "a" container is created, but the
      // __proto__ segment write is skipped entirely (not merely redirected
      // away from the global prototype). The instance-level canary proves the
      // write never happened: the container's OWN prototype is untouched and
      // it never gained a "polluted" own-property.
      expect(protoChild).toEqual({ a: {} });
      const childContainer = expectQueryRecord(protoChild.a);
      expect(Object.getPrototypeOf(childContainer)).toBe(Object.prototype);
      expect(childContainer.polluted).toBeUndefined();

      // Assert — array-child position: same skip-the-write behavior one level
      // deeper, inside an array element.
      expect(protoArrayChild).toEqual({ a: [{}] });
      const arrayChildContainer = expectQueryRecord(expectQueryArray(protoArrayChild.a)[0]);
      expect(Object.getPrototypeOf(arrayChildContainer)).toBe(Object.prototype);
      expect(arrayChildContainer.polluted).toBeUndefined();

      // Assert — no GLOBAL prototype was ever mutated by any vector above.
      expectNoGlobalPollution();
    });

    it('should drop constructor at nested positions, leaving the parent shell', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true });

      // Act & Assert — the "constructor" segment is blocked, but the container
      // it would have been written into still exists (shell shape, not `{}`).
      expect(parser.parse('a[constructor]=1')).toEqual({ a: {} });
      expect(parser.parse('filter[constructor]=x')).toEqual({ filter: {} });
      // Blocked at the "constructor" segment itself — the traversal never
      // reaches "prototype"/"x", so only the "a" shell remains.
      expect(parser.parse('a[constructor][prototype][x]=y')).toEqual({ a: {} });
      expectNoGlobalPollution();
    });

    it('should not pollute via the classic constructor.prototype chain vector', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true });

      // Act — the canonical prototype-pollution payloads; "constructor" is
      // blocked at the ROOT position now, so no container is ever created.
      const rootChain = parser.parse('constructor[prototype][polluted]=yes');
      const nestedChain = parser.parse('a[constructor][prototype][polluted]=yes');

      // Assert — root-blocked to an empty object; nested shell stops at "a".
      expect(rootChain).toEqual({});
      expect(nestedChain).toEqual({ a: {} });
      expectNoGlobalPollution();
    });

    it('should drop toString/hasOwnProperty/valueOf by default', () => {
      // Arrange
      const parser = QueryParser.create();

      // Act & Assert — Object.prototype own-names, dropped under the default policy
      expect(parser.parse('toString=hacked')).toEqual({});
      expect(parser.parse('hasOwnProperty=value')).toEqual({});
      expect(parser.parse('valueOf=custom')).toEqual({});
    });

    it('should not pollute Object.prototype via a naive merge of the N-1 gadget payload', () => {
      // Arrange — the classic gadget: constructor[prototype][X]=1 would (under
      // only-__proto__-blocked policies) build { constructor: { prototype: { X: '1' } } },
      // which a naive recursive merge elsewhere in an application walks straight
      // into Object.prototype. Under the default policy "constructor" is blocked
      // at the root, so the gadget shape never materializes in the first place.
      const parser = QueryParser.create({ nesting: true });

      try {
        // Act
        const parsed = parser.parse('constructor[prototype][__NPWN]=1');

        expect(parsed).toEqual({});

        naiveMerge({}, parsed);

        // Assert — the gadget never reached Object.prototype
        expect(({} as Record<string, unknown>).__NPWN).toBeUndefined();
      } finally {
        // Clean up any accidental pollution so other tests are unaffected.
        delete (Object.prototype as Record<string, unknown>).__NPWN;
      }
    });

    it('should leave a working shell (no toString crash) for the N-2 method-shadow vector', () => {
      // Arrange — previously `k[toString]=1` produced { k: { toString: '1' } },
      // an own-property shadow that made `String(out.k)` throw. Now "toString"
      // is blocked at the leaf, so the "k" shell keeps its inherited toString.
      const parser = QueryParser.create({ nesting: true });

      // Act
      const out = parser.parse('k[toString]=1');

      // Assert
      expect(out).toEqual({ k: {} });
      expect(String((out as unknown as { k: unknown }).k)).toBe('[object Object]');
    });

    it('should drop blocked keys silently even in strict mode, never throwing', () => {
      // Arrange — strict mode validates structure, not key names; a blocked
      // key is dropped exactly like non-strict, never surfaced as an error.
      const parser = QueryParser.create({ nesting: true, strict: true });

      // Act & Assert
      expect(parser.parse('a[constructor]=1')).toEqual({ a: {} });
      expect(() => parser.parse('a[constructor]=1')).not.toThrow();
    });

    it('should restore the old behavior when allowPrototypes is true, except __proto__', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true, allowPrototypes: true });

      // Act & Assert — opt-in reverts to __proto__-only blocking
      expect(parser.parse('a[toString]=1')).toEqual({ a: { toString: '1' } });

      // __proto__ is still blocked unconditionally, even under allowPrototypes
      expect(parser.parse('a[__proto__][x]=1')).toEqual({ a: {} });
      expectNoGlobalPollution();
    });
  });

  // =========================================================================
  // International Characters
  // =========================================================================
  describe('international characters', () => {
    const parser = QueryParser.create();

    it('should handle Korean characters when present', () => {
      // Act & Assert
      expect(parser.parse('한글=테스트')).toEqual({ 한글: '테스트' });
      expect(parser.parse('name=%ED%95%9C%EA%B8%80')).toEqual({ name: '한글' });
    });

    it('should handle emoji characters when provided', () => {
      // Act & Assert
      expect(parser.parse('😊=👍')).toEqual({ '😊': '👍' });
      expect(parser.parse('mood=%F0%9F%98%8A')).toEqual({ mood: '😊' });
    });
  });

  // =========================================================================
  // Encoding Edge Cases
  // =========================================================================
  describe('encoding edge cases', () => {
    const parser = QueryParser.create();

    it('should handle reserved characters when encoded', () => {
      // Act & Assert
      expect(parser.parse('eq=%3D&amp=%26')).toEqual({ eq: '=', amp: '&' });
    });

    // -----------------------------------------------------------------------
    // WHATWG §2.5/§2.6 behavior — expectations verified against the WHATWG
    // oracle (URLSearchParams). The hybrid decoder (byte-level percent-decode +
    // UTF-8 decode WITHOUT BOM, replacement mode) implements these.
    // -----------------------------------------------------------------------

    // §2.6 [MUST] a malformed '%' (non-hex or truncated) is NOT an error — the
    // '%' is preserved as a literal octet and decoding continues.
    it('should preserve a non-hex percent sequence as a literal when non-strict', () => {
      // Act & Assert
      expect(parser.parse('key=%zz')).toEqual({ key: '%zz' });
      expect(parser.parse('key=%ZZ')).toEqual({ key: '%ZZ' });
    });

    it('should preserve a truncated percent sequence as a literal when non-strict', () => {
      // Act & Assert — boundary: one hex digit short, and a lone '%'
      expect(parser.parse('a=%2')).toEqual({ a: '%2' });
      expect(parser.parse('a=%')).toEqual({ a: '%' });
    });

    // §2.6 partial decode — a malformed '%' is preserved while an adjacent,
    // well-formed %XX in the SAME token is still decoded.
    it('should decode valid escapes around a malformed one (partial decode)', () => {
      // Act & Assert
      expect(parser.parse('a=%ZZ%41')).toEqual({ a: '%ZZA' });
      expect(parser.parse('a=%41%ZZ')).toEqual({ a: 'A%ZZ' });
      expect(parser.parse('a=x%20y%ZZz')).toEqual({ a: 'x y%ZZz' });
    });

    // §2.5 [MUST] an invalid UTF-8 sequence is replaced with U+FFFD, NOT a parse
    // failure. '%C3%28': C3 begins a 2-byte sequence, 28 ('(') is not a valid
    // continuation, so C3 → U+FFFD and '(' is reprocessed.
    it('should replace an invalid UTF-8 byte with U+FFFD in a value when non-strict', () => {
      // Act & Assert
      expect(parser.parse('bad=%FF')).toEqual({ bad: '�' });
      expect(parser.parse('bad=%E0%A4')).toEqual({ bad: '�' });
      expect(parser.parse('bad=%C3%28')).toEqual({ bad: '�(' });
    });

    it('should replace an invalid UTF-8 byte with U+FFFD in a key when non-strict', () => {
      // Act & Assert
      expect(parser.parse('%E0%A4=value')).toEqual({ '�': 'value' });
    });

    // §2.5 "UTF-8 decode WITHOUT BOM": a leading BOM must be PRESERVED (the
    // fallback TextDecoder must set ignoreBOM:true). Only reachable when another
    // byte forces the byte-level path — a lone valid BOM takes the fast path.
    it('should preserve a leading BOM while replacing an adjacent invalid byte', () => {
      // Act & Assert
      expect(parser.parse('b=%EF%BB%BF%FF')).toEqual({ b: '﻿�' });
    });

    // §2.6 [MUST] malformed percent is not an error even in STRICT mode — strict
    // validates structure (brackets/conflicts), never percent syntax.
    it('should NOT throw on malformed percent encoding in strict mode', () => {
      // Arrange
      const strictParser = QueryParser.create({ strict: true });

      // Act & Assert
      expect(strictParser.parse('q=%ZZ')).toEqual({ q: '%ZZ' });
      expect(strictParser.parse('bad=%E0%A4')).toEqual({ bad: '�' });
      expect(strictParser.parse('%E0%A4=value')).toEqual({ '�': 'value' });
    });

    // §2.5 — overlong encodings and surrogate-range code points are ill-formed
    // UTF-8; each maximal invalid subpart becomes one U+FFFD. Values verified
    // against the WHATWG oracle (URLSearchParams).
    it('should replace overlong / surrogate UTF-8 with U+FFFD per maximal subpart', () => {
      // Act & Assert
      expect(parser.parse('k=%C0%80')).toEqual({ k: '��' }); // overlong NUL
      expect(parser.parse('k=%ED%A0%80')).toEqual({ k: '���' }); // UTF-16 lead surrogate
      expect(parser.parse('k=%F0%80%80%80')).toEqual({ k: '����' }); // overlong 4-byte
    });

    // §2.6 — partial-decode boundaries: a doubled '%' and a trailing '%'.
    it('should partial-decode at a doubled or trailing percent boundary', () => {
      // Act & Assert
      expect(parser.parse('k=%%41')).toEqual({ k: '%A' }); // first '%' malformed, '%41' decodes
      expect(parser.parse('k=%41%')).toEqual({ k: 'A%' }); // '%41' decodes, trailing '%' literal
    });

    // §2.5/§2.6 — key/value symmetry: partial decode applies to keys too.
    it('should partial-decode a malformed sequence in the key', () => {
      // Act & Assert
      expect(parser.parse('%ZZ%41=v')).toEqual({ '%ZZA': 'v' });
    });

    // §2.5 fast-path guard — a lone, well-formed BOM is valid UTF-8, so it takes
    // the native fast path and must be PRESERVED (regression guard for a decoder
    // that wrongly strips BOM on the common path).
    it('should preserve a lone well-formed BOM', () => {
      // Act & Assert
      expect(parser.parse('k=%EF%BB%BF')).toEqual({ k: '﻿' });
    });

    // §2.5 success-path guard — a well-formed multi-byte sequence must still
    // decode correctly after the hybrid decoder replaces decodeURIComponent.
    it('should still decode a well-formed multi-byte sequence', () => {
      // Act & Assert
      expect(parser.parse('k=%E0%A4%A8')).toEqual({ k: 'न' });
    });

    // §1.4 — percent-encoding hex digits are case-insensitive.
    it('should treat percent-encoding hex digits as case-insensitive', () => {
      // Act & Assert
      expect(parser.parse('a=%3a&b=%3A')).toEqual({ a: ':', b: ':' });
    });

    // §2.1 — ';' is a data octet, never a pair delimiter.
    it('should treat a semicolon as data, not a delimiter', () => {
      // Act & Assert
      expect(parser.parse('a=1;b=2')).toEqual({ a: '1;b=2' });
    });

    it('should handle null bytes when present', () => {
      // Act & Assert
      expect(parser.parse('key=%00value').key).toBe('\0value');
    });

    it('should handle control characters when encoded', () => {
      // Act & Assert
      expect(parser.parse('key=%0A%0D%09')).toEqual({ key: '\n\r\t' });
    });

    it('should handle extremely long keys when length is large', () => {
      // Arrange
      const longKey = 'a'.repeat(10000);

      // Act
      const res = parser.parse(`${longKey}=1`);

      // Assert
      expect(Object.getOwnPropertyDescriptor(res, longKey)?.value).toBe('1');
    });
  });

  // =========================================================================
  // WHATWG §2.3 — empty-name pairs. Expectations verified against the WHATWG
  // oracle (URLSearchParams): a '=' at the first byte yields an empty-string
  // name; the pair is KEPT, not dropped.
  // =========================================================================
  describe('empty-name pairs (§2.3)', () => {
    const parser = QueryParser.create();

    it('should keep a pair whose name is empty when value is present', () => {
      // Act & Assert — URLSearchParams('=v') → [['', 'v']]
      expect(parser.parse('=v')).toEqual({ '': 'v' });
    });

    it('should keep a pair whose name and value are both empty', () => {
      // Act & Assert — boundary: '=' is both the first and last byte
      expect(parser.parse('=')).toEqual({ '': '' });
    });

    it('should keep an interior empty-name pair alongside named pairs', () => {
      // Act & Assert — URLSearchParams('a=1&=2') → [['a','1'],['','2']]
      expect(parser.parse('a=1&=2')).toEqual({ a: '1', '': '2' });
    });

    it('should collect duplicate empty-name values under duplicates array', () => {
      // Arrange
      const arrayParser = QueryParser.create({ duplicates: 'array' });

      // Act & Assert — [['','v'],['','w']] → all values retained
      expect(arrayParser.parse('=v&=w')).toEqual({ '': ['v', 'w'] });
    });

    it('should keep the first value for a duplicate empty name under duplicates first', () => {
      // Arrange
      const firstParser = QueryParser.create({ duplicates: 'first' });

      // Act & Assert
      expect(firstParser.parse('=v&=w')).toEqual({ '': 'v' });
    });

    it('should keep the last value for a duplicate empty name under duplicates last', () => {
      // Arrange
      const lastParser = QueryParser.create({ duplicates: 'last' });

      // Act & Assert
      expect(lastParser.parse('=v&=w')).toEqual({ '': 'w' });
    });

    it('should keep an empty-name pair that follows a leading empty sequence', () => {
      // Act & Assert — '&=x': the leading '&' is skipped, then ('', 'x') is kept
      expect(parser.parse('&=x')).toEqual({ '': 'x' });
    });
  });

  // =========================================================================
  // WHATWG §2.2 — empty sequences (`&&`) are skipped WITHOUT consuming the
  // maxParams budget (paramCount only counts produced pairs).
  // =========================================================================
  describe('empty sequences and maxParams (§2.2)', () => {
    it('should not let leading empty sequences consume the maxParams budget', () => {
      // Arrange
      const parser = QueryParser.create({ maxParams: 2 });

      // Act & Assert — the two leading '&' produce nothing and must not count
      expect(parser.parse('&&a=1&b=2')).toEqual({ a: '1', b: '2' });
    });

    it('should not let interior empty sequences consume the maxParams budget', () => {
      // Arrange
      const parser = QueryParser.create({ maxParams: 2 });

      // Act & Assert
      expect(parser.parse('a=1&&&b=2')).toEqual({ a: '1', b: '2' });
    });

    it('should not let surrounding empty sequences consume the maxParams budget', () => {
      // Arrange
      const parser = QueryParser.create({ maxParams: 2 });

      // Act & Assert
      expect(parser.parse('&&a=1&&b=2&&')).toEqual({ a: '1', b: '2' });
    });

    it('should still cap at maxParams counting only produced pairs', () => {
      // Arrange — boundary: real pairs DO count; the 3rd exceeds the cap
      const parser = QueryParser.create({ maxParams: 2 });

      // Act & Assert
      expect(parser.parse('a=1&b=2&c=3')).toEqual({ a: '1', b: '2' });
    });

    it('should reach the maxParams-th real pair despite an interior empty sequence', () => {
      // Arrange — BVA: exactly maxParams real pairs, with an empty sequence
      // between them; the empty '&&' must not consume the budget before b=2.
      const parser = QueryParser.create({ maxParams: 2 });

      // Act & Assert
      expect(parser.parse('a=1&&b=2')).toEqual({ a: '1', b: '2' });
    });
  });

  // =========================================================================
  // Special Key Names
  // =========================================================================
  describe('special key names', () => {
    const parser = QueryParser.create();

    it('should handle JavaScript reserved words when used as keys', () => {
      // Act & Assert
      expect(parser.parse('class=test&function=foo&return=bar')).toEqual({
        class: 'test',
        function: 'foo',
        return: 'bar',
      });
    });

    it('should handle numeric keys when provided', () => {
      // Act & Assert
      expect(parser.parse('123=value&0=zero')).toEqual({ '123': 'value', '0': 'zero' });
    });

    it('should handle special characters in keys when not brackets', () => {
      // Act & Assert
      expect(parser.parse('user.name=alice')).toEqual({ 'user.name': 'alice' });
      expect(parser.parse('user-name=alice')).toEqual({ 'user-name': 'alice' });
      expect(parser.parse('user_name=alice')).toEqual({ user_name: 'alice' });
    });
  });

  // =========================================================================
  // Bracket Edge Cases
  // =========================================================================
  describe('bracket edge cases', () => {
    const parser = QueryParser.create({ nesting: true });

    it('should handle unclosed bracket as literal when strict is false', () => {
      // Act & Assert
      expect(parser.parse('a[=b')).toEqual({ 'a[': 'b' });
    });

    it('should handle unmatched close bracket as literal when strict is false', () => {
      // Act & Assert
      expect(parser.parse('a]=b')).toEqual({ 'a]': 'b' });
    });

    it('should handle encoded brackets when percent encoded', () => {
      // Intentional decode-then-parse semantics (matches qs): keys are fully
      // percent-decoded BEFORE bracket detection, so %5B/%5D act structurally
      // under nesting — there is no way to smuggle a literal '[' into a key.
      // Act & Assert
      expect(parser.parse('a%5Bb%5D=c')).toEqual({ a: { b: 'c' } });
    });

    it('should keep the non-strict fallback for a stray close bracket in the root-key portion', () => {
      // The stray ']' before the first '[' only errors in strict mode; the
      // non-strict shape is locked in here.
      // Act & Assert
      expect(parser.parse('a]b[c]=1')).toEqual({ 'a]b': { c: '1' } });
    });

    it('should silently drop garbage characters between bracket groups when strict is false', () => {
      // Non-strict keeps only the bracket segments; 'junk' is discarded.
      // Act & Assert
      expect(parser.parse('a[b]junk[c]=1')).toEqual({ a: { b: { c: '1' } } });
    });

    it('should reject empty root key when brackets are used', () => {
      // Act & Assert
      expect(parser.parse('[foo]=bar')).toEqual({});
    });
  });

  // =========================================================================
  // Value Edge Cases
  // =========================================================================
  describe('value edge cases', () => {
    const parser = QueryParser.create();

    it('should handle JSON-like value when encoded', () => {
      // Arrange
      const encoded = encodeURIComponent('{"key":"value"}');

      // Act & Assert
      expect(parser.parse(`data=${encoded}`)).toEqual({ data: '{"key":"value"}' });
    });

    it('should handle base64 value when padding is present', () => {
      // Act & Assert
      expect(parser.parse('data=SGVsbG8gV29ybGQ=')).toEqual({ data: 'SGVsbG8gV29ybGQ=' });
    });
  });

  // =========================================================================
  // Combined Options
  // =========================================================================
  describe('combined options', () => {
    it('should handle HPP with nesting when both enabled', () => {
      // Arrange
      const parser = QueryParser.create({ duplicates: 'array', nesting: true });

      // Act
      const res = parser.parse('a=1&a=2&b[]=x&b[]=y');

      // Assert
      expect(expectQueryArray(res.a)).toEqual(['1', '2']);
      expect(expectQueryArray(res.b)).toEqual(['x', 'y']);
    });

    it('should handle depth with nesting when depth is set', () => {
      // Arrange
      const parser = QueryParser.create({ depth: 1, nesting: true });

      // Act & Assert
      expect(parser.parse('a[b][c]=d')).toEqual({ a: { b: {} } });
    });

    it('should handle arrayLimit with nesting when limit is set', () => {
      // Arrange — arr[2] on a length-1 array is a hole (2 > 1), so it
      // materializes losslessly (no null padding, no drop); the later
      // arr[3] then lands as an ordinary key on the now-materialized object.
      const parser = QueryParser.create({ arrayLimit: 2, nesting: true });

      // Act
      const res = parser.parse('arr[0]=a&arr[2]=b&arr[3]=blocked');

      // Assert
      expect(expectQueryRecord(res.arr)).toEqual({ '0': 'a', '2': 'b', '3': 'blocked' });
    });
  });

  // =========================================================================
  // Array/Object Conflict
  // =========================================================================
  describe('array/object conflict', () => {
    const parser = QueryParser.create({ nesting: true });

    it('should handle array first then object notation when mixed', () => {
      // Act
      const res = parser.parse('data[0]=a&data[name]=b');

      // Assert — array converted to object
      expect(res.data).toEqual({ '0': 'a', name: 'b' });
    });

    it('should handle object first then array notation when mixed', () => {
      // Act
      const res = parser.parse('data[name]=a&data[0]=b');

      // Assert — stays as object
      expect(res.data).toEqual({ name: 'a', '0': 'b' });
    });

    it('should replace a root scalar with the nested structure when a bracket key follows', () => {
      // Non-strict: the later structural key rebuilds the root container
      // regardless of the duplicates strategy — the scalar '1' is discarded.
      expect(parser.parse('a=1&a[b]=2')).toEqual({ a: { b: '2' } });
    });

    it('should keep the nested structure when a scalar follows under default duplicates', () => {
      // Non-strict, duplicates 'first': the later scalar for a structured key is dropped.
      expect(parser.parse('a[b]=1&a=2')).toEqual({ a: { b: '1' } });
    });

    it('should overwrite the nested structure with the scalar when duplicates is last', () => {
      // Arrange
      const lastParser = QueryParser.create({ nesting: true, duplicates: 'last' });

      // Act & Assert
      expect(lastParser.parse('a[b]=1&a=2')).toEqual({ a: '2' });
    });

    it('should skip holes when converting a sparse array to an object', () => {
      // arrayToObject iterates own keys only, so indices 0-4 never materialize.
      // Act
      const res = parser.parse('arr[5]=b&arr[foo]=x');

      // Assert
      expect(res.arr).toEqual({ '5': 'b', foo: 'x' });
    });

    it('should preserve the nested structure on a non-strict array-index structure-then-scalar conflict', () => {
      // The object-key path keeps the structure (k[a][b]=1&k[a]=2 -> {k:{a:{b:'1'}}});
      // the array-index path must not silently drop {b:'1'} for the later scalar.
      expect(parser.parse('k[0][b]=1&k[0]=2')).toEqual({ k: [{ b: '1' }] });
    });

    it('should overwrite the nested structure with the scalar under duplicates:last on an array index', () => {
      // Guard: the fix must route through the duplicates strategy, NOT hard-code keep-structure.
      // Object path k[a][b]=1&k[a]=2 with last -> {k:{a:'2'}}.
      const lastParser = QueryParser.create({ nesting: true, duplicates: 'last' });
      expect(lastParser.parse('k[0][b]=1&k[0]=2')).toEqual({ k: ['2'] });
    });
  });

  // =========================================================================
  // Additional Edge Cases
  // =========================================================================
  describe('additional edge cases', () => {
    it('should handle negative array index when treated as object property', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true });

      // Act & Assert
      expect(parser.parse('arr[-1]=negative')).toEqual({ arr: { '-1': 'negative' } });
    });

    it('should handle very large index when exceeding arrayLimit', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true, arrayLimit: 20 });

      // Act & Assert
      expect(parser.parse('arr[999999]=huge')).toEqual({ arr: { '999999': 'huge' } });
    });

    it('should reject leading zeros in array index when nesting is true', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true });

      // Act & Assert — '007' has leading zero → object property, not array index
      expect(parser.parse('arr[007]=val')).toEqual({ arr: { '007': 'val' } });
      expect(parser.parse('arr[01]=val')).toEqual({ arr: { '01': 'val' } });

      // '0' itself is still a valid array index
      expect(expectQueryArray(parser.parse('arr[0]=val').arr)).toEqual(['val']);
    });

    it('should treat a 10-digit index as an array index when nesting is true', () => {
      // Arrange — 10 digits is the isValidArrayIndex length boundary: it is
      // still recognized as an index, so the default arrayLimit materializes
      // the over-limit value into the existing array losslessly (no drop).
      const parser = QueryParser.create({ nesting: true });

      // Act & Assert
      expect(parser.parse('arr[0]=a&arr[9999999999]=x')).toEqual({ arr: { '0': 'a', '9999999999': 'x' } });
    });

    it('should fall back to an object key for an 11-digit index when nesting is true', () => {
      // Arrange — 11 digits exceeds the isValidArrayIndex length cap, so the key
      // is non-numeric: the array converts to an object and the value is kept.
      const parser = QueryParser.create({ nesting: true });

      // Act & Assert
      expect(parser.parse('arr[0]=a&arr[12345678901]=x')).toEqual({
        arr: { '0': 'a', '12345678901': 'x' },
      });
    });

    it('should handle mixed empty and indexed brackets when provided', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true });

      // Act
      const res = parser.parse('arr[]=a&arr[1]=b&arr[]=c');
      const arrValue = expectQueryArray(res.arr);

      // Assert
      expect(arrValue[0]).toBe('a');
      expect(arrValue[1]).toBe('b');
      expect(arrValue[2]).toBe('c');
    });

    it('should handle whitespace-only key when decoded', () => {
      // Arrange
      const parser = QueryParser.create();

      // Act
      const res = parser.parse('%20=spacekey');

      // Assert
      expect(Object.getOwnPropertyDescriptor(res, ' ')?.value).toBe('spacekey');
    });
  });

  // =========================================================================
  // Strict Mode
  // =========================================================================
  describe('strict mode', () => {
    it('should throw on unbalanced brackets when strict is true', () => {
      // Arrange
      const parser = QueryParser.create({ strict: true });

      // Act & Assert
      expect(() => parser.parse('a]b=1')).toThrow(/unbalanced brackets/);
      expect(() => parser.parse('a[b=1')).toThrow(/unclosed bracket/);
    });

    it('should throw on nested brackets when strict is true', () => {
      // Arrange
      const parser = QueryParser.create({ strict: true });

      // Act & Assert
      expect(() => parser.parse('a[[b]]=1')).toThrow(/nested brackets/);
    });

    it('should throw on mixed scalar and nested keys when strict is true', () => {
      // Arrange
      const parser = QueryParser.create({ strict: true, nesting: true });

      // Act & Assert — scalar first, then bracket key triggers conflict in parseComplexKey
      expect(() => parser.parse('a=1&a[b]=2')).toThrow(/Conflict/);
    });

    it('should throw on a stray close bracket in the root-key portion when strict and nesting are true', () => {
      // Arrange — the ']' sits BEFORE the first '[', outside the bracket-scan region.
      const parser = QueryParser.create({ strict: true, nesting: true });

      // Act & Assert
      expect(() => parser.parse('a]b[c]=1')).toThrow(/unbalanced brackets/);
    });

    it('should throw on garbage characters between bracket groups when strict and nesting are true', () => {
      // Arrange
      const parser = QueryParser.create({ strict: true, nesting: true });

      // Act
      const error = catchError(() => parser.parse('a[b]junk[c]=1'));

      // Assert
      expect(error.reason).toBe(QueryParserErrorReason.MalformedQueryString);
    });

    it('should throw on nested brackets when strict and nesting are true', () => {
      // Arrange — the nesting:true path validates inside parseComplexKey, not validateBrackets.
      const parser = QueryParser.create({ strict: true, nesting: true });

      // Act & Assert
      expect(() => parser.parse('a[[b]]=1')).toThrow(/nested brackets/);
    });

    it('should throw on an unbalanced close bracket when strict and nesting are true', () => {
      // Arrange
      const parser = QueryParser.create({ strict: true, nesting: true });

      // Act & Assert
      expect(() => parser.parse('a[b]]=1')).toThrow(/unbalanced brackets/);
    });

    it('should throw on an unclosed bracket when strict and nesting are true', () => {
      // Arrange
      const parser = QueryParser.create({ strict: true, nesting: true });

      // Act & Assert
      expect(() => parser.parse('a[b=1')).toThrow(/unclosed bracket/);
    });

    it('should throw when non-numeric key is mixed in array and strict is true', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true, strict: true });

      // Act & Assert
      expect(() => parser.parse('a[0]=1&a[foo]=2')).toThrow(/non-numeric key/);
    });

    it('should convert array to object when non-numeric key is mixed in non-strict mode', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true, strict: false });

      // Act
      const res = parser.parse('a[0]=1&a[foo]=2');

      // Assert — array converted to object
      expect(res.a).toEqual({ '0': '1', foo: '2' });
    });

    it('should handle deep array-to-object conversion when mixed keys appear', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true });

      // Act
      const res = parser.parse('user[roles][0]=admin&user[roles][name]=editor');
      const user = expectQueryRecord(res.user);
      const roles = expectQueryRecord(user.roles);

      // Assert
      expect(roles).toEqual({ '0': 'admin', name: 'editor' });
    });

    it('should throw ConflictingStructure on an array-index structure-then-scalar conflict when strict is true', () => {
      // Arrange — symmetric with the object-key path (k[a][b]=1&k[a]=2). Asserting the
      // reason discriminates from the /non-numeric key/ array-conversion conflict.
      const parser = QueryParser.create({ strict: true, nesting: true });

      // Act
      const error = catchError(() => parser.parse('k[0][b]=1&k[0]=2'));

      // Assert
      expect(error.reason).toBe(QueryParserErrorReason.ConflictingStructure);
    });

    it('should throw ConflictingStructure on an array-index scalar-then-structure conflict when strict is true', () => {
      // Arrange — symmetric with the object-key path (k[a]=1&k[a][b]=2).
      const parser = QueryParser.create({ strict: true, nesting: true });

      // Act
      const error = catchError(() => parser.parse('k[0]=1&k[0][b]=2'));

      // Assert
      expect(error.reason).toBe(QueryParserErrorReason.ConflictingStructure);
    });
  });

  // =========================================================================
  // parseResult — the non-throwing counterpart to parse(). Success returns
  // the parsed record directly (isErr === false); strict structural errors
  // return an Err<QueryParserErrorData> instead of throwing.
  // =========================================================================
  describe('parseResult', () => {
    const assertParseResultErr = (
      result: Result<QueryValueRecord, QueryParserErrorData>,
    ): Err<QueryParserErrorData> => {
      expect(isErr(result)).toBe(true);

      return result as Err<QueryParserErrorData>;
    };

    it('should return the parsed record when the query string is well-formed', () => {
      // Arrange
      const parser = QueryParser.create();

      // Act
      const result = parser.parseResult('a=1&b=2');

      // Assert
      expect(isErr(result)).toBe(false);
      expect(result).toEqual({ a: '1', b: '2' });
    });

    it('should return Ok for a malformed percent escape even in strict mode', () => {
      // Arrange — §2.6: malformed percent syntax is never an error, strict or not
      const parser = QueryParser.create({ strict: true });

      // Act
      const result = parser.parseResult('q=%ZZ');

      // Assert
      expect(isErr(result)).toBe(false);
      expect(result).toEqual({ q: '%ZZ' });
    });

    it('should return Err with MalformedQueryString for a strict bracket structure error', () => {
      // Arrange
      const parser = QueryParser.create({ strict: true, nesting: true });

      // Act
      const result = parser.parseResult('a[b]c[d]=1');

      // Assert
      const errResult = assertParseResultErr(result);

      expect(errResult.data.reason).toBe(QueryParserErrorReason.MalformedQueryString);
    });

    it('should return Err with ConflictingStructure for a strict scalar/structure conflict', () => {
      // Arrange
      const parser = QueryParser.create({ strict: true, nesting: true });

      // Act
      const result = parser.parseResult('a=1&a[b]=2');

      // Assert
      const errResult = assertParseResultErr(result);

      expect(errResult.data.reason).toBe(QueryParserErrorReason.ConflictingStructure);
    });

    it('should return Ok for the same malformed-brackets input under non-strict mode', () => {
      // Arrange — boundary: identical input to the MalformedQueryString case
      // above, but non-strict never returns Err; the structure degrades gracefully.
      const parser = QueryParser.create({ nesting: true });

      // Act
      const result = parser.parseResult('a[b]c[d]=1');

      // Assert
      expect(isErr(result)).toBe(false);
      expect(result).toEqual({ a: { b: { d: '1' } } });
    });
  });

  // =========================================================================
  // Parser Reuse
  // =========================================================================
  describe('parser reuse', () => {
    it('should produce independent results when parser is reused', () => {
      // Arrange
      const parser = QueryParser.create();

      // Act
      const res1 = parser.parse('a=1');
      const res2 = parser.parse('b=2');
      const res3 = parser.parse('a=1');

      // Assert
      expect(res1).toEqual({ a: '1' });
      expect(res2).toEqual({ b: '2' });
      expect(res3).toEqual({ a: '1' });
    });
  });

  // =========================================================================
  // URL-Encoded (application/x-www-form-urlencoded)
  // =========================================================================
  describe('urlEncoded', () => {
    const parser = QueryParser.create({ urlEncoded: true });

    it('should decode plus sign as space in values when urlEncoded is true', () => {
      // Act & Assert
      expect(parser.parse('name=hello+world')).toEqual({ name: 'hello world' });
      expect(parser.parse('q=foo+bar+baz')).toEqual({ q: 'foo bar baz' });
    });

    it('should decode plus sign as space in keys when urlEncoded is true', () => {
      // Act & Assert
      expect(parser.parse('hello+world=test')).toEqual({ 'hello world': 'test' });
    });

    it('should decode plus sign combined with percent encoding when urlEncoded is true', () => {
      // Act & Assert
      expect(parser.parse('name=hello+world%21')).toEqual({ name: 'hello world!' });
      expect(parser.parse('q=%EC%84%9C%EC%9A%B8+%EC%8B%9C')).toEqual({ q: '서울 시' });
    });

    it('should still decode plus as space when the value also has a malformed percent escape', () => {
      // '+'->space and percent-decoding are independent passes per WHATWG
      // x-www-form-urlencoded / URLSearchParams: a failed percent-decode must NOT
      // discard the already-applied '+'->space substitution.
      expect(parser.parse('a=hello+world%ZZ')).toEqual({ a: 'hello world%ZZ' });
      expect(parser.parse('a+b%ZZ=v')).toEqual({ 'a b%ZZ': 'v' });
    });

    it('should apply the plus-with-malformed-percent rule inside a nested bracket key', () => {
      // Arrange — the fix is in safeDecode, which every key/value (incl. bracket segments) flows through.
      const nestingParser = QueryParser.create({ urlEncoded: true, nesting: true });

      // Act & Assert
      expect(nestingParser.parse('user[full+name%ZZ]=alice')).toEqual({ user: { 'full name%ZZ': 'alice' } });
    });

    it('should keep the literal plus on a malformed percent when urlEncoded is false', () => {
      // Negative control — '+'->space must only happen under urlEncoded; the raw fallback is unchanged.
      const defaultParser = QueryParser.create();

      // Act & Assert
      expect(defaultParser.parse('name=a+b%ZZ')).toEqual({ name: 'a+b%ZZ' });
    });

    it('should NOT throw on a malformed percent in strict mode even with urlEncoded', () => {
      // §2.6 target — a malformed percent is not an error; '+'->space still
      // applies and the malformed '%ZZ' is preserved as a literal (Z is not hex).
      const strictParser = QueryParser.create({ urlEncoded: true, strict: true });

      // Act & Assert
      expect(strictParser.parse('a=hello+world%ZZ')).toEqual({ a: 'hello world%ZZ' });
    });

    it('should decode multiple plus signs as multiple spaces when urlEncoded is true', () => {
      // Act & Assert
      expect(parser.parse('q=a++b+++c')).toEqual({ q: 'a  b   c' });
    });

    it('should not decode plus when urlEncoded is false', () => {
      // Arrange
      const defaultParser = QueryParser.create();

      // Act & Assert
      expect(defaultParser.parse('name=hello+world')).toEqual({ name: 'hello+world' });
    });

    it('should handle form-typical payload when urlEncoded is true', () => {
      // Act & Assert
      expect(parser.parse('username=john+doe&password=p%40ss+word&remember=on')).toEqual({
        username: 'john doe',
        password: 'p@ss word',
        remember: 'on',
      });
    });

    it('should handle plus in nested keys when urlEncoded and nesting are true', () => {
      // Arrange
      const nestingParser = QueryParser.create({ urlEncoded: true, nesting: true });

      // Act & Assert
      expect(nestingParser.parse('user[full+name]=alice')).toEqual({ user: { 'full name': 'alice' } });
    });

    it('should handle only-plus values when urlEncoded is true', () => {
      // Act & Assert
      expect(parser.parse('space=+')).toEqual({ space: ' ' });
      expect(parser.parse('spaces=+++')).toEqual({ spaces: '   ' });
    });
  });

  // =========================================================================
  // Array materialization (no holes, no drops) — #4/#5 policy.
  //
  // Policy: an array container stays an array only while explicit indices are
  // dense/append (0 ≤ i ≤ length). The instant an explicit index would create
  // a hole (i > current length) OR exceeds arrayLimit (i > arrayLimit), the
  // WHOLE container materializes into a plain object (string keys, lossless,
  // one-way — never reverts to an array). Existing elements move over via
  // arrayToObject; no null/undefined element is ever produced.
  // =========================================================================
  describe('array materialization (no holes, no drops)', () => {
    /** Recursively asserts no null/undefined appears anywhere in a parsed result. */
    const deepAssertNoNullOrUndefined = (value: unknown, path = '$'): void => {
      expect(value, `null/undefined found at ${path}`).not.toBeNull();
      expect(value, `null/undefined found at ${path}`).not.toBeUndefined();

      if (Array.isArray(value)) {
        // Plain indexed access (NOT forEach/for-of), which silently skip holes
        // in a sparse array — this must visit every index, including holes,
        // to actually prove the "no hole" invariant.
        for (let i = 0; i < value.length; i++) {
          deepAssertNoNullOrUndefined(value[i], `${path}[${i}]`);
        }
      } else if (typeof value === 'object') {
        for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
          deepAssertNoNullOrUndefined(item, `${path}.${key}`);
        }
      }
    };

    it('should keep a dense array when explicit indices are 0..n-1 in order', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true });

      // Act & Assert
      expect(parser.parse('a[0]=x&a[1]=y&a[2]=z')).toEqual({ a: ['x', 'y', 'z'] });
    });

    it('should materialize to an object when a single explicit index leaves a leading hole', () => {
      // Arrange — a[1] on an empty array: 1 > length(0) is a hole.
      const parser = QueryParser.create({ nesting: true });

      // Act & Assert
      expect(parser.parse('a[1]=x')).toEqual({ a: { '1': 'x' } });
    });

    it('should materialize to an object when an explicit index creates a hole (#4)', () => {
      // Arrange — a[2] on an empty array: 2 > length(0) is a hole. No null padding.
      const parser = QueryParser.create({ nesting: true });

      // Act
      const res = parser.parse('a[2]=x');

      // Assert
      expect(res).toEqual({ a: { '2': 'x' } });
      deepAssertNoNullOrUndefined(res);
    });

    it('should materialize to an object when explicit indices arrive in descending order', () => {
      // Arrange — materialization is one-way: once a[2] creates a hole and
      // materializes, later a[1]/a[0] land as ordinary object keys, not a
      // reconstructed dense array.
      const parser = QueryParser.create({ nesting: true });

      // Act & Assert
      expect(parser.parse('a[2]=z&a[1]=y&a[0]=x')).toEqual({ a: { '2': 'z', '1': 'y', '0': 'x' } });
    });

    it('should materialize to an object losslessly when an explicit index exceeds arrayLimit (#5)', () => {
      // Arrange — previously a[25] silently dropped, losing the whole array.
      const parser = QueryParser.create({ nesting: true, arrayLimit: 20 });

      // Act
      const res = parser.parse('a[0]=x&a[25]=z');

      // Assert
      expect(res).toEqual({ a: { '0': 'x', '25': 'z' } });
      deepAssertNoNullOrUndefined(res);
    });

    it('should stay an object when a single over-limit index is the only key', () => {
      // Arrange — unaffected baseline: shouldCreateArray already refuses to
      // create an array for an over-limit root index.
      const parser = QueryParser.create({ nesting: true, arrayLimit: 20 });

      // Act & Assert
      expect(parser.parse('a[25]=z')).toEqual({ a: { '25': 'z' } });
    });

    it('should keep an array for empty-bracket push syntax', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true });

      // Act & Assert
      expect(parser.parse('a[]=1&a[]=2')).toEqual({ a: ['1', '2'] });
    });

    it('should keep an array for a duplicate explicit index under the default (first) strategy', () => {
      // Arrange — i < length is a duplicate, not a hole; array semantics apply.
      const parser = QueryParser.create({ nesting: true });

      // Act & Assert
      expect(parser.parse('a[0]=1&a[0]=2')).toEqual({ a: ['1'] });
    });

    it('should keep an array for a duplicate explicit index under the array strategy', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true, duplicates: 'array' });

      // Act & Assert
      expect(parser.parse('a[0]=1&a[0]=2')).toEqual({ a: [['1', '2']] });
    });

    it('should materialize a nested container-valued array on an index hole', () => {
      // Arrange — a[0][b]=x builds an object at index 0; a[2][c]=y then hits
      // index 2 on a length-1 array, a hole, and must materialize "a" itself
      // (not just fail to nest) while preserving the existing element.
      const parser = QueryParser.create({ nesting: true });

      // Act
      const res = parser.parse('a[0][b]=x&a[2][c]=y');

      // Assert
      expect(res).toEqual({ a: { '0': { b: 'x' }, '2': { c: 'y' } } });
      deepAssertNoNullOrUndefined(res);
    });

    it('should materialize a nested leaf array on an index hole (a[b][2]=x)', () => {
      // Arrange — the hole is one level down: a.b is the array, and index 2
      // on an empty array must materialize a.b, not the "a" object above it.
      const parser = QueryParser.create({ nesting: true });

      // Act
      const res = parser.parse('a[b][2]=x');

      // Assert
      expect(res).toEqual({ a: { b: { '2': 'x' } } });
      deepAssertNoNullOrUndefined(res);
    });

    it('should never contain a null or undefined element across a battery of hole-producing inputs', () => {
      // Arrange
      const parser = QueryParser.create({ nesting: true, arrayLimit: 5 });
      const inputs = [
        'a[3]=x',
        'a[0]=x&a[9]=z',
        'a[0]=x&a[1]=y&a[9]=z',
        'a[9]=z&a[0]=x',
        'a[0][x]=1&a[4][y]=2',
        'a[b][3]=x',
        'a[0]=x&a[100]=z',
      ];

      // Act & Assert
      for (const input of inputs) {
        deepAssertNoNullOrUndefined(parser.parse(input));
      }
    });
  });
});
