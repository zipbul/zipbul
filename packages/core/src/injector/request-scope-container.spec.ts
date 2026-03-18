import { describe, it, expect, mock, beforeEach } from 'bun:test';

import type { ProviderRegistration, Token, ContainerValue } from './types';

/**
 * [OVERFLOW Checkpoint]
 * - Target: RequestScopeContainer
 * - Branch count: 10
 *   - get(): `if (!registration)` L23, `if (scope === 'singleton')` L27,
 *     `if (scope === 'transient')` L31, `if (requestInstances.has(token))` L35,
 *     else (create+cache) L39-43
 *   - dispose(): `if (hasOnDestroy(instance))` L81
 *   - hasOnDestroy(): `typeof instance === 'object'` L90, `instance !== null` L91,
 *     `'onDestroy' in instance` L92, `typeof ... === 'function'` L93
 * - Minimum per category: 50
 * - Categories:
 *   | Cat | Count | Sample (3+) |
 *   |-----|-------|-------------|
 *   | HP  | 50    | 1. get() returns parent.get() when registration is undefined (L23 `!registration`), 2. get() returns parent.get() when scope is singleton (L27-28), 3. get() calls factory(this) when scope is transient (L31-32), 4. get() creates and caches instance when scope is request and not cached (L39-43), 5. get() returns cached instance when scope is request and already cached (L35-36), 6. set() delegates to parent.set() (L47), 7. has() delegates to parent.has() (L50-51), 8. keys() delegates to parent.keys() (L54-55), 9. getInstances() returns request-scoped instances (L58-59), 10. getContextId() returns contextId (L68-69), ... |
 *   | NE  | 50    | 1. get() with unregistered token delegates to parent which may throw (L23-24), 2. dispose() skips non-object instance (L90 `typeof instance === 'object'`), 3. dispose() skips null instance (L91 `instance !== null`), ... |
 *   | ED  | 50    | 1. dispose() with zero request instances (L78 empty map), 2. getInstances() on empty container, 3. get() with symbol token for singleton scope (L27), ... |
 *   | CO  | 50    | 1. dispose() with mix of destroyable and non-destroyable instances (L81), 2. multiple transient gets + request gets in same container, 3. dispose() with null + object-without-onDestroy + object-with-onDestroy, ... |
 *   | ST  | 50    | 1. get() request-scoped → dispose() → get() again creates new instance (L86 clear + L39), 2. dispose() clears requestInstances map (L86), 3. get() caches then getInstances() returns it, ... |
 *   | CR  | N/A: RequestScopeContainer has no shared mutable state across threads; all methods operate on instance-local Map. No async get/set races possible in single-threaded JS. |
 *   | ID  | 50    | 1. get() same request-scoped token twice returns same instance (L35-36), 2. has() called multiple times returns same result (L50-51), 3. getContextId() called multiple times returns same value (L68-69), ... |
 *   | OR  | 50    | 1. dispose() calls onDestroy in reverse registration order (L78 .reverse()), 2. multiple request-scoped gets in different order still cache correctly (L35-43), 3. set() then get() uses parent delegation order (L47 + L20), ... |
 * - Total scenarios: 350
 */

