import { describe, expect, it } from 'bun:test';

import { inject, lazy, runInInjectionContext } from './injection-context';
import type { ClassToken, Class, ZipbulValue } from '@zipbul/common';
import type { ZipbulContainer } from '@zipbul/common';

/*
 * [OVERFLOW Checkpoint]
 * - Target: inject, lazy, runInInjectionContext (helpers.ts)
 * - Branch count: 2 (inject: 1 conditional throw at helpers.ts#L51 `if (!container)`, lazy: 1 unconditional throw)
 * - Minimum per category: 10
 * - Categories:
 *   | Cat | Count | Sample (3+)                                                                                           |
 *   |-----|-------|-----------------------------------------------------------------------------------------------------------|
 *   | HP  | 10   | 1. inject resolves string token from active context (helpers.ts#L55 `container.get(token)`),              |
 *   |     |      |    2. inject resolves class token from active context (helpers.ts#L55),                                  |
 *   |     |      |    3. inject resolves symbol token from active context (helpers.ts#L55),                                 |
 *   |     |      |    4. inject resolves ClassToken from active context (helpers.ts#L55),                                   |
 *   |     |      |    5. inject resolves multiple different tokens from same context (helpers.ts#L55),                      |
 *   |     |      |    6. runInInjectionContext provides container scope (helpers.ts#L30 `injectionStore.run`),              |
 *   |     |      |    7. runInInjectionContext returns fn result (helpers.ts#L30),                                          |
 *   |     |      |    8. inject returns exact reference from container (helpers.ts#L55),                                    |
 *   |     |      |    9. inject works within nested runInInjectionContext (helpers.ts#L30 then #L55),                       |
 *   |     |      |    10. inject with generic type param returns typed value (helpers.ts#L47)                               |
 *   | NE  | 12   | 1. inject(string) throws when no context (helpers.ts#L51 `if (!container)`),                             |
 *   |     |      |    2. inject(symbol) throws when no context (helpers.ts#L51),                                            |
 *   |     |      |    3. inject(class) throws when no context (helpers.ts#L51),                                             |
 *   |     |      |    4. inject(ClassToken) throws when no context (helpers.ts#L51),                                        |
 *   |     |      |    5. inject(undefined as any) throws when no context (helpers.ts#L51),                                  |
 *   |     |      |    6. inject(null as any) throws when no context (helpers.ts#L51),                                       |
 *   |     |      |    7. inject throws outside runInInjectionContext (helpers.ts#L51),                                      |
 *   |     |      |    8. lazy(arrow fn) throws unconditionally (helpers.ts#L72 `throw new Error`),                          |
 *   |     |      |    9. lazy(function expr) throws (helpers.ts#L72),                                                       |
 *   |     |      |    10. lazy(class-returning fn) throws (helpers.ts#L72),                                                 |
 *   |     |      |    11. lazy(undefined as any) throws (helpers.ts#L72), 12. lazy(null as any) throws (helpers.ts#L72)     |
 *   | ED  | 10   | 1. inject exact error message match (helpers.ts#L52-53), 2. lazy exact error message match (helpers.ts#L72), |
 *   |     |      |    3. inject throws Error instance (helpers.ts#L52), 4. lazy throws Error instance (helpers.ts#L72),     |
 *   |     |      |    5. inject with empty string token (helpers.ts#L51), 6. inject with Symbol() no desc (helpers.ts#L51), |
 *   |     |      |    7. lazy with fn returning undefined (helpers.ts#L72), 8. lazy with fn returning null (helpers.ts#L72),|
 *   |     |      |    9. inject function.name is 'inject' (helpers.ts#L47), 10. lazy function.name is 'lazy' (helpers.ts#L71) |
 *   | CO  | N/A: inject has a single guard (`!container`); lazy is unconditional throw. No two boundaries to combine.       |
 *   | ST  | N/A: AsyncLocalStorage manages state. No manual lifecycle transitions.                                          |
 *   | CR  | N/A: AsyncLocalStorage guarantees async isolation. No concurrent access surface in tests.                        |
 *   | ID  | 10   | 1. inject(string) throws same message on repeated calls without context (helpers.ts#L51),                 |
 *   |     |      |    2. inject(symbol) throws same message on repeated calls (helpers.ts#L51),                              |
 *   |     |      |    3. inject(class) throws same message on repeated calls (helpers.ts#L51),                               |
 *   |     |      |    4. lazy(arrow fn) throws same message on repeated calls (helpers.ts#L72),                              |
 *   |     |      |    5. lazy(function expr) throws same message on repeated calls (helpers.ts#L72),                         |
 *   |     |      |    6. inject throws Error (not subclass) on repeated calls (helpers.ts#L51),                              |
 *   |     |      |    7. lazy throws Error (not subclass) on repeated calls (helpers.ts#L72),                                |
 *   |     |      |    8. inject(same token twice) identical error (helpers.ts#L51),                                          |
 *   |     |      |    9. lazy(same factory twice) identical error (helpers.ts#L72),                                          |
 *   |     |      |    10. inject resolves same value on repeated calls with context (helpers.ts#L55)                         |
 *   | OR  | N/A: Single-argument functions. Argument order is irrelevant.                                                   |
 * - Total scenarios: 42
 */

