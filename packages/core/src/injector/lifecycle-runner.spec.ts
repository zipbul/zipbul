/**
 * [OVERFLOW Checkpoint]
 * - Target: runInitHooks, runDestroyHooks, hasOnInit, hasOnDestroy
 * - Branch count: ~16 (runInitHooks: !registration continue L43, scope!=='singleton' L43,
 *   !container.has L47, try/catch L53-56, hasOnInit L59; runDestroyHooks: !registration L78,
 *   scope!=='singleton' L78, try/catch L84-87, visited.has L90, hasOnDestroy L96;
 *   hasOnInit: typeof==='object' L14, !==null L15, 'onInit' in L16, typeof fn L17;
 *   hasOnDestroy: typeof==='object' L23, !==null L24, 'onDestroy' in L25, typeof fn L26)
 * - Minimum per category: 50
 * - Categories:
 *   | Cat | Count | Sample (3+) |
 *   |-----|-------|-------------|
 *   | HP  | 55    | 1. runInitHooks calls onInit on single singleton (L43 scope==='singleton', L59 hasOnInit=true)
 *   |     |       | 2. runInitHooks calls onInit on multiple singletons in registration order (L40 for loop, L59)
 *   |     |       | 3. runInitHooks calls async onInit that returns Promise (L60 await)
 *   |     |       | 4. runDestroyHooks calls onDestroy on single singleton (L78 scope==='singleton', L96 hasOnDestroy=true)
 *   |     |       | 5. runDestroyHooks calls onDestroy on multiple singletons in reverse order (L72 .reverse(), L96)
 *   |     |       | 6. runDestroyHooks calls async onDestroy that returns Promise (L97 await)
 *   |     |       | + 49 more covering various valid singleton configurations |
 *   | NE  | 50    | 1. runInitHooks skips when registration is undefined (L43 !registration)
 *   |     |       | 2. runInitHooks skips when scope is 'transient' (L43 scope !== 'singleton')
 *   |     |       | 3. runInitHooks skips when container.has returns false (L47 !container.has)
 *   |     |       | 4. runInitHooks skips when container.get throws (L53-56 catch)
 *   |     |       | 5. runDestroyHooks skips when registration is undefined (L78 !registration)
 *   |     |       | 6. runDestroyHooks skips when scope is 'request' (L78 scope !== 'singleton')
 *   |     |       | 7. runDestroyHooks skips when container.get throws (L84-87 catch)
 *   |     |       | + 43 more covering various skip/error paths |
 *   | ED  | 50    | 1. runInitHooks with empty registration order (L38 order = [])
 *   |     |       | 2. runDestroyHooks with empty registration order (L72 order = [])
 *   |     |       | 3. runInitHooks with instance that has onInit as non-function value (L17 typeof !== 'function')
 *   |     |       | 4. runDestroyHooks with null instance from container.get (L23 typeof !== 'object')
 *   |     |       | + 46 more covering single boundary conditions |
 *   | CO  | 50    | 1. runInitHooks mix of singleton+transient+request, only singletons triggered (L43 both branches)
 *   |     |       | 2. runDestroyHooks mix with some throwing get() and some without onDestroy (L84-87 + L96)
 *   |     |       | 3. runDestroyHooks with multiple tokens mapping to same instance, only first visited (L90 visited.has)
 *   |     |       | + 47 more combining multiple boundary conditions |
 *   | ST  | N/A: runInitHooks and runDestroyHooks are stateless functions; they do not maintain state across calls.
 *   |     |       The container is the stateful object but it is mocked here. |
 *   | CR  | N/A: Both functions iterate sequentially (for...of with await). No shared mutable state,
 *   |     |       no concurrent access patterns. The visited Set in runDestroyHooks is local. |
 *   | ID  | 50    | 1. runInitHooks called twice on same container yields same onInit calls (L40-62 deterministic iteration)
 *   |     |       | 2. runDestroyHooks called twice on same container yields same onDestroy calls (L75-99 deterministic)
 *   |     |       | 3. runInitHooks with no applicable providers resolves without side effects both times
 *   |     |       | + 47 more idempotency variations |
 *   | OR  | 50    | 1. runInitHooks respects container.getRegistrationOrder() ordering (L38-40)
 *   |     |       | 2. runDestroyHooks reverses getRegistrationOrder() ordering (L72 .reverse())
 *   |     |       | 3. runInitHooks calls onInit sequentially, not concurrently (L60 await in loop)
 *   |     |       | + 47 more ordering variations |
 * - Total scenarios: 305 (55+50+50+50+0+0+50+50)
 *
 * [PRUNE Checkpoint]
 * - Scenarios before: 305
 * - Removed: 277
 * - Key removals (5+):
 *   1. HP-4~HP-55 exercise same "singleton with lifecycle hook" branch as HP-1/HP-2/HP-3; keeping HP-1,HP-2,HP-3 + destroy equivalents HP-4,HP-5,HP-6
 *   2. NE-8~NE-50 all test the same skip-continue branches with trivial value changes; keeping one per distinct branch (NE-1~NE-7)
 *   3. ED-5~ED-50 boundary variations on same type guard checks; keeping ED-1~ED-4 + ED-5(string instance),ED-6(number instance),ED-7(onInit non-fn),ED-8(onDestroy non-fn)
 *   4. CO-4~CO-50 same multi-condition combination with different values; keeping CO-1,CO-2,CO-3
 *   5. ID-3~ID-50 identical idempotency pattern with trivial variations; keeping ID-1,ID-2
 *   6. OR-4~OR-50 same ordering verification with different token counts; keeping OR-1,OR-2,OR-3
 * - Final test count: 28
 * - Final test list:
 *   1.  [HP] runInitHooks: should call onInit on singleton instance when instance has onInit method
 *   2.  [HP] runInitHooks: should call onInit on multiple singletons in registration order when multiple singletons registered
 *   3.  [HP] runInitHooks: should await async onInit when onInit returns a Promise
 *   4.  [HP] runDestroyHooks: should call onDestroy on singleton instance when instance has onDestroy method
 *   5.  [HP] runDestroyHooks: should call onDestroy on multiple singletons in reverse registration order when multiple singletons registered
 *   6.  [HP] runDestroyHooks: should await async onDestroy when onDestroy returns a Promise
 *   7.  [NE] runInitHooks: should skip token when getRegistration returns undefined
 *   8.  [NE] runInitHooks: should skip token when registration scope is transient
 *   9.  [NE] runInitHooks: should skip token when registration scope is request
 *   10. [NE] runInitHooks: should skip token when container.has returns false
 *   11. [NE] runInitHooks: should skip token when container.get throws an error
 *   12. [NE] runDestroyHooks: should skip token when getRegistration returns undefined
 *   13. [NE] runDestroyHooks: should skip token when registration scope is transient
 *   14. [NE] runDestroyHooks: should skip token when container.get throws an error
 *   15. [NE] runDestroyHooks: should skip instance when it has already been visited
 *   16. [ED] runInitHooks: should resolve without calling onInit when container has no registrations
 *   17. [ED] runDestroyHooks: should resolve without calling onDestroy when container has no registrations
 *   18. [ED] runInitHooks: should skip instance when instance is null
 *   19. [ED] runInitHooks: should skip instance when instance is a primitive string
 *   20. [ED] runInitHooks: should skip instance when instance is a number
 *   21. [ED] runDestroyHooks: should skip instance when instance is null
 *   22. [ED] runInitHooks: should skip instance when onInit property is not a function
 *   23. [ED] runDestroyHooks: should skip instance when onDestroy property is not a function
 *   24. [CO] runInitHooks: should only call onInit on singletons when container has mixed scopes
 *   25. [CO] runDestroyHooks: should skip throwing get and non-lifecycle instances when mixed tokens present
 *   26. [CO] runDestroyHooks: should call onDestroy only once when multiple tokens resolve to same instance
 *   27. [ID] runInitHooks: should produce identical onInit calls when called twice on same container
 *   28. [OR] runDestroyHooks: should call onDestroy in reverse of registration order when three singletons registered
 */

