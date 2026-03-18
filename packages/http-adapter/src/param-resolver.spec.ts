import { describe, it, expect } from 'bun:test';

import { __testing__ } from './param-resolver';

const { isDeserializableConstructor } = __testing__;

/**
 * [OVERFLOW Checkpoint]
 * - Target: isDeserializableConstructor
 * - Branch count: 2 (`typeof value === 'function'`, `value.prototype !== undefined`)
 * - Minimum per category: 10
 * - Categories:
 *   | Cat | Count | Sample (3+) |
 *   |-----|-------|-------------|
 *   | HP  | 10    | 1. class constructor (`param-resolver.ts#L163 typeof value === 'function' && value.prototype !== undefined`) 2. named function with prototype (`param-resolver.ts#L163 typeof value === 'function'`) 3. function expression with prototype (`param-resolver.ts#L163 value.prototype !== undefined`) |
 *   | NE  | 10    | 1. arrow function (no prototype) (`param-resolver.ts#L163 value.prototype !== undefined` → false) 2. null input (`param-resolver.ts#L163 typeof value === 'function'` → false) 3. undefined input (`param-resolver.ts#L163 typeof value === 'function'` → false) |
 *   | ED  | 10    | 1. primitive string (`param-resolver.ts#L163 typeof value === 'function'` → false) 2. primitive number 0 (`param-resolver.ts#L163 typeof value === 'function'` → false) 3. empty string (`param-resolver.ts#L163 typeof value === 'function'` → false) |
 *   | CO  | N/A: single-expression pure predicate with no combined boundary interactions |
 *   | ST  | N/A: stateless pure function with no lifecycle |
 *   | CR  | N/A: synchronous pure function with no shared state |
 *   | ID  | N/A: deterministic pure predicate, repeated calls always yield same result |
 *   | OR  | N/A: single-parameter function, no ordering concern |
 * - Total scenarios: 30
 */

/**
 * [PRUNE Checkpoint]
 * - Scenarios before: 30
 * - Removed: 24
 * - Key removals (5+):
 *   1. HP-2,HP-3,HP-4~HP-10 all exercise same `typeof === 'function' && prototype !== undefined` path as HP-1; keeping HP-1 (class) and HP-2 (named function) as distinct equivalence classes
 *   2. NE-4~NE-10 all exercise same `typeof !== 'function'` false branch as NE-2(null)/NE-3(undefined); removed as duplicates
 *   3. ED-2~ED-10 all exercise same `typeof !== 'function'` false branch as ED-1(primitive); keeping ED-1 only
 *   4. NE-1 (arrow function) is distinct: passes `typeof === 'function'` but fails `prototype !== undefined`; kept
 *   5. NE-2(null) and NE-3(undefined) are distinct equivalence classes of nullable input; both kept
 * - Final test count: 6
 * - Final test list:
 *   1. [HP] should return true for a class constructor
 *   2. [HP] should return true for a function with prototype
 *   3. [NE] should return false for an arrow function (no prototype)
 *   4. [NE] should return false for null
 *   5. [NE] should return false for undefined
 *   6. [ED] should return false for a primitive value
 */

describe('isDeserializableConstructor', () => {
  it('should return true for a class constructor', () => {
    class StubDto {
      readonly name: string = '';
    }

    const result = isDeserializableConstructor(StubDto);

    expect(result).toBe(true);
  });

  it('should return true for a function with prototype', () => {
    function StubConstructor() {}

    const result = isDeserializableConstructor(
      StubConstructor as unknown as new (...args: unknown[]) => unknown,
    );

    expect(result).toBe(true);
  });

  it('should return false for an arrow function (no prototype)', () => {
    const arrowFn = () => ({});

    const result = isDeserializableConstructor(
      arrowFn as unknown as new (...args: unknown[]) => unknown,
    );

    expect(result).toBe(false);
  });

  it('should return false for null', () => {
    const result = isDeserializableConstructor(
      null as unknown as new (...args: unknown[]) => unknown,
    );

    expect(result).toBe(false);
  });

  it('should return false for undefined', () => {
    const result = isDeserializableConstructor(
      undefined as unknown as new (...args: unknown[]) => unknown,
    );

    expect(result).toBe(false);
  });

  it('should return false for a primitive value', () => {
    const result = isDeserializableConstructor(
      42 as unknown as new (...args: unknown[]) => unknown,
    );

    expect(result).toBe(false);
  });
});
