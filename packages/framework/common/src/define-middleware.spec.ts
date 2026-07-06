import { describe, it, expect } from 'bun:test';
import type { AdapterContext } from './interfaces';
import type { AdapterClass } from './adapter/types';
import { Adapter } from '@zipbul/core';
import { contextKey, type ContextKey } from './context-key';
import { defineMiddleware } from './define-middleware';

class FakeAdapterA extends Adapter {
  static override readonly validPhases: ReadonlySet<string> = new Set();
  override readonly decorators = { controller: () => {}, handlers: [] };
  protected emergencyTeardown() {}
  protected async executePipeline() { return undefined as never; }
  async start() {}
  async stop() {}
}

class FakeAdapterB extends Adapter {
  static override readonly validPhases: ReadonlySet<string> = new Set();
  override readonly decorators = { controller: () => {}, handlers: [] };
  protected emergencyTeardown() {}
  protected async executePipeline() { return undefined as never; }
  async start() {}
  async stop() {}
}

function noopHandler(_ctx: AdapterContext) {}
const noopFactory = () => noopHandler;

describe('defineMiddleware', () => {
  // ── Factory-only overload ───────────────────────────────────

  it('should return a MiddlewareDefinition with factory when called with factory only', () => {
    // Arrange & Act
    const def = defineMiddleware(noopFactory);

    // Assert
    expect(def.factory).toBe(noopFactory);
  });

  it('should not set adapters when called with factory only', () => {
    // Arrange & Act
    const def = defineMiddleware(noopFactory);

    // Assert
    expect(def.adapters).toBeUndefined();
  });

  it('should return a frozen object when called with factory only', () => {
    // Arrange & Act
    const def = defineMiddleware(noopFactory);

    // Assert
    expect(Object.isFrozen(def)).toBe(true);
  });

  // ── Adapter + factory overload ──────────────────────────────

  it('should return a MiddlewareDefinition with factory and adapters when called with adapters and factory', () => {
    // Arrange
    const adapters: readonly AdapterClass[] = [FakeAdapterA];

    // Act
    const def = defineMiddleware(adapters, noopFactory);

    // Assert
    expect(def.factory).toBe(noopFactory);
    expect(def.adapters).toEqual([FakeAdapterA]);
  });

  it('should freeze the adapters array', () => {
    // Arrange & Act
    const def = defineMiddleware([FakeAdapterA, FakeAdapterB], noopFactory);

    // Assert
    expect(Object.isFrozen(def.adapters)).toBe(true);
  });

  it('should return a frozen definition when called with adapters and factory', () => {
    // Arrange & Act
    const def = defineMiddleware([FakeAdapterA], noopFactory);

    // Assert
    expect(Object.isFrozen(def)).toBe(true);
  });

  it('should create a defensive copy of adapters array', () => {
    // Arrange
    const adapters: AdapterClass[] = [FakeAdapterA];

    // Act
    const def = defineMiddleware(adapters, noopFactory);
    adapters.push(FakeAdapterB);

    // Assert
    expect(def.adapters).toHaveLength(1);
    expect(def.adapters).toEqual([FakeAdapterA]);
  });

  it('should support multiple adapter classes', () => {
    // Arrange & Act
    const def = defineMiddleware([FakeAdapterA, FakeAdapterB], noopFactory);

    // Assert
    expect(def.adapters).toEqual([FakeAdapterA, FakeAdapterB]);
  });

  it('should accept empty adapters array', () => {
    // Arrange & Act
    const def = defineMiddleware([], noopFactory);

    // Assert
    expect(def.adapters).toEqual([]);
    expect(def.factory).toBe(noopFactory);
  });

  // ── Error cases ────────────────────────────────────────────

  it('should throw when adapters are provided without factory', () => {
    // Arrange & Act & Assert
    expect(() => defineMiddleware([FakeAdapterA], undefined as never)).toThrow(
      'Factory function is required when adapters are specified.',
    );
  });

  // ── Config object overload ────────────────────────────────

  it('should accept a config object with factory only', () => {
    // Arrange & Act
    const def = defineMiddleware({ factory: noopFactory });

    // Assert
    expect(def.factory).toBe(noopFactory);
    expect(def.adapters).toBeUndefined();
    expect(def.provides).toBeUndefined();
  });

  it('should return a frozen object from config overload', () => {
    // Arrange & Act
    const def = defineMiddleware({ factory: noopFactory });

    // Assert
    expect(Object.isFrozen(def)).toBe(true);
  });

  it('should accept a config object with adapters', () => {
    // Arrange & Act
    const def = defineMiddleware({
      adapters: [FakeAdapterA],
      factory: noopFactory,
    });

    // Assert
    expect(def.factory).toBe(noopFactory);
    expect(def.adapters).toEqual([FakeAdapterA]);
    expect(Object.isFrozen(def.adapters)).toBe(true);
  });

  it('should accept a config object with provides', () => {
    // Arrange
    const keyA = contextKey<string>('test.a');
    const keyB = contextKey<number>('test.b');

    // Act
    const def = defineMiddleware({
      provides: [keyA, keyB],
      factory: noopFactory,
    });

    // Assert
    expect(def.provides).toEqual([keyA, keyB]);
    expect(Object.isFrozen(def.provides)).toBe(true);
  });

  it('should create a defensive copy of provides array', () => {
    // Arrange
    const keyA = contextKey<string>('test.a');
    const keyB = contextKey<number>('test.b');
    const provides: ContextKey<unknown>[] = [keyA];

    // Act
    const def = defineMiddleware({ provides, factory: noopFactory });
    provides.push(keyB);

    // Assert
    expect(def.provides).toHaveLength(1);
    expect(def.provides).toEqual([keyA]);
  });

  it('should accept a config object with adapters and provides', () => {
    // Arrange
    const key = contextKey<string>('test.key');

    // Act
    const def = defineMiddleware({
      adapters: [FakeAdapterA, FakeAdapterB],
      provides: [key],
      factory: noopFactory,
    });

    // Assert
    expect(def.factory).toBe(noopFactory);
    expect(def.adapters).toEqual([FakeAdapterA, FakeAdapterB]);
    expect(def.provides).toEqual([key]);
  });

  it('should create a defensive copy of adapters in config overload', () => {
    // Arrange
    const adapters: AdapterClass[] = [FakeAdapterA];

    // Act
    const def = defineMiddleware({ adapters, factory: noopFactory });
    adapters.push(FakeAdapterB);

    // Assert
    expect(def.adapters).toHaveLength(1);
    expect(def.adapters).toEqual([FakeAdapterA]);
  });

  it('should freeze adapters in config overload', () => {
    // Arrange & Act
    const def = defineMiddleware({
      adapters: [FakeAdapterA],
      factory: noopFactory,
    });

    // Assert
    expect(Object.isFrozen(def.adapters)).toBe(true);
  });

  // ── Augments slot ──────────────────────────────────────────

  it('should carry a normalized augment on the definition when provided with a factory', () => {
    // Arrange
    const supply = (_ctx: AdapterContext) => ({ q: '1' });

    // Act
    const def = defineMiddleware({
      adapters: [FakeAdapterA],
      augments: { request: { getQuery: supply } },
      factory: noopFactory,
    });

    // Assert
    expect(def.augments?.request?.getQuery?.kind).toBe('validated-accessor');
  });

  it('should synthesize a noop factory for an augments-only config', () => {
    // Arrange
    const supply = (_ctx: AdapterContext) => 'value';

    // Act
    const def = defineMiddleware({
      adapters: [FakeAdapterA],
      augments: { request: { extra: supply } },
    });

    // Assert
    expect(typeof def.factory).toBe('function');
    expect(def.factory()({} as AdapterContext)).toBeUndefined();
  });

  it('should freeze augments namespaces defensively', () => {
    // Arrange
    const supply = (_ctx: AdapterContext) => 'value';
    const props: Record<string, typeof supply> = { extra: supply };

    // Act
    const def = defineMiddleware({
      adapters: [FakeAdapterA],
      augments: { request: props },
      factory: noopFactory,
    });
    props.later = supply;

    // Assert
    expect(Object.isFrozen(def.augments)).toBe(true);
    expect(Object.isFrozen(def.augments?.request)).toBe(true);
    expect(Object.keys(def.augments?.request ?? {})).toEqual(['extra']);
  });

  it('should throw when augments are provided without adapters', () => {
    // Arrange
    const supply = (_ctx: AdapterContext) => 'value';

    // Act & Assert
    expect(() => defineMiddleware({ augments: { request: { extra: supply } } })).toThrow(
      'Middleware augments require a non-empty adapters array.',
    );
  });

  it('should throw when augments are provided with an empty adapters array', () => {
    // Arrange
    const supply = (_ctx: AdapterContext) => 'value';

    // Act & Assert
    expect(() => defineMiddleware({ adapters: [], augments: { request: { extra: supply } } })).toThrow(
      'Middleware augments require a non-empty adapters array.',
    );
  });

  it('should normalize a bare supply function to a validated-accessor spec', () => {
    // Arrange
    const supply = (_ctx: AdapterContext) => ({ q: '1' });

    // Act
    const def = defineMiddleware({
      adapters: [FakeAdapterA],
      augments: { request: { getQuery: supply } },
      factory: noopFactory,
    });

    // Assert
    expect(def.augments?.request?.getQuery?.kind).toBe('validated-accessor');
  });

  it('should preserve the original function as the normalized spec supply', () => {
    // Arrange
    const supply = (_ctx: AdapterContext) => ({ q: '1' });

    // Act
    const def = defineMiddleware({
      adapters: [FakeAdapterA],
      augments: { request: { getQuery: supply } },
      factory: noopFactory,
    });
    const normalized = def.augments?.request?.getQuery as { supply: (ctx: AdapterContext) => unknown };

    // Assert — the SAME function, not a wrapper that merely reproduces the value.
    expect(normalized.supply).toBe(supply);
  });

  it('should freeze the spec normalized from a bare supply function', () => {
    // Arrange
    const supply = (_ctx: AdapterContext) => ({ q: '1' });

    // Act
    const def = defineMiddleware({
      adapters: [FakeAdapterA],
      augments: { request: { getQuery: supply } },
      factory: noopFactory,
    });

    // Assert
    expect(Object.isFrozen(def.augments?.request?.getQuery)).toBe(true);
  });

  it('should throw when a bare supply function is async', () => {
    // Arrange — an async arrow is the most natural mistake in the bare form;
    // it would ship a Promise into baker validation. Reject at define time.
    const supply = async (_ctx: AdapterContext) => ({ q: '1' });

    // Act & Assert
    expect(() =>
      defineMiddleware({
        adapters: [FakeAdapterA],
        augments: { request: { getQuery: supply as never } },
      }),
    ).toThrow(/synchronous|async/i);
  });

  it('should throw when a bare supply function is a generator', () => {
    // Arrange — a generator carries tag [object GeneratorFunction], a distinct
    // non-plain-function partition from AsyncFunction; the guard must reject the
    // whole family, not just async.
    const supply = function* (_ctx: AdapterContext) { yield {}; };

    // Act & Assert
    expect(() =>
      defineMiddleware({
        adapters: [FakeAdapterA],
        augments: { request: { getQuery: supply as never } },
      }),
    ).toThrow(/synchronous|generator|async/i);
  });

  it('should throw when a bare supply function is an async generator', () => {
    // Arrange — async generators carry the THIRD non-plain tag
    // [object AsyncGeneratorFunction]; a 2-branch blacklist (async + generator)
    // would leak it. Forces the runtime guard to whitelist [object Function] only.
    const supply = async function* (_ctx: AdapterContext) { yield {}; };

    // Act & Assert
    expect(() =>
      defineMiddleware({
        adapters: [FakeAdapterA],
        augments: { request: { getQuery: supply as never } },
      }),
    ).toThrow(/synchronous|generator|async/i);
  });

  it('should throw when a class is passed as a bare supply value', () => {
    // Arrange — `typeof Class === 'function'`; a class is not a (ctx) => raw supply.
    class NotASupply {}

    // Act & Assert
    expect(() =>
      defineMiddleware({
        adapters: [FakeAdapterA],
        augments: { request: { getQuery: NotASupply as never } },
      }),
    ).toThrow('augments.request.getQuery');
  });

  it('should throw when an augments value is neither a function nor a spec', () => {
    // Arrange & Act & Assert
    expect(() =>
      defineMiddleware({
        adapters: [FakeAdapterA],
        augments: { request: { getQuery: 42 as never } },
      }),
    ).toThrow('augments.request.getQuery');
  });

  it('should normalize multiple bare functions in one namespace independently', () => {
    // Arrange — two bare functions on the same namespace.
    const getQuery = (_ctx: AdapterContext) => ({ q: '1' });
    const getExtra = (_ctx: AdapterContext) => 'v';

    // Act
    const def = defineMiddleware({
      adapters: [FakeAdapterA],
      augments: { request: { getQuery, getExtra } },
      factory: noopFactory,
    });

    // Assert
    expect(def.augments?.request?.getQuery?.kind).toBe('validated-accessor');
    expect(def.augments?.request?.getExtra?.kind).toBe('validated-accessor');
  });

  it('should normalize a bare function in an augments-only config and synthesize a noop factory', () => {
    // Arrange
    const supply = (_ctx: AdapterContext) => ({ q: '1' });

    // Act
    const def = defineMiddleware({
      adapters: [FakeAdapterA],
      augments: { request: { getQuery: supply } },
    });

    // Assert
    expect(def.augments?.request?.getQuery?.kind).toBe('validated-accessor');
    expect(def.factory()({} as AdapterContext)).toBeUndefined();
  });

  it('should normalize bare functions on distinct namespaces independently', () => {
    // Arrange
    const reqSupply = (_ctx: AdapterContext) => ({ q: '1' });
    const resSupply = (_ctx: AdapterContext) => ({ r: '2' });

    // Act
    const def = defineMiddleware({
      adapters: [FakeAdapterA],
      augments: { request: { getQuery: reqSupply }, response: { getMeta: resSupply } },
      factory: noopFactory,
    });

    // Assert
    expect(def.augments?.request?.getQuery?.kind).toBe('validated-accessor');
    expect(def.augments?.response?.getMeta?.kind).toBe('validated-accessor');
  });

  it('should not fall through to other overloads for an augments-only config', () => {
    // Arrange
    const supply = (_ctx: AdapterContext) => 'value';

    // Act
    const def = defineMiddleware({
      adapters: [FakeAdapterA],
      augments: { request: { extra: supply } },
    });

    // Assert
    expect(def.adapters).toEqual([FakeAdapterA]);
    expect(Object.isFrozen(def)).toBe(true);
  });
});
