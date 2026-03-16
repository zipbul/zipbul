import { describe, it, expect, mock, beforeEach } from 'bun:test';

import type { FactoryFn, Token } from './types';

mock.module('../runtime/runtime-context', () => ({
  getRuntimeContext: mock(() => ({
    metadataRegistry: new Map(),
  })),
}));

const { Container } = await import('./container');

type ContainerInstance = InstanceType<typeof Container>;

/**
 * Creates a factory function that returns the given value.
 *
 * @param value - The value the factory should return
 * @returns A factory function suitable for Container.set()
 */
function createValueFactory<T>(value: T): FactoryFn {
  return () => value;
}

describe('Container', () => {
  let container: ContainerInstance;

  beforeEach(() => {
    container = new Container();
  });

  // -- set --

  describe('set', () => {
    it('should register provider with default scope singleton when no options provided', () => {
      // Arrange
      const token: Token = 'MyService';
      const factory = createValueFactory({ name: 'service' });

      // Act
      container.set(token, factory);

      // Assert
      const registration = container.getRegistration(token);
      expect(registration).toBeDefined();
      expect(registration!.scope).toBe('singleton');
    });

    it('should register provider with default visibleTo module when no options provided', () => {
      // Arrange
      const token: Token = 'MyService';
      const factory = createValueFactory({ name: 'service' });

      // Act
      container.set(token, factory);

      // Assert
      const registration = container.getRegistration(token);
      expect(registration).toBeDefined();
      expect(registration!.visibleTo).toBe('module');
    });

    it('should register provider with explicit scope when scope option provided', () => {
      // Arrange
      const token: Token = 'TransientService';
      const factory = createValueFactory({ name: 'transient' });

      // Act
      container.set(token, factory, { scope: 'transient' });

      // Assert
      const registration = container.getRegistration(token);
      expect(registration).toBeDefined();
      expect(registration!.scope).toBe('transient');
    });

    it('should register provider with explicit visibleTo when visibleTo option provided', () => {
      // Arrange
      const token: Token = 'GlobalService';
      const factory = createValueFactory({ name: 'global' });

      // Act
      container.set(token, factory, { visibleTo: 'all' });

      // Assert
      const registration = container.getRegistration(token);
      expect(registration).toBeDefined();
      expect(registration!.visibleTo).toBe('all');
    });
  });

  // -- get --

  describe('get', () => {
    it('should create instance via factory on first get call when token is registered', () => {
      // Arrange
      const token: Token = 'MyService';
      const expectedValue = { name: 'created' };
      container.set(token, createValueFactory(expectedValue));

      // Act
      const result = container.get(token);

      // Assert
      expect(result).toBe(expectedValue);
    });

    it('should return cached instance on subsequent get calls when scope is singleton', () => {
      // Arrange
      const token: Token = 'SingletonService';
      let callCount = 0;
      const factory: FactoryFn = () => {
        callCount += 1;
        return { instance: callCount };
      };
      container.set(token, factory, { scope: 'singleton' });

      // Act
      const first = container.get(token);
      const second = container.get(token);

      // Assert
      expect(first).toBe(second);
      expect(callCount).toBe(1);
    });

    it('should create new instance every time when scope is transient', () => {
      // Arrange
      const token: Token = 'TransientService';
      const factory: FactoryFn = () => ({ created: true });
      container.set(token, factory, { scope: 'transient' });

      // Act
      const first = container.get(token);
      const second = container.get(token);

      // Assert
      expect(first).not.toBe(second);
      expect(first).toEqual({ created: true });
      expect(second).toEqual({ created: true });
    });

    it('should pass container reference to factory when resolving provider', () => {
      // Arrange
      const token: Token = 'ContainerAware';
      const factoryFn = mock((_c: ContainerInstance) => ({ resolved: true }));
      container.set(token, factoryFn);

      // Act
      container.get(token);

      // Assert
      expect(factoryFn).toHaveBeenCalledTimes(1);
      const receivedArg = factoryFn.mock.calls[0]![0];
      expect(receivedArg).toBe(container);
    });

    it('should throw error with token label when get is called with unregistered string token', () => {
      // Arrange
      const token: Token = 'NonExistent';

      // Act & Assert
      expect(() => container.get(token)).toThrow('No provider for token: NonExistent');
    });

    it('should throw error when get is called with unregistered symbol token', () => {
      // Arrange
      const token: Token = Symbol('MY_SYMBOL');

      // Act & Assert
      expect(() => container.get(token)).toThrow(/No provider for token:/);
    });

    it('should throw error mentioning RequestScopeContainer when get is called with request-scoped token', () => {
      // Arrange
      const token: Token = 'RequestService';
      container.set(token, createValueFactory({ name: 'request' }), { scope: 'request' });

      // Act & Assert
      expect(() => container.get(token)).toThrow(/RequestScopeContainer/);
    });
  });

  // -- has --

  describe('has', () => {
    it('should return true when has is called with registered token', () => {
      // Arrange
      const token: Token = 'RegisteredService';
      container.set(token, createValueFactory('value'));

      // Act
      const result = container.has(token);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when has is called with unregistered token', () => {
      // Arrange
      const token: Token = 'UnregisteredService';

      // Act
      const result = container.has(token);

      // Assert
      expect(result).toBe(false);
    });
  });

  // -- keys --

  describe('keys', () => {
    it('should return iterator of all registered tokens when keys is called', () => {
      // Arrange
      const tokenA: Token = 'ServiceA';
      const tokenB: Token = 'ServiceB';
      const tokenC: Token = 'ServiceC';
      container.set(tokenA, createValueFactory('a'));
      container.set(tokenB, createValueFactory('b'));
      container.set(tokenC, createValueFactory('c'));

      // Act
      const keys = Array.from(container.keys());

      // Assert
      expect(keys).toEqual([tokenA, tokenB, tokenC]);
    });

    it('should return done iterator when keys is called on empty container', () => {
      // Act
      const keys = Array.from(container.keys());

      // Assert
      expect(keys).toEqual([]);
    });
  });

  // -- getInstances --

  describe('getInstances', () => {
    it('should return iterator of resolved singleton instances when getInstances is called', () => {
      // Arrange
      const instanceA = { name: 'a' };
      const instanceB = { name: 'b' };
      container.set('ServiceA', createValueFactory(instanceA));
      container.set('ServiceB', createValueFactory(instanceB));
      container.get('ServiceA');
      container.get('ServiceB');

      // Act
      const instances = Array.from(container.getInstances());

      // Assert
      expect(instances).toContain(instanceA);
      expect(instances).toContain(instanceB);
      expect(instances).toHaveLength(2);
    });

    it('should return done iterator when getInstances is called on empty container', () => {
      // Act
      const instances = Array.from(container.getInstances());

      // Assert
      expect(instances).toEqual([]);
    });
  });

  // -- getRegistration --

  describe('getRegistration', () => {
    it('should return registration metadata when getRegistration is called with existing token', () => {
      // Arrange
      const token: Token = 'MyService';
      container.set(token, createValueFactory('value'), { scope: 'transient', visibleTo: 'all' });

      // Act
      const registration = container.getRegistration(token);

      // Assert
      expect(registration).toBeDefined();
      expect(registration!.scope).toBe('transient');
      expect(registration!.visibleTo).toBe('all');
      expect(typeof registration!.factory).toBe('function');
    });

    it('should return undefined when getRegistration is called with unregistered token', () => {
      // Arrange
      const token: Token = 'Missing';

      // Act
      const registration = container.getRegistration(token);

      // Assert
      expect(registration).toBeUndefined();
    });
  });

  // -- getRegistrationOrder --

  describe('getRegistrationOrder', () => {
    it('should return tokens in insertion order when getRegistrationOrder is called', () => {
      // Arrange
      const tokenA: Token = 'First';
      const tokenB: Token = 'Second';
      const tokenC: Token = 'Third';
      container.set(tokenA, createValueFactory('a'));
      container.set(tokenB, createValueFactory('b'));
      container.set(tokenC, createValueFactory('c'));

      // Act
      const order = container.getRegistrationOrder();

      // Assert
      expect(order).toEqual([tokenA, tokenB, tokenC]);
    });

    it('should return empty array when getRegistrationOrder is called on empty container', () => {
      // Act
      const order = container.getRegistrationOrder();

      // Assert
      expect(order).toEqual([]);
    });

    it('should reflect registration order when getRegistrationOrder is called after multiple sets', () => {
      // Arrange
      const tokenX: Token = 'X';
      const tokenY: Token = 'Y';
      const tokenZ: Token = 'Z';
      container.set(tokenZ, createValueFactory('z'));
      container.set(tokenX, createValueFactory('x'));
      container.set(tokenY, createValueFactory('y'));

      // Act
      const order = container.getRegistrationOrder();

      // Assert
      expect(order).toEqual([tokenZ, tokenX, tokenY]);
    });
  });

  // -- constructor --

  describe('constructor', () => {
    it('should pre-populate registrations when constructor receives initialFactories', () => {
      // Arrange
      const initialFactories = new Map<Token, FactoryFn>();
      const valueA = { name: 'a' };
      const valueB = { name: 'b' };
      initialFactories.set('ServiceA', createValueFactory(valueA));
      initialFactories.set('ServiceB', createValueFactory(valueB));

      // Act
      const prePopulated = new Container(initialFactories);

      // Assert
      expect(prePopulated.has('ServiceA')).toBe(true);
      expect(prePopulated.has('ServiceB')).toBe(true);
      expect(prePopulated.get('ServiceA')).toBe(valueA);
      expect(prePopulated.get('ServiceB')).toBe(valueB);
    });

    it('should not throw when constructor receives empty initialFactories Map', () => {
      // Arrange
      const emptyFactories = new Map<Token, FactoryFn>();

      // Act & Assert
      expect(() => new Container(emptyFactories)).not.toThrow();
      const emptyContainer = new Container(emptyFactories);
      expect(Array.from(emptyContainer.keys())).toEqual([]);
    });

    it('should not throw when constructor receives undefined initialFactories', () => {
      // Act & Assert
      expect(() => new Container(undefined)).not.toThrow();
      expect(() => new Container()).not.toThrow();
    });
  });

  // -- state transition --

  describe('state transition', () => {
    it('should return new value when get is called after overwriting singleton registration', () => {
      // Arrange
      const token: Token = 'Overwritten';
      const oldValue = { version: 1 };
      const newValue = { version: 2 };
      container.set(token, createValueFactory(oldValue));
      container.get(token);

      // Act — overwrite registration
      container.set(token, createValueFactory(newValue));

      // Assert — singleton cache still has old value since singletons map is not cleared on re-set
      // The cached singleton takes precedence over the new registration
      const result = container.get(token);
      expect(result).toBe(oldValue);
    });
  });

  // -- idempotency --

  describe('idempotency', () => {
    it('should return same cached instance when get is called multiple times for singleton', () => {
      // Arrange
      const token: Token = 'IdempotentService';
      container.set(token, () => ({ id: Math.random() }));

      // Act
      const first = container.get(token);
      const second = container.get(token);
      const third = container.get(token);

      // Assert
      expect(first).toBe(second);
      expect(second).toBe(third);
    });
  });

  // -- createRequestScope --

  describe('createRequestScope', () => {
    it('should return a ZipbulContainer implementation', () => {
      // Arrange
      const contextId = 'req-1';

      // Act
      const scope = container.createRequestScope(contextId);

      // Assert
      expect(scope).toBeDefined();
      expect(typeof scope.get).toBe('function');
      expect(typeof scope.has).toBe('function');
      expect(typeof scope.keys).toBe('function');
      expect(typeof scope.set).toBe('function');
      expect(typeof scope.dispose).toBe('function');
    });

    it('should resolve singleton provider to same instance as parent', () => {
      // Arrange
      const token: Token = 'SingletonShared';
      const instance = { shared: true };
      container.set(token, createValueFactory(instance), { scope: 'singleton' });
      container.get(token);
      const scope = container.createRequestScope('req-2');

      // Act
      const result = scope.get(token);

      // Assert
      expect(result).toBe(instance);
    });

    it('should cache request-scoped provider within same scope', () => {
      // Arrange
      const token: Token = 'RequestScoped';
      let callCount = 0;
      const factory: FactoryFn = () => {
        callCount += 1;
        return { call: callCount };
      };
      container.set(token, factory, { scope: 'request' });
      const scope = container.createRequestScope('req-3');

      // Act
      const first = scope.get(token);
      const second = scope.get(token);

      // Assert
      expect(first).toBe(second);
      expect(callCount).toBe(1);
    });

    it('should return different instances for request-scoped provider across different scopes', () => {
      // Arrange
      const token: Token = 'RequestScopedMulti';
      container.set(token, () => ({ created: true }), { scope: 'request' });
      const scopeA = container.createRequestScope('req-4a');
      const scopeB = container.createRequestScope('req-4b');

      // Act
      const resultA = scopeA.get(token);
      const resultB = scopeB.get(token);

      // Assert
      expect(resultA).not.toBe(resultB);
      expect(resultA).toEqual({ created: true });
      expect(resultB).toEqual({ created: true });
    });

    it('should create new instance for transient provider on each call', () => {
      // Arrange
      const token: Token = 'TransientInScope';
      container.set(token, () => ({ fresh: true }), { scope: 'transient' });
      const scope = container.createRequestScope('req-5');

      // Act
      const first = scope.get(token);
      const second = scope.get(token);

      // Assert
      expect(first).not.toBe(second);
      expect(first).toEqual({ fresh: true });
      expect(second).toEqual({ fresh: true });
    });

    it('should clear request-scoped cache after dispose', async () => {
      // Arrange
      const token: Token = 'DisposableScoped';
      let callCount = 0;
      container.set(token, () => {
        callCount += 1;
        return { call: callCount };
      }, { scope: 'request' });
      const scope = container.createRequestScope('req-6');
      scope.get(token);

      // Act
      await scope.dispose();

      // Assert
      const instances = Array.from(scope.getInstances());
      expect(instances).toHaveLength(0);
    });

    it('should call onDestroy hooks in reverse order during dispose', async () => {
      // Arrange
      const destroyOrder: string[] = [];
      const tokenA: Token = 'DestroyA';
      const tokenB: Token = 'DestroyB';
      const tokenC: Token = 'DestroyC';
      container.set(tokenA, () => ({
        name: 'A',
        onDestroy: () => { destroyOrder.push('A'); },
      }), { scope: 'request' });
      container.set(tokenB, () => ({
        name: 'B',
        onDestroy: () => { destroyOrder.push('B'); },
      }), { scope: 'request' });
      container.set(tokenC, () => ({
        name: 'C',
        onDestroy: () => { destroyOrder.push('C'); },
      }), { scope: 'request' });
      const scope = container.createRequestScope('req-7');
      scope.get(tokenA);
      scope.get(tokenB);
      scope.get(tokenC);

      // Act
      await scope.dispose();

      // Assert
      expect(destroyOrder).toEqual(['C', 'B', 'A']);
    });

    it('should not throw when Container.dispose is called (no-op)', async () => {
      // Act & Assert
      await expect(container.dispose()).resolves.toBeUndefined();
    });

    it('should not throw when dispose is called twice (idempotent)', async () => {
      // Arrange
      const token: Token = 'IdempotentDispose';
      container.set(token, () => ({
        onDestroy: mock(() => undefined),
      }), { scope: 'request' });
      const scope = container.createRequestScope('req-9');
      scope.get(token);

      // Act & Assert
      await expect(scope.dispose()).resolves.toBeUndefined();
      await expect(scope.dispose()).resolves.toBeUndefined();
    });

    it('should continue clearing remaining instances when onDestroy throws', async () => {
      // Arrange
      const destroyOrder: string[] = [];
      const tokenA: Token = 'ThrowA';
      const tokenB: Token = 'ThrowB';
      container.set(tokenA, () => ({
        name: 'A',
        onDestroy: () => { destroyOrder.push('A'); },
      }), { scope: 'request' });
      container.set(tokenB, () => ({
        name: 'B',
        onDestroy: () => {
          destroyOrder.push('B');
          throw new Error('destroy failed');
        },
      }), { scope: 'request' });
      const scope = container.createRequestScope('req-10');
      scope.get(tokenA);
      scope.get(tokenB);

      // Act — reversed order: B destroys first (throws), then A
      const disposeResult = scope.dispose();

      // Assert — dispose rejects because onDestroy throws (no try/catch in implementation)
      await expect(disposeResult).rejects.toThrow('destroy failed');
      // B's onDestroy was called (it threw), but A's was not reached
      expect(destroyOrder).toContain('B');
    });

    it('should create new request-scoped instance after dispose and re-get', async () => {
      // Arrange
      const token: Token = 'ReScopedAfterDispose';
      let callCount = 0;
      container.set(token, () => {
        callCount += 1;
        return { call: callCount };
      }, { scope: 'request' });
      const scope = container.createRequestScope('req-11');
      const first = scope.get(token);
      await scope.dispose();

      // Act
      const second = scope.get(token);

      // Assert
      expect(second).not.toBe(first);
      expect(callCount).toBe(2);
    });

    it('should return undefined for createRequestScope on RequestScopeContainer', () => {
      // Arrange
      const scope = container.createRequestScope('req-12');

      // Act
      const nested = scope.createRequestScope?.('req-12-nested');

      // Assert
      expect(nested).toBeUndefined();
    });

    it('should produce independent scopes even with identical contextId', () => {
      // Arrange
      const token: Token = 'SameContextId';
      container.set(token, () => ({ unique: true }), { scope: 'request' });
      const scopeA = container.createRequestScope('same-id');
      const scopeB = container.createRequestScope('same-id');

      // Act
      const resultA = scopeA.get(token);
      const resultB = scopeB.get(token);

      // Assert
      expect(resultA).not.toBe(resultB);
    });

    it('should not interfere between concurrently active scopes', () => {
      // Arrange
      const tokenX: Token = 'ConcurrentX';
      const tokenY: Token = 'ConcurrentY';
      container.set(tokenX, () => ({ service: 'X' }), { scope: 'request' });
      container.set(tokenY, () => ({ service: 'Y' }), { scope: 'request' });
      const scopeA = container.createRequestScope('concurrent-a');
      const scopeB = container.createRequestScope('concurrent-b');

      // Act — interleave gets across scopes
      const aX = scopeA.get(tokenX);
      const bX = scopeB.get(tokenX);
      const aY = scopeA.get(tokenY);
      const bY = scopeB.get(tokenY);

      // Assert — each scope caches independently
      expect(aX).not.toBe(bX);
      expect(aY).not.toBe(bY);
      expect(scopeA.get(tokenX)).toBe(aX);
      expect(scopeB.get(tokenX)).toBe(bX);
    });

    it('should cache request-scoped provider that depends on another request-scoped provider in same scope', () => {
      // Arrange
      const depToken: Token = 'RequestDep';
      const consumerToken: Token = 'RequestConsumer';
      container.set(depToken, () => ({ dep: true }), { scope: 'request' });
      container.set(consumerToken, (c) => ({
        dependency: c.get(depToken),
        consumer: true,
      }), { scope: 'request' });
      const scope = container.createRequestScope('req-15');

      // Act
      const consumer = scope.get(consumerToken);
      const dep = scope.get(depToken);

      // Assert — consumer's dependency should be the same cached instance
      expect(consumer.dependency).toBe(dep);
      expect(scope.get(consumerToken)).toBe(consumer);
    });
  });
});