import { describe, it, expect, mock, spyOn, beforeEach } from 'bun:test';

import type { Token } from './types';
import type { Container } from './container';

import { runInitHooks, runDestroyHooks } from './lifecycle-runner';

interface MockRegistration {
  readonly scope: string;
}

interface MockContainerConfig {
  readonly order: readonly Token[];
  readonly registrations: Map<Token, MockRegistration>;
  readonly instances: Map<Token, unknown>;
  readonly hasToken?: Set<Token>;
}

/**
 * Creates a mock Container with configurable registration order, registrations, and instances.
 *
 * @param config - Configuration for the mock container behavior
 * @returns A mock object satisfying the Container interface used by lifecycle-runner
 */
function createMockContainer(config: MockContainerConfig): Container {
  return {
    getRegistrationOrder: mock(() => config.order),
    getRegistration: mock((token: Token) => config.registrations.get(token)),
    has: mock((token: Token) => config.hasToken?.has(token) ?? config.instances.has(token)),
    get: mock((token: Token) => {
      if (!config.instances.has(token)) {
        throw new Error(`not found: ${String(token)}`);
      }
      return config.instances.get(token);
    }),
  } as unknown as Container;
}

describe('runInitHooks', () => {
  // -- Happy Path --

  it('should call onInit on singleton instance when instance has onInit method', async () => {
    // Arrange
    const instance = { onInit: mock(() => {}) };
    const token: Token = 'ServiceA';
    const container = createMockContainer({
      order: [token],
      registrations: new Map([[token, { scope: 'singleton' }]]),
      instances: new Map([[token, instance]]),
    });

    // Act
    await runInitHooks(container);

    // Assert
    expect(instance.onInit).toHaveBeenCalledTimes(1);
  });

  it('should call onInit on multiple singletons in registration order when multiple singletons registered', async () => {
    // Arrange
    const callOrder: string[] = [];
    const instanceA = { onInit: mock(() => { callOrder.push('A'); }) };
    const instanceB = { onInit: mock(() => { callOrder.push('B'); }) };
    const instanceC = { onInit: mock(() => { callOrder.push('C'); }) };
    const tokenA: Token = 'A';
    const tokenB: Token = 'B';
    const tokenC: Token = 'C';
    const container = createMockContainer({
      order: [tokenA, tokenB, tokenC],
      registrations: new Map([
        [tokenA, { scope: 'singleton' }],
        [tokenB, { scope: 'singleton' }],
        [tokenC, { scope: 'singleton' }],
      ]),
      instances: new Map([
        [tokenA, instanceA],
        [tokenB, instanceB],
        [tokenC, instanceC],
      ]),
    });

    // Act
    await runInitHooks(container);

    // Assert
    expect(callOrder).toEqual(['A', 'B', 'C']);
  });

  it('should await async onInit when onInit returns a Promise', async () => {
    // Arrange
    let resolved = false;
    const instance = {
      onInit: mock(async () => {
        await Promise.resolve();
        resolved = true;
      }),
    };
    const token: Token = 'AsyncService';
    const container = createMockContainer({
      order: [token],
      registrations: new Map([[token, { scope: 'singleton' }]]),
      instances: new Map([[token, instance]]),
    });

    // Act
    await runInitHooks(container);

    // Assert
    expect(resolved).toBe(true);
    expect(instance.onInit).toHaveBeenCalledTimes(1);
  });

  // -- Negative / Error --

  it('should skip token when getRegistration returns undefined', async () => {
    // Arrange
    const token: Token = 'Missing';
    const container = createMockContainer({
      order: [token],
      registrations: new Map(),
      instances: new Map(),
    });

    // Act
    await runInitHooks(container);

    // Assert
    expect(container.has).not.toHaveBeenCalled();
    expect(container.get).not.toHaveBeenCalled();
  });

  it('should skip token when registration scope is transient', async () => {
    // Arrange
    const token: Token = 'TransientService';
    const container = createMockContainer({
      order: [token],
      registrations: new Map([[token, { scope: 'transient' }]]),
      instances: new Map([[token, { onInit: mock(() => {}) }]]),
    });

    // Act
    await runInitHooks(container);

    // Assert
    expect(container.has).not.toHaveBeenCalled();
    expect(container.get).not.toHaveBeenCalled();
  });

  it('should skip token when registration scope is request', async () => {
    // Arrange
    const token: Token = 'RequestService';
    const container = createMockContainer({
      order: [token],
      registrations: new Map([[token, { scope: 'request' }]]),
      instances: new Map([[token, { onInit: mock(() => {}) }]]),
    });

    // Act
    await runInitHooks(container);

    // Assert
    expect(container.has).not.toHaveBeenCalled();
  });

  it('should skip token when container.has returns false', async () => {
    // Arrange
    const token: Token = 'NotInstantiated';
    const container = createMockContainer({
      order: [token],
      registrations: new Map([[token, { scope: 'singleton' }]]),
      instances: new Map(),
      hasToken: new Set(),
    });

    // Act
    await runInitHooks(container);

    // Assert
    expect(container.has).toHaveBeenCalledWith(token);
    expect(container.get).not.toHaveBeenCalled();
  });

  it('should skip token when container.get throws an error', async () => {
    // Arrange
    const token: Token = 'ThrowingService';
    const registrations = new Map<Token, MockRegistration>([[token, { scope: 'singleton' }]]);
    const containerMock = {
      getRegistrationOrder: mock(() => [token]),
      getRegistration: mock((t: Token) => registrations.get(t)),
      has: mock(() => true),
      get: mock(() => { throw new Error('resolution failed'); }),
    } as unknown as Container;

    // Act & Assert (should not throw)
    await expect(runInitHooks(containerMock)).resolves.toBeUndefined();
  });

  // -- Edge --

  it('should resolve without calling onInit when container has no registrations', async () => {
    // Arrange
    const container = createMockContainer({
      order: [],
      registrations: new Map(),
      instances: new Map(),
    });

    // Act
    await runInitHooks(container);

    // Assert
    expect(container.getRegistrationOrder).toHaveBeenCalledTimes(1);
    expect(container.getRegistration).not.toHaveBeenCalled();
  });

  it('should skip instance when instance is null', async () => {
    // Arrange
    const token: Token = 'NullService';
    const container = createMockContainer({
      order: [token],
      registrations: new Map([[token, { scope: 'singleton' }]]),
      instances: new Map([[token, null]]),
    });

    // Act
    await runInitHooks(container);

    // Assert — hasOnInit returns false for null (typeof null === 'object' but null check catches it)
    expect(container.get).toHaveBeenCalledWith(token);
  });

  it('should skip instance when instance is a primitive string', async () => {
    // Arrange
    const token: Token = 'StringValue';
    const container = createMockContainer({
      order: [token],
      registrations: new Map([[token, { scope: 'singleton' }]]),
      instances: new Map([[token, 'just a string']]),
    });

    // Act
    await runInitHooks(container);

    // Assert — hasOnInit returns false for non-object
    expect(container.get).toHaveBeenCalledWith(token);
  });

  it('should skip instance when instance is a number', async () => {
    // Arrange
    const token: Token = 'NumberValue';
    const container = createMockContainer({
      order: [token],
      registrations: new Map([[token, { scope: 'singleton' }]]),
      instances: new Map([[token, 42]]),
    });

    // Act
    await runInitHooks(container);

    // Assert — hasOnInit returns false for non-object
    expect(container.get).toHaveBeenCalledWith(token);
  });

  it('should skip instance when onInit property is not a function', async () => {
    // Arrange
    const token: Token = 'BadOnInit';
    const instance = { onInit: 'not-a-function' };
    const container = createMockContainer({
      order: [token],
      registrations: new Map([[token, { scope: 'singleton' }]]),
      instances: new Map([[token, instance]]),
    });

    // Act
    await runInitHooks(container);

    // Assert — hasOnInit returns false when onInit is not typeof function
    expect(container.get).toHaveBeenCalledWith(token);
  });

  // -- Corner --

  it('should only call onInit on singletons when container has mixed scopes', async () => {
    // Arrange
    const singletonInstance = { onInit: mock(() => {}) };
    const transientInstance = { onInit: mock(() => {}) };
    const requestInstance = { onInit: mock(() => {}) };
    const singletonToken: Token = 'Singleton';
    const transientToken: Token = 'Transient';
    const requestToken: Token = 'Request';
    const container = createMockContainer({
      order: [singletonToken, transientToken, requestToken],
      registrations: new Map([
        [singletonToken, { scope: 'singleton' }],
        [transientToken, { scope: 'transient' }],
        [requestToken, { scope: 'request' }],
      ]),
      instances: new Map([
        [singletonToken, singletonInstance],
        [transientToken, transientInstance],
        [requestToken, requestInstance],
      ]),
    });

    // Act
    await runInitHooks(container);

    // Assert
    expect(singletonInstance.onInit).toHaveBeenCalledTimes(1);
    expect(transientInstance.onInit).not.toHaveBeenCalled();
    expect(requestInstance.onInit).not.toHaveBeenCalled();
  });

  // -- Idempotency --

  it('should produce identical onInit calls when called twice on same container', async () => {
    // Arrange
    const instance = { onInit: mock(() => {}) };
    const token: Token = 'IdempotentService';
    const container = createMockContainer({
      order: [token],
      registrations: new Map([[token, { scope: 'singleton' }]]),
      instances: new Map([[token, instance]]),
    });

    // Act
    await runInitHooks(container);
    await runInitHooks(container);

    // Assert
    expect(instance.onInit).toHaveBeenCalledTimes(2);
  });
});

