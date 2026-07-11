import { describe, it, expect } from 'bun:test';
import type { AdapterContext, ContextKey, MiddlewareDefinition, ZipbulContainer } from '@zipbul/common';
import { defineMiddleware, augmentRawKey } from '@zipbul/common';

import { Adapter } from './adapter';

class AugmentTestAdapter extends Adapter {
  static override readonly validPhases: ReadonlySet<string> = new Set(['phaseA', 'phaseB']);
  override readonly decorators = { controller: () => {}, handlers: [] };

  readonly requestProto: Record<string, unknown> = {};

  protected emergencyTeardown(): void {}
  protected async executePipeline(): Promise<void> {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  protected override namespacePrototypes(): Readonly<Record<string, object>> {
    return { request: this.requestProto };
  }

  resolveDefs(definitions: readonly MiddlewareDefinition[], container: ZipbulContainer) {
    return this.resolveMiddlewareDefs(definitions, container);
  }

  registry() {
    return this.getAugmentAccessorRegistry();
  }
}

function createContext(): AdapterContext {
  const store = new Map<symbol, unknown>();

  return {
    getType: () => 'test',
    get<T>(key: ContextKey<T>): T | undefined {
      return store.get(key as symbol) as T | undefined;
    },
    set<T>(key: ContextKey<T>, value: T): void { store.set(key as symbol, value); },
    use<T>(key: ContextKey<T>): T {
      const value = store.get(key as symbol);
      if (value === undefined) throw new Error(`Context key not set: ${String(key)}`);
      return value as T;
    },
    to<TContext>(): TContext {
      throw new Error('unsupported');
    },
  };
}

function createMockContainer(): ZipbulContainer {
  return {
    get: () => undefined,
    set: () => {},
    has: () => false,
    getInstances: () => [][Symbol.iterator](),
    keys: () => [][Symbol.iterator](),
  } as unknown as ZipbulContainer;
}

describe('Adapter augments — supply composition', () => {
  it('should set the raw slot from a validatedAccessor supply before the factory handler runs', async () => {
    // Arrange
    const adapter = new AugmentTestAdapter();
    const seen: unknown[] = [];
    const def = defineMiddleware({
      adapters: [AugmentTestAdapter],
      augments: { request: { getQuery: () => ({ q: '1' }) } },
      factory: () => (ctx) => {
        seen.push(ctx.get(augmentRawKey('request', 'getQuery')));
      },
    });
    const ctx = createContext();

    // Act
    const [resolved] = adapter.resolveDefs([def], createMockContainer());
    await resolved!.handler(ctx);

    // Assert
    expect(seen).toEqual([{ q: '1' }]);
  });

  it('should not wrap handlers of definitions without augments', async () => {
    // Arrange
    const adapter = new AugmentTestAdapter();
    const handler = () => undefined;
    const def = defineMiddleware(() => handler);

    // Act
    const [resolved] = adapter.resolveDefs([def], createMockContainer());

    // Assert
    expect(resolved!.handler).toBe(handler);
  });

  it('should propagate the factory handler result through the composed handler', async () => {
    // Arrange
    const adapter = new AugmentTestAdapter();
    const def = defineMiddleware({
      adapters: [AugmentTestAdapter],
      augments: { request: { getQuery: () => ({}) } },
      factory: () => () => undefined,
    });

    // Act
    const [resolved] = adapter.resolveDefs([def], createMockContainer());
    const result = await resolved!.handler(createContext());

    // Assert
    expect(result).toBeUndefined();
  });
});

describe('Adapter augments — accessor installation', () => {
  it('should install a prototype accessor for every augment on the namespace prototype', () => {
    // Arrange
    const adapter = new AugmentTestAdapter();
    const def = defineMiddleware({
      adapters: [AugmentTestAdapter],
      augments: {
        request: {
          getQuery: () => ({}),
          extra: () => 1,
        },
      },
    });

    // Act
    adapter.resolveDefs([def], createMockContainer());

    // Assert
    expect('getQuery' in adapter.requestProto).toBe(true);
    expect('extra' in adapter.requestProto).toBe(true);
  });

  it('should throw when an augment targets a namespace the adapter does not declare', () => {
    // Arrange
    const adapter = new AugmentTestAdapter();
    const def = defineMiddleware({
      adapters: [AugmentTestAdapter],
      augments: { response: { getMeta: () => ({}) } },
    });

    // Act & Assert
    expect(() => adapter.resolveDefs([def], createMockContainer())).toThrow(
      "adapter declares no context namespace 'response'",
    );
  });
});

describe('Adapter augments — applyConfig', () => {
  it('should store the augmentAccessors registry from the config slice', () => {
    // Arrange
    const adapter = new AugmentTestAdapter();
    const entries = [{ namespace: 'request', prop: 'getQuery', kind: 'validated-accessor' as const }];

    // Act
    adapter.applyConfig({ augmentAccessors: entries });

    // Assert
    expect(adapter.registry()).toEqual(entries);
  });

  it('should return an empty registry when no augmentAccessors were applied', () => {
    // Arrange
    const adapter = new AugmentTestAdapter();

    // Act & Assert
    expect(adapter.registry()).toEqual([]);
  });

  it('should throw when two global middleware declare the same ns.prop', () => {
    // Arrange
    const adapter = new AugmentTestAdapter();
    const make = () => defineMiddleware({
      adapters: [AugmentTestAdapter],
      augments: { request: { getQuery: () => ({}) } },
    });

    // Act & Assert
    expect(() => adapter.applyConfig({
      middlewares: { phaseA: [make()], phaseB: [make()] },
    })).toThrow("Duplicate context augment 'request.getQuery'");
  });

  it('should accept distinct ns.prop augments across global phases', () => {
    // Arrange
    const adapter = new AugmentTestAdapter();
    const defA = defineMiddleware({
      adapters: [AugmentTestAdapter],
      augments: { request: { getQuery: () => ({}) } },
    });
    const defB = defineMiddleware({
      adapters: [AugmentTestAdapter],
      augments: { request: { other: () => 1 } },
    });

    // Act & Assert
    expect(() => adapter.applyConfig({ middlewares: { phaseA: [defA], phaseB: [defB] } })).not.toThrow();
  });
});
