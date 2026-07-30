/**
 * DTO-integration contract for the `duplicates: 'array'` default.
 *
 * The default keeps ALL duplicate values in an array precisely because the
 * downstream DTO layer (baker) owns per-field cardinality. This spec pins the
 * load-bearing guarantee END-TO-END against the real baker: a scalar field
 * REJECTS a multi-valued (array) input, so the array default can never silently
 * hand an attacker-appended duplicate to a handler expecting a single value.
 *
 * (The `getQuery(Dto)` accessor wiring itself is AOT-compiled and lives in the
 * compiled-app suite; here we exercise the same `parse → baker.deserialize`
 * hand-off directly.)
 */
import { Baker, Field, arrayOf, isBakerIssueSet } from '@zipbul/baker';
import { isString } from '@zipbul/baker/rules';
import { describe, expect, it } from 'bun:test';

import { QueryParser } from '../src/query-parser';

const parser = QueryParser.create();

const scalarBaker = new Baker();

@scalarBaker.Recipe
class ScalarQueryDto {
  @Field(isString, { optional: true })
  role?: string;
}
scalarBaker.seal();

const arrayBaker = new Baker({ autoConvert: true });

@arrayBaker.Recipe
class ArrayQueryDto {
  @Field(arrayOf(isString), { optional: true })
  tags?: string[];
}
arrayBaker.seal();

/**
 * Recipe for the form-encoding single/multi ambiguity: `?tags=a&tags=b` parses
 * to an array, but `?tags=a` (one occurrence) parses to a bare scalar, which an
 * `arrayOf` field rejects. A one-line `transform` normalizes the lone value into
 * a 1-element array BEFORE the rules run — so the field accepts both arities
 * while keeping full element validation.
 */
const wrapSingleIntoArray = {
  deserialize: ({ value }: { value: unknown }): unknown => (value === undefined || Array.isArray(value) ? value : [value]),
  serialize: ({ value }: { value: unknown }): unknown => value,
};

const coercingBaker = new Baker();

@coercingBaker.Recipe
class CoercingTagsDto {
  @Field(arrayOf(isString), { optional: true, transform: wrapSingleIntoArray })
  tags?: string[];
}
coercingBaker.seal();

describe('duplicates:array default × baker DTO cardinality', () => {
  it('should accept a single value for a scalar field', () => {
    const parsed = parser.parse('role=admin');
    const result = scalarBaker.deserialize(ScalarQueryDto, parsed as Record<string, unknown>);

    expect(isBakerIssueSet(result)).toBe(false);
    expect(result).toEqual({ role: 'admin' });
  });

  it('should REJECT a duplicate-appended multi value for a scalar field (the safety guarantee)', () => {
    // `?role=admin&role=user` → { role: ['admin','user'] } under the array
    // default; a scalar DTO field must reject the array, never silently take one.
    const parsed = parser.parse('role=admin&role=user');

    expect(parsed).toEqual({ role: ['admin', 'user'] });

    const result = scalarBaker.deserialize(ScalarQueryDto, parsed as Record<string, unknown>);

    expect(isBakerIssueSet(result)).toBe(true);
  });

  it('should accept multiple values for an array field', () => {
    const parsed = parser.parse('tags=a&tags=b');
    const result = arrayBaker.deserialize(ArrayQueryDto, parsed as Record<string, unknown>);

    expect(isBakerIssueSet(result)).toBe(false);
    expect(result).toEqual({ tags: ['a', 'b'] });
  });

  it('should reject a lone value for a plain arrayOf field (the single/multi ambiguity)', () => {
    // Documents the raw behavior the transform recipe below exists to fix:
    // one occurrence parses to a scalar, which `arrayOf` rejects as-is.
    const parsed = parser.parse('tags=a');

    expect(parsed).toEqual({ tags: 'a' });
    expect(isBakerIssueSet(arrayBaker.deserialize(ArrayQueryDto, parsed as Record<string, unknown>))).toBe(true);
  });
});

describe('single/multi ambiguity resolved by a field transform', () => {
  it('should accept a lone value by wrapping it into a 1-element array', () => {
    const parsed = parser.parse('tags=a');
    const result = coercingBaker.deserialize(CoercingTagsDto, parsed as Record<string, unknown>);

    expect(isBakerIssueSet(result)).toBe(false);
    expect(result).toEqual({ tags: ['a'] });
  });

  it('should pass a multi value through unchanged', () => {
    const parsed = parser.parse('tags=a&tags=b');
    const result = coercingBaker.deserialize(CoercingTagsDto, parsed as Record<string, unknown>);

    expect(isBakerIssueSet(result)).toBe(false);
    expect(result).toEqual({ tags: ['a', 'b'] });
  });

  it('should still validate elements after wrapping (the transform is not an escape hatch)', () => {
    // A non-string lone value is wrapped, then rejected by the element rule —
    // coercion fixes arity only, never weakens type validation.
    const result = coercingBaker.deserialize(CoercingTagsDto, { tags: 1 } as unknown as Record<string, unknown>);

    expect(isBakerIssueSet(result)).toBe(true);
  });
});