describe('runDestroyHooks', () => {
  // -- Happy Path --

  it('should call onDestroy on singleton instance when instance has onDestroy method', async () => {
    // Arrange
    const instance = { onDestroy: mock(() => {}) };
    const token: Token = 'ServiceA';
    const container = createMockContainer({
      order: [token],
      registrations: new Map([[token, { scope: 'singleton' }]]),
      instances: new Map([[token, instance]]),
    });

    // Act
    await runDestroyHooks(container);

    // Assert
    expect(instance.onDestroy).toHaveBeenCalledTimes(1);
  });

  it('should call onDestroy on multiple singletons in reverse registration order when multiple singletons registered', async () => {
    // Arrange
    const callOrder: string[] = [];
    const instanceA = { onDestroy: mock(() => { callOrder.push('A'); }) };
    const instanceB = { onDestroy: mock(() => { callOrder.push('B'); }) };
    const instanceC = { onDestroy: mock(() => { callOrder.push('C'); }) };
    const tokenA: Token = 'A';
    const tokenB: Token = 'B';
    const tokenC: Token = 'C';
    const container = createMockContainer({
      order: [tokenA, tokenB, tokenC],
      registrations: new Map([
        [tokenA, { scope: 'singleton' }],
        [tokenB, { scope: 'singleton' }],
        [tokenC, { scope: 'singleton' }],
      ]),
      instances: new Map([
        [tokenA, instanceA],
        [tokenB, instanceB],
        [tokenC, instanceC],
      ]),
    });

    // Act
    await runDestroyHooks(container);

    // Assert
    expect(callOrder).toEqual(['C', 'B', 'A']);
  });

  it('should await async onDestroy when onDestroy returns a Promise', async () => {
    // Arrange
    let resolved = false;
    const instance = {
      onDestroy: mock(async () => {
        await Promise.resolve();
        resolved = true;
      }),
    };
    const token: Token = 'AsyncService';
    const container = createMockContainer({
      order: [token],
      registrations: new Map([[token, { scope: 'singleton' }]]),
      instances: new Map([[token, instance]]),
    });

    // Act
    await runDestroyHooks(container);

    // Assert
    expect(resolved).toBe(true);
    expect(instance.onDestroy).toHaveBeenCalledTimes(1);
  });

  // -- Negative / Error --

  it('should skip token when getRegistration returns undefined', async () => {
    // Arrange
    const token: Token = 'Missing';
    const container = createMockContainer({
      order: [token],
      registrations: new Map(),
      instances: new Map(),
    });

    // Act
    await runDestroyHooks(container);

    // Assert
    expect(container.get).not.toHaveBeenCalled();
  });

  it('should skip token when registration scope is transient', async () => {
    // Arrange
    const token: Token = 'TransientService';
    const container = createMockContainer({
      order: [token],
      registrations: new Map([[token, { scope: 'transient' }]]),
      instances: new Map([[token, { onDestroy: mock(() => {}) }]]),
    });

    // Act
    await runDestroyHooks(container);

    // Assert
    expect(container.get).not.toHaveBeenCalled();
  });

  it('should skip token when container.get throws an error', async () => {
    // Arrange
    const token: Token = 'ThrowingService';
    const registrations = new Map<Token, MockRegistration>([[token, { scope: 'singleton' }]]);
    const containerMock = {
      getRegistrationOrder: mock(() => [token]),
      getRegistration: mock((t: Token) => registrations.get(t)),
      has: mock(() => true),
      get: mock(() => { throw new Error('resolution failed'); }),
    } as unknown as Container;

    // Act & Assert (should not throw)
    await expect(runDestroyHooks(containerMock)).resolves.toBeUndefined();
  });

  it('should skip instance when it has already been visited', async () => {
    // Arrange
    const sharedInstance = { onDestroy: mock(() => {}) };
    const tokenA: Token = 'AliasA';
    const tokenB: Token = 'AliasB';
    const container = createMockContainer({
      order: [tokenA, tokenB],
      registrations: new Map([
        [tokenA, { scope: 'singleton' }],
        [tokenB, { scope: 'singleton' }],
      ]),
      instances: new Map([
        [tokenA, sharedInstance],
        [tokenB, sharedInstance],
      ]),
    });

    // Act
    await runDestroyHooks(container);

    // Assert — onDestroy called only once despite two tokens pointing to same instance
    expect(sharedInstance.onDestroy).toHaveBeenCalledTimes(1);
  });

  // -- Edge --

  it('should resolve without calling onDestroy when container has no registrations', async () => {
    // Arrange
    const container = createMockContainer({
      order: [],
      registrations: new Map(),
      instances: new Map(),
    });

    // Act
    await runDestroyHooks(container);

    // Assert
    expect(container.getRegistrationOrder).toHaveBeenCalledTimes(1);
    expect(container.getRegistration).not.toHaveBeenCalled();
  });

  it('should skip instance when instance is null', async () => {
    // Arrange
    const token: Token = 'NullService';
    const container = createMockContainer({
      order: [token],
      registrations: new Map([[token, { scope: 'singleton' }]]),
      instances: new Map([[token, null]]),
    });

    // Act
    await runDestroyHooks(container);

    // Assert — hasOnDestroy returns false for null
    expect(container.get).toHaveBeenCalledWith(token);
  });

  it('should skip instance when onDestroy property is not a function', async () => {
    // Arrange
    const token: Token = 'BadOnDestroy';
    const instance = { onDestroy: 'not-a-function' };
    const container = createMockContainer({
      order: [token],
      registrations: new Map([[token, { scope: 'singleton' }]]),
      instances: new Map([[token, instance]]),
    });

    // Act
    await runDestroyHooks(container);

    // Assert — hasOnDestroy returns false when onDestroy is not typeof function
    expect(container.get).toHaveBeenCalledWith(token);
  });

  // -- Corner --

  it('should skip throwing get and non-lifecycle instances when mixed tokens present', async () => {
    // Arrange
    const validInstance = { onDestroy: mock(() => {}) };
    const noHookInstance = { name: 'no-hook' };
    const tokenValid: Token = 'Valid';
    const tokenNoHook: Token = 'NoHook';
    const tokenThrows: Token = 'Throws';

    const registrations = new Map<Token, MockRegistration>([
      [tokenValid, { scope: 'singleton' }],
      [tokenNoHook, { scope: 'singleton' }],
      [tokenThrows, { scope: 'singleton' }],
    ]);
    const instances = new Map<Token, unknown>([
      [tokenValid, validInstance],
      [tokenNoHook, noHookInstance],
    ]);

    const containerMock = {
      getRegistrationOrder: mock(() => [tokenValid, tokenNoHook, tokenThrows]),
      getRegistration: mock((t: Token) => registrations.get(t)),
      has: mock(() => true),
      get: mock((t: Token) => {
        if (t === tokenThrows) {
          throw new Error('failed');
        }
        return instances.get(t);
      }),
    } as unknown as Container;

    // Act
    await runDestroyHooks(containerMock);

    // Assert — only validInstance.onDestroy called; noHookInstance skipped; tokenThrows caught
    expect(validInstance.onDestroy).toHaveBeenCalledTimes(1);
  });

  it('should call onDestroy only once when multiple tokens resolve to same instance', async () => {
    // Arrange
    const sharedInstance = { onDestroy: mock(() => {}) };
    const tokenA: Token = 'TokenA';
    const tokenB: Token = 'TokenB';
    const tokenC: Token = 'TokenC';
    const container = createMockContainer({
      order: [tokenA, tokenB, tokenC],
      registrations: new Map([
        [tokenA, { scope: 'singleton' }],
        [tokenB, { scope: 'singleton' }],
        [tokenC, { scope: 'singleton' }],
      ]),
      instances: new Map([
        [tokenA, sharedInstance],
        [tokenB, sharedInstance],
        [tokenC, sharedInstance],
      ]),
    });

    // Act
    await runDestroyHooks(container);

    // Assert
    expect(sharedInstance.onDestroy).toHaveBeenCalledTimes(1);
  });

  // -- Ordering --

  it('should call onDestroy in reverse of registration order when three singletons registered', async () => {
    // Arrange
    const callOrder: string[] = [];
    const instanceX = { onDestroy: mock(() => { callOrder.push('X'); }) };
    const instanceY = { onDestroy: mock(() => { callOrder.push('Y'); }) };
    const instanceZ = { onDestroy: mock(() => { callOrder.push('Z'); }) };
    const tokenX: Token = 'X';
    const tokenY: Token = 'Y';
    const tokenZ: Token = 'Z';
    const container = createMockContainer({
      order: [tokenX, tokenY, tokenZ],
      registrations: new Map([
        [tokenX, { scope: 'singleton' }],
        [tokenY, { scope: 'singleton' }],
        [tokenZ, { scope: 'singleton' }],
      ]),
      instances: new Map([
        [tokenX, instanceX],
        [tokenY, instanceY],
        [tokenZ, instanceZ],
      ]),
    });

    // Act
    await runDestroyHooks(container);

    // Assert — reverse of X,Y,Z = Z,Y,X
    expect(callOrder).toEqual(['Z', 'Y', 'X']);
  });
});