/*
 * [PRUNE Checkpoint]
 * - Scenarios before: 42
 * - Removed: 23
 * - Key removals (5+):
 *   1. NE-5,NE-6 (inject with undefined/null) exercise same `!container` guard as NE-1~4; keeping NE-1~4 which cover valid ProviderToken types
 *   2. NE-11,NE-12 (lazy with undefined/null) exercise same unconditional throw as NE-8~10; keeping NE-8~10 which cover valid factory patterns
 *   3. ED-5~ED-8 (empty string, Symbol() no desc, fn returning undefined/null) same throw path as NE equivalence classes; merged into existing NE tests
 *   4. ID-2~ID-5,ID-6~ID-9 duplicate the same idempotency pattern as ID-1,ID-4; keeping ID-1 for inject and one for lazy as representatives
 *   5. HP-2~HP-4,HP-8~HP-10 (class/symbol/ClassToken/reference/re-set/generic) exercise same `container.get(token)` path as HP-1; keeping HP-1 (resolve from context) and HP-5 (multiple tokens)
 *   6. HP-6,HP-7 (set/clear context) implicitly tested as setup/teardown in HP and NE-7 tests; no dedicated tests needed
 * - Final test count: 19
 * - Final test list:
 *   1. [NE] inject should throw when called with string token (no context)
 *   2. [NE] inject should throw when called with symbol token (no context)
 *   3. [NE] inject should throw when called with class constructor token (no context)
 *   4. [NE] inject should throw when called with ClassToken interface token (no context)
 *   5. [NE] lazy should throw when called with arrow function factory
 *   6. [NE] lazy should throw when called with function expression factory
 *   7. [NE] lazy should throw when called with class-returning factory
 *   8. [ED] inject should throw with exact error message when called outside injection context
 *   9. [ED] lazy should throw with exact AOT-only error message
 *   10. [ED] inject should throw an Error instance
 *   11. [ED] lazy should throw an Error instance
 *   12. [ED] inject should have function name 'inject'
 *   13. [ED] lazy should have function name 'lazy'
 *   14. [ED] inject should accept exactly one parameter
 *   15. [ID] inject should throw identical error on consecutive calls with same token
 *   16. [ID] lazy should throw identical error on consecutive calls with same factory
 *   17. [HP] runInInjectionContext + inject should resolve token from active injection context
 *   18. [NE] runInInjectionContext + inject should throw after injection context scope exits
 *   19. [HP] runInInjectionContext + inject should resolve different tokens from same context
 */

// -- Test fixtures --

class DummyService {}

class DummyClassToken {
  constructor(readonly value: ZipbulValue) {}
}

const createMockContainer = (values: Map<string, unknown>): ZipbulContainer => ({
  get(token: unknown) {
    const key = typeof token === 'string' ? token : String(token);
    const value = values.get(key);

    if (value === undefined) {
      throw new Error(`No provider for token: ${key}`);
    }

    return value;
  },
  set() {},
  has() { return false; },
  *getInstances() {},
  *keys() {},
});

describe('inject', () => {
  it('should throw when called with string token', () => {
    // Arrange
    const token = 'MyService';

    // Act & Assert
    expect(() => inject(token)).toThrow();
  });

  it('should throw when called with symbol token', () => {
    // Arrange
    const token = Symbol('MyService');

    // Act & Assert
    expect(() => inject(token)).toThrow();
  });

  it('should throw when called with class constructor token', () => {
    // Arrange
    const token: Class = DummyService;

    // Act & Assert
    expect(() => inject(token)).toThrow();
  });

  it('should throw when called with ClassToken interface token', () => {
    // Arrange
    const token: ClassToken = DummyClassToken;

    // Act & Assert
    expect(() => inject(token)).toThrow();
  });

  it('should throw with exact error message when called outside injection context', () => {
    // Arrange
    const expectedMessage = '[Zipbul DI] inject() must be called within a DI context.';

    // Act & Assert
    expect(() => inject('Token')).toThrow(expectedMessage);
  });

  it('should throw an Error instance', () => {
    // Arrange & Act
    let caughtError: unknown;
    try {
      inject('Token');
    } catch (error) {
      caughtError = error;
    }

    // Assert
    expect(caughtError).toBeInstanceOf(Error);
  });

  it('should have function name "inject"', () => {
    // Act & Assert
    expect(inject.name).toBe('inject');
  });

  it('should accept exactly one parameter', () => {
    // Act & Assert
    expect(inject.length).toBe(1);
  });

  it('should throw identical error on consecutive calls with same token', () => {
    // Arrange
    const token = 'RepeatedService';
    let firstMessage: string | undefined;
    let secondMessage: string | undefined;

    // Act
    try {
      inject(token);
    } catch (error) {
      firstMessage = error instanceof Error ? error.message : undefined;
    }
    try {
      inject(token);
    } catch (error) {
      secondMessage = error instanceof Error ? error.message : undefined;
    }

    // Assert
    expect(firstMessage).toBe(secondMessage);
  });
});