/**
 * [PRUNE Checkpoint]
 * - Scenarios before: 350
 * - Removed: 316
 * - Key removals (5+):
 *   1. HP-4 through HP-50 all exercise same request-scope cache-miss branch (L39-43) with trivial value changes; keeping HP-4
 *   2. NE-4 through NE-50 all test same hasOnDestroy guard clauses with minor input variations; keeping NE-2,NE-3,NE-4,NE-5
 *   3. ED-4 through ED-50 boundary on token types — same delegation branch; keeping ED-1,ED-2,ED-3
 *   4. CO-4 through CO-50 same mixed-instance dispose pattern; keeping CO-1,CO-2
 *   5. ST-4 through ST-50 same dispose→re-get lifecycle; keeping ST-1,ST-2,ST-3
 *   6. ID-4 through ID-50 same idempotent get pattern; keeping ID-1,ID-2,ID-3
 *   7. OR-4 through OR-50 same reverse-order dispose pattern; keeping OR-1,OR-2,OR-3
 * - Final test count: 34
 * - Final test list:
 *   1.  [HP] get() delegates to parent.get() when registration is not found
 *   2.  [HP] get() delegates to parent.get() when scope is singleton
 *   3.  [HP] get() calls factory with self when scope is transient
 *   4.  [HP] get() creates instance via factory and caches it when scope is request and not yet cached
 *   5.  [HP] get() returns cached instance when scope is request and already cached
 *   6.  [HP] set() delegates to parent.set() with token and factory
 *   7.  [HP] has() delegates to parent.has()
 *   8.  [HP] keys() delegates to parent.keys()
 *   9.  [HP] getInstances() returns iterator of request-scoped instances
 *   10. [HP] getContextId() returns the contextId passed to constructor
 *   11. [HP] dispose() calls onDestroy on instances that have it
 *   12. [HP] dispose() clears requestInstances after calling onDestroy
 *   13. [NE] dispose() skips instance when typeof is not object (number)
 *   14. [NE] dispose() skips instance when value is null
 *   15. [NE] dispose() skips instance when object has no onDestroy property
 *   16. [NE] dispose() skips instance when onDestroy is not a function
 *   17. [ED] dispose() resolves immediately when no request instances exist
 *   18. [ED] getInstances() returns done iterator when no request instances exist
 *   19. [ED] get() with symbol token delegates to parent for singleton scope
 *   20. [CO] dispose() handles mix of destroyable and non-destroyable instances
 *   21. [CO] get() with multiple tokens of different scopes resolves each correctly
 *   22. [ST] get() creates new instance after dispose() clears cache
 *   23. [ST] dispose() clears the requestInstances map
 *   24. [ST] getInstances() reflects newly cached instances after get()
 *   25. [ID] get() returns same cached instance on repeated calls for request scope
 *   26. [ID] has() returns same result on repeated calls
 *   27. [ID] getContextId() returns same value on repeated calls
 *   28. [OR] dispose() calls onDestroy in reverse insertion order
 *   29. [OR] get() caches request-scoped instances regardless of call order
 *   30. [OR] dispose() processes all instances before clearing map
 *   31. [HP] get() returns new instance each time for transient scope (no caching)
 *   32. [NE] dispose() skips string instance
 *   33. [HP] dispose() awaits async onDestroy
 *   34. [ED] get() with request scope returns undefined from cache when factory returns undefined
 */

interface MockParent {
  getRegistration: ReturnType<typeof mock>;
  get: ReturnType<typeof mock>;
  set: ReturnType<typeof mock>;
  has: ReturnType<typeof mock>;
  keys: ReturnType<typeof mock>;
}

/**
 * Creates a mock parent Container with all required methods stubbed.
 *
 * @returns A mock parent container object
 */
function createMockParent(): MockParent {
  return {
    getRegistration: mock(() => undefined),
    get: mock(() => undefined),
    set: mock(() => undefined),
    has: mock(() => false),
    keys: mock(() => [][Symbol.iterator]()),
  };
}

/**
 * Creates a ProviderRegistration stub with the given scope and factory.
 *
 * @param scope - The provider scope
 * @param factory - The factory function
 * @returns A ProviderRegistration object
 */
function createRegistration(
  scope: ProviderRegistration['scope'],
  factory: ProviderRegistration['factory'],
): ProviderRegistration {
  return { scope, factory, visibleTo: 'module' };
}

const { RequestScopeContainer } = await import('./request-scope-container');

type RequestScopeContainerInstance = InstanceType<typeof RequestScopeContainer>;

describe('RequestScopeContainer', () => {
  const CONTEXT_ID = 'req-abc-123';
  let mockParent: MockParent;
  let container: RequestScopeContainerInstance;

  beforeEach(() => {
    mockParent = createMockParent();
    container = new RequestScopeContainer(mockParent as never, CONTEXT_ID);
  });

  // -- get --

  describe('get', () => {
    it('should delegate to parent.get when registration is not found', () => {
      // Arrange
      const token: Token = 'UnknownService';
      const parentValue = { name: 'from-parent' };
      mockParent.getRegistration.mockReturnValue(undefined);
      mockParent.get.mockReturnValue(parentValue);

      // Act
      const result = container.get(token);

      // Assert
      expect(mockParent.getRegistration).toHaveBeenCalledWith(token);
      expect(mockParent.get).toHaveBeenCalledWith(token);
      expect(result).toBe(parentValue);
    });

    it('should delegate to parent.get when scope is singleton', () => {
      // Arrange
      const token: Token = 'SingletonService';
      const singletonValue = { name: 'singleton' };
      const registration = createRegistration('singleton', mock(() => singletonValue));
      mockParent.getRegistration.mockReturnValue(registration);
      mockParent.get.mockReturnValue(singletonValue);

      // Act
      const result = container.get(token);

      // Assert
      expect(mockParent.get).toHaveBeenCalledWith(token);
      expect(result).toBe(singletonValue);
    });

    it('should call factory with self when scope is transient', () => {
      // Arrange
      const token: Token = 'TransientService';
      const transientValue = { name: 'transient' };
      const factory = mock(() => transientValue);
      const registration = createRegistration('transient', factory);
      mockParent.getRegistration.mockReturnValue(registration);

      // Act
      const result = container.get(token);

      // Assert
      expect(factory).toHaveBeenCalledTimes(1);
      expect(factory).toHaveBeenCalledWith(container);
      expect(result).toBe(transientValue);
    });

    it('should create instance via factory and cache it when scope is request and not yet cached', () => {
      // Arrange
      const token: Token = 'RequestService';
      const requestValue = { name: 'request' };
      const factory = mock(() => requestValue);
      const registration = createRegistration('request', factory);
      mockParent.getRegistration.mockReturnValue(registration);

      // Act
      const result = container.get(token);

      // Assert
      expect(factory).toHaveBeenCalledTimes(1);
      expect(factory).toHaveBeenCalledWith(container);
      expect(result).toBe(requestValue);
    });

    it('should return cached instance when scope is request and already cached', () => {
      // Arrange
      const token: Token = 'CachedRequestService';
      const requestValue = { name: 'cached-request' };
      const factory = mock(() => requestValue);
      const registration = createRegistration('request', factory);
      mockParent.getRegistration.mockReturnValue(registration);
      container.get(token);

      // Act
      const result = container.get(token);

      // Assert
      expect(factory).toHaveBeenCalledTimes(1);
      expect(result).toBe(requestValue);
    });

    it('should return new instance each time when scope is transient', () => {
      // Arrange
      const token: Token = 'TransientService';
      const factory = mock(() => ({ created: true }));
      const registration = createRegistration('transient', factory);
      mockParent.getRegistration.mockReturnValue(registration);

      // Act
      const first = container.get(token);
      const second = container.get(token);

      // Assert
      expect(first).not.toBe(second);
      expect(factory).toHaveBeenCalledTimes(2);
    });

    it('should delegate to parent for singleton scope when token is symbol', () => {
      // Arrange
      const token: Token = Symbol('SymbolSingleton');
      const value = { name: 'symbol-singleton' };
      const registration = createRegistration('singleton', mock(() => value));
      mockParent.getRegistration.mockReturnValue(registration);
      mockParent.get.mockReturnValue(value);

      // Act
      const result = container.get(token);

      // Assert
      expect(mockParent.get).toHaveBeenCalledWith(token);
      expect(result).toBe(value);
    });

    it('should return undefined from cache when factory returns undefined for request scope', () => {
      // Arrange
      const token: Token = 'UndefinedRequestService';
      const factory = mock(() => undefined);
      const registration = createRegistration('request', factory);
      mockParent.getRegistration.mockReturnValue(registration);

      // Act
      const first = container.get(token);
      const second = container.get(token);

      // Assert
      expect(first).toBeUndefined();
      expect(second).toBeUndefined();
      expect(factory).toHaveBeenCalledTimes(1);
    });
  });

  // -- set --

  describe('set', () => {
    it('should throw when attempting to register providers on request-scoped container', () => {
      // Arrange
      const token: Token = 'NewService';
      const factory = mock(() => ({ name: 'new' }));

      // Act & Assert
      expect(() => container.set(token, factory)).toThrow('Cannot register providers on a request-scoped container');
    });
  });

  // -- has --

  describe('has', () => {
    it('should delegate to parent.has and return its result', () => {
      // Arrange
      const token: Token = 'ExistingService';
      mockParent.has.mockReturnValue(true);

      // Act
      const result = container.has(token);

      // Assert
      expect(mockParent.has).toHaveBeenCalledWith(token);
      expect(result).toBe(true);
    });

    it('should return same result on repeated calls', () => {
      // Arrange
      const token: Token = 'StableService';
      mockParent.has.mockReturnValue(true);

      // Act
      const first = container.has(token);
      const second = container.has(token);

      // Assert
      expect(first).toBe(true);
      expect(second).toBe(true);
      expect(mockParent.has).toHaveBeenCalledTimes(2);
    });
  });

  // -- keys --

  describe('keys', () => {
    it('should delegate to parent.keys and return its iterator', () => {
      // Arrange
      const parentKeys: Token[] = ['ServiceA', 'ServiceB'];
      mockParent.keys.mockReturnValue(parentKeys[Symbol.iterator]());

      // Act
      const result = Array.from(container.keys());

      // Assert
      expect(mockParent.keys).toHaveBeenCalledTimes(1);
      expect(result).toEqual(['ServiceA', 'ServiceB']);
    });
  });

  // -- getInstances --

  describe('getInstances', () => {
    it('should return iterator of request-scoped instances', () => {
      // Arrange
      const tokenA: Token = 'RequestA';
      const tokenB: Token = 'RequestB';
      const valueA = { name: 'a' };
      const valueB = { name: 'b' };
      const registrationA = createRegistration('request', mock(() => valueA));
      const registrationB = createRegistration('request', mock(() => valueB));
      mockParent.getRegistration.mockImplementation((token: Token) => {
        if (token === tokenA) return registrationA;
        if (token === tokenB) return registrationB;
        return undefined;
      });
      container.get(tokenA);
      container.get(tokenB);

      // Act
      const instances = Array.from(container.getInstances());

      // Assert
      expect(instances).toContain(valueA);
      expect(instances).toContain(valueB);
      expect(instances).toHaveLength(2);
    });

    it('should return done iterator when no request instances exist', () => {
      // Act
      const instances = Array.from(container.getInstances());

      // Assert
      expect(instances).toEqual([]);
    });

    it('should reflect newly cached instances after get', () => {
      // Arrange
      const token: Token = 'DynamicService';
      const value = { name: 'dynamic' };
      const registration = createRegistration('request', mock(() => value));
      mockParent.getRegistration.mockReturnValue(registration);

      // Act
      const beforeGet = Array.from(container.getInstances());
      container.get(token);
      const afterGet = Array.from(container.getInstances());

      // Assert
      expect(beforeGet).toEqual([]);
      expect(afterGet).toEqual([value]);
    });
  });

  // -- getContextId --

  describe('getContextId', () => {
    it('should return the contextId passed to constructor', () => {
      // Act
      const result = container.getContextId();

      // Assert
      expect(result).toBe(CONTEXT_ID);
    });

    it('should return same value on repeated calls', () => {
      // Act
      const first = container.getContextId();
      const second = container.getContextId();
      const third = container.getContextId();

      // Assert
      expect(first).toBe(CONTEXT_ID);
      expect(second).toBe(CONTEXT_ID);
      expect(third).toBe(CONTEXT_ID);
    });
  });

  // -- dispose --

  describe('dispose', () => {
    it('should call onDestroy on instances that have it', async () => {
      // Arrange
      const token: Token = 'DestroyableService';
      const onDestroy = mock(() => undefined);
      const instance = { onDestroy };
      const registration = createRegistration('request', mock(() => instance));
      mockParent.getRegistration.mockReturnValue(registration);
      container.get(token);

      // Act
      await container.dispose();

      // Assert
      expect(onDestroy).toHaveBeenCalledTimes(1);
    });

    it('should clear requestInstances after calling onDestroy', async () => {
      // Arrange
      const token: Token = 'ClearableService';
      const instance = { onDestroy: mock(() => undefined) };
      const registration = createRegistration('request', mock(() => instance));
      mockParent.getRegistration.mockReturnValue(registration);
      container.get(token);

      // Act
      await container.dispose();

      // Assert
      const instances = Array.from(container.getInstances());
      expect(instances).toEqual([]);
    });

    it('should skip instance when typeof is not object', async () => {
      // Arrange
      const token: Token = 'NumberService';
      const registration = createRegistration('request', mock(() => 42 as ContainerValue));
      mockParent.getRegistration.mockReturnValue(registration);
      container.get(token);

      // Act & Assert — should not throw
      await expect(container.dispose()).resolves.toBeUndefined();
    });

    it('should skip instance when value is null', async () => {
      // Arrange
      const token: Token = 'NullService';
      const registration = createRegistration('request', mock(() => null as ContainerValue));
      mockParent.getRegistration.mockReturnValue(registration);
      container.get(token);

      // Act & Assert — should not throw
      await expect(container.dispose()).resolves.toBeUndefined();
    });

    it('should skip instance when object has no onDestroy property', async () => {
      // Arrange
      const token: Token = 'PlainService';
      const registration = createRegistration('request', mock(() => ({ name: 'no-destroy' })));
      mockParent.getRegistration.mockReturnValue(registration);
      container.get(token);

      // Act & Assert — should not throw
      await expect(container.dispose()).resolves.toBeUndefined();
    });

    it('should skip instance when onDestroy is not a function', async () => {
      // Arrange
      const token: Token = 'BadDestroyService';
      const registration = createRegistration(
        'request',
        mock(() => ({ onDestroy: 'not-a-function' }) as unknown as ContainerValue),
      );
      mockParent.getRegistration.mockReturnValue(registration);
      container.get(token);

      // Act & Assert — should not throw
      await expect(container.dispose()).resolves.toBeUndefined();
    });

    it('should skip string instance', async () => {
      // Arrange
      const token: Token = 'StringService';
      const registration = createRegistration('request', mock(() => 'hello' as ContainerValue));
      mockParent.getRegistration.mockReturnValue(registration);
      container.get(token);

      // Act & Assert — should not throw
      await expect(container.dispose()).resolves.toBeUndefined();
    });

    it('should resolve immediately when no request instances exist', async () => {
      // Act & Assert
      await expect(container.dispose()).resolves.toBeUndefined();
    });

    it('should handle mix of destroyable and non-destroyable instances', async () => {
      // Arrange
      const tokenA: Token = 'DestroyableA';
      const tokenB: Token = 'PlainB';
      const tokenC: Token = 'DestroyableC';
      const onDestroyA = mock(() => undefined);
      const onDestroyC = mock(() => undefined);
      const instanceA = { onDestroy: onDestroyA };
      const instanceB = { name: 'no-destroy' };
      const instanceC = { onDestroy: onDestroyC };
      const registrationA = createRegistration('request', mock(() => instanceA));
      const registrationB = createRegistration('request', mock(() => instanceB));
      const registrationC = createRegistration('request', mock(() => instanceC));
      mockParent.getRegistration.mockImplementation((token: Token) => {
        if (token === tokenA) return registrationA;
        if (token === tokenB) return registrationB;
        if (token === tokenC) return registrationC;
        return undefined;
      });
      container.get(tokenA);
      container.get(tokenB);
      container.get(tokenC);

      // Act
      await container.dispose();

      // Assert
      expect(onDestroyA).toHaveBeenCalledTimes(1);
      expect(onDestroyC).toHaveBeenCalledTimes(1);
    });

    it('should call onDestroy in reverse insertion order', async () => {
      // Arrange
      const callOrder: string[] = [];
      const tokenFirst: Token = 'First';
      const tokenSecond: Token = 'Second';
      const tokenThird: Token = 'Third';
      const instanceFirst = { onDestroy: mock(() => { callOrder.push('first'); }) };
      const instanceSecond = { onDestroy: mock(() => { callOrder.push('second'); }) };
      const instanceThird = { onDestroy: mock(() => { callOrder.push('third'); }) };
      const registrationFirst = createRegistration('request', mock(() => instanceFirst));
      const registrationSecond = createRegistration('request', mock(() => instanceSecond));
      const registrationThird = createRegistration('request', mock(() => instanceThird));
      mockParent.getRegistration.mockImplementation((token: Token) => {
        if (token === tokenFirst) return registrationFirst;
        if (token === tokenSecond) return registrationSecond;
        if (token === tokenThird) return registrationThird;
        return undefined;
      });
      container.get(tokenFirst);
      container.get(tokenSecond);
      container.get(tokenThird);

      // Act
      await container.dispose();

      // Assert
      expect(callOrder).toEqual(['third', 'second', 'first']);
    });

    it('should await async onDestroy', async () => {
      // Arrange
      const token: Token = 'AsyncDestroyService';
      let destroyed = false;
      const instance = {
        onDestroy: mock(async () => {
          await Promise.resolve();
          destroyed = true;
        }),
      };
      const registration = createRegistration('request', mock(() => instance));
      mockParent.getRegistration.mockReturnValue(registration);
      container.get(token);

      // Act
      await container.dispose();

      // Assert
      expect(destroyed).toBe(true);
      expect(instance.onDestroy).toHaveBeenCalledTimes(1);
    });

    it('should process all instances before clearing map', async () => {
      // Arrange
      const tokenA: Token = 'ServiceA';
      const tokenB: Token = 'ServiceB';
      const processedTokens: string[] = [];
      const instanceA = {
        onDestroy: mock(() => {
          processedTokens.push('A');
        }),
      };
      const instanceB = {
        onDestroy: mock(() => {
          processedTokens.push('B');
        }),
      };
      const registrationA = createRegistration('request', mock(() => instanceA));
      const registrationB = createRegistration('request', mock(() => instanceB));
      mockParent.getRegistration.mockImplementation((token: Token) => {
        if (token === tokenA) return registrationA;
        if (token === tokenB) return registrationB;
        return undefined;
      });
      container.get(tokenA);
      container.get(tokenB);

      // Act
      await container.dispose();

      // Assert
      expect(processedTokens).toHaveLength(2);
      const instancesAfterDispose = Array.from(container.getInstances());
      expect(instancesAfterDispose).toEqual([]);
    });
  });

  // -- state transition --

  describe('state transition', () => {
    it('should create new instance after dispose clears cache', async () => {
      // Arrange
      const token: Token = 'ReusableService';
      const firstValue = { version: 1 };
      const secondValue = { version: 2 };
      const factory = mock()
        .mockReturnValueOnce(firstValue)
        .mockReturnValueOnce(secondValue);
      const registration = createRegistration('request', factory);
      mockParent.getRegistration.mockReturnValue(registration);
      const firstResult = container.get(token);

      // Act
      await container.dispose();
      const secondResult = container.get(token);

      // Assert
      expect(firstResult).toBe(firstValue);
      expect(secondResult).toBe(secondValue);
      expect(factory).toHaveBeenCalledTimes(2);
    });

    it('should clear the requestInstances map after dispose', async () => {
      // Arrange
      const token: Token = 'DisposableService';
      const instance = { onDestroy: mock(() => undefined) };
      const registration = createRegistration('request', mock(() => instance));
      mockParent.getRegistration.mockReturnValue(registration);
      container.get(token);

      // Act
      await container.dispose();

      // Assert
      const instances = Array.from(container.getInstances());
      expect(instances).toEqual([]);
    });
  });

  // -- idempotency --

  describe('idempotency', () => {
    it('should return same cached instance on repeated calls for request scope', () => {
      // Arrange
      const token: Token = 'IdempotentRequest';
      const value = { name: 'idempotent' };
      const factory = mock(() => value);
      const registration = createRegistration('request', factory);
      mockParent.getRegistration.mockReturnValue(registration);

      // Act
      const first = container.get(token);
      const second = container.get(token);
      const third = container.get(token);

      // Assert
      expect(first).toBe(second);
      expect(second).toBe(third);
      expect(factory).toHaveBeenCalledTimes(1);
    });
  });

  // -- ordering --

  describe('ordering', () => {
    it('should cache request-scoped instances regardless of call order', () => {
      // Arrange
      const tokenA: Token = 'OrderA';
      const tokenB: Token = 'OrderB';
      const valueA = { name: 'a' };
      const valueB = { name: 'b' };
      const registrationA = createRegistration('request', mock(() => valueA));
      const registrationB = createRegistration('request', mock(() => valueB));
      mockParent.getRegistration.mockImplementation((token: Token) => {
        if (token === tokenA) return registrationA;
        if (token === tokenB) return registrationB;
        return undefined;
      });

      // Act — get B first, then A
      const resultB = container.get(tokenB);
      const resultA = container.get(tokenA);

      // Assert
      expect(resultA).toBe(valueA);
      expect(resultB).toBe(valueB);
      expect(container.get(tokenA)).toBe(valueA);
      expect(container.get(tokenB)).toBe(valueB);
    });
  });

  // -- corner: multiple scopes --

  describe('mixed scopes', () => {
    it('should resolve each token correctly when multiple tokens have different scopes', () => {
      // Arrange
      const singletonToken: Token = 'Singleton';
      const transientToken: Token = 'Transient';
      const requestToken: Token = 'Request';
      const singletonValue = { scope: 'singleton' };
      const transientValue = { scope: 'transient' };
      const requestValue = { scope: 'request' };
      const singletonRegistration = createRegistration('singleton', mock(() => singletonValue));
      const transientRegistration = createRegistration('transient', mock(() => transientValue));
      const requestRegistration = createRegistration('request', mock(() => requestValue));
      mockParent.getRegistration.mockImplementation((token: Token) => {
        if (token === singletonToken) return singletonRegistration;
        if (token === transientToken) return transientRegistration;
        if (token === requestToken) return requestRegistration;
        return undefined;
      });
      mockParent.get.mockReturnValue(singletonValue);

      // Act
      const singletonResult = container.get(singletonToken);
      const transientResult = container.get(transientToken);
      const requestResult = container.get(requestToken);

      // Assert
      expect(singletonResult).toBe(singletonValue);
      expect(mockParent.get).toHaveBeenCalledWith(singletonToken);
      expect(transientResult).toBe(transientValue);
      expect(requestResult).toBe(requestValue);
    });
  });
});