describe('runInInjectionContext + inject', () => {
  it('should resolve token from active injection context', () => {
    // Arrange
    const expected = { name: 'resolved' };
    const container = createMockContainer(new Map([['MyService', expected]]));

    // Act
    const result = runInInjectionContext(container, () => inject('MyService'));

    // Assert
    expect(result).toBe(expected);
  });

  it('should throw after injection context scope exits', () => {
    // Arrange
    const container = createMockContainer(new Map());
    runInInjectionContext(container, () => {});

    // Act & Assert
    expect(() => inject('Token')).toThrow('inject() must be called within a DI context');
  });

  it('should resolve different tokens from same context', () => {
    // Arrange
    const serviceA = { id: 'A' };
    const serviceB = { id: 'B' };
    const container = createMockContainer(new Map([['A', serviceA], ['B', serviceB]]));

    // Act
    const [resultA, resultB] = runInInjectionContext(container, () => [inject('A'), inject('B')]);

    // Assert
    expect(resultA).toBe(serviceA);
    expect(resultB).toBe(serviceB);
  });
});

describe('lazy', () => {
  it('should throw when called with arrow function factory', () => {
    // Arrange
    const factory = () => DummyService;

    // Act & Assert
    expect(() => lazy(factory)).toThrow();
  });

  it('should throw when called with function expression factory', () => {
    // Arrange
    const factory = function returnDummy() {
      return DummyService;
    };

    // Act & Assert
    expect(() => lazy(factory)).toThrow();
  });

  it('should throw when called with class-returning factory', () => {
    // Arrange
    const factory = () => DummyClassToken;

    // Act & Assert
    expect(() => lazy(factory)).toThrow();
  });

  it('should throw with exact AOT-only error message', () => {
    // Arrange
    const expectedMessage = '[Zipbul DI] lazy() is AOT-only and must not run at runtime.';

    // Act & Assert
    expect(() => lazy(() => DummyService)).toThrow(expectedMessage);
  });

  it('should throw an Error instance', () => {
    // Arrange & Act
    let caughtError: unknown;
    try {
      lazy(() => DummyService);
    } catch (error) {
      caughtError = error;
    }

    // Assert
    expect(caughtError).toBeInstanceOf(Error);
  });

  it('should have function name "lazy"', () => {
    // Act & Assert
    expect(lazy.name).toBe('lazy');
  });

  it('should throw identical error on consecutive calls with same factory', () => {
    // Arrange
    const factory = () => DummyService;
    let firstMessage: string | undefined;
    let secondMessage: string | undefined;

    // Act
    try {
      lazy(factory);
    } catch (error) {
      if (error instanceof Error) {
        firstMessage = error.message;
      }
    }
    try {
      lazy(factory);
    } catch (error) {
      if (error instanceof Error) {
        secondMessage = error.message;
      }
    }

    // Assert
    expect(firstMessage).toBe(secondMessage);
  });
});

// ── Nested runInInjectionContext ──────────────────────────

describe('nested runInInjectionContext', () => {
  it('should resolve from inner container within nested context', () => {
    // Arrange
    const outerValue = { id: 'outer' };
    const innerValue = { id: 'inner' };
    const outerContainer = createMockContainer(new Map([['Svc', outerValue]]));
    const innerContainer = createMockContainer(new Map([['Svc', innerValue]]));

    // Act & Assert
    runInInjectionContext(outerContainer, () => {
      expect(inject('Svc')).toBe(outerValue);

      runInInjectionContext(innerContainer, () => {
        expect(inject('Svc')).toBe(innerValue);
      });

      expect(inject('Svc')).toBe(outerValue);
    });
  });
});
