import { describe, it, expect } from 'bun:test';
import type { AdapterContext, ContextKey } from '@zipbul/common';
import { augmentValidatedKey } from '@zipbul/common';

import { installAugmentAccessorOnPrototype } from './augment-installer';
import { runInAdapterContext } from '../adapter-context';

let seq = 0;
const uniqueProp = (base: string): string => `__ai_${base}_${seq++}`;

/** Minimal AdapterContext double backed by a Map. */
function createContext(): AdapterContext {
  const store = new Map<symbol, unknown>();

  return {
    getType: () => 'test',
    get: <T>(key: ContextKey<T>) => store.get(key as symbol) as T | undefined,
    set: <T>(key: ContextKey<T>, value: T) => { store.set(key as symbol, value); },
    use: <T>(key: ContextKey<T>) => {
      if (!store.has(key as symbol)) throw new Error(`Context key not set: ${String(key)}`);
      return store.get(key as symbol) as T;
    },
    to: () => { throw new Error('unsupported'); },
  } as AdapterContext;
}

describe('installAugmentAccessorOnPrototype', () => {
  it('should install a non-enumerable method that reads the validated slot via ALS', () => {
    // Arrange
    const proto: Record<string, unknown> = {};
    const prop = uniqueProp('getQuery');
    installAugmentAccessorOnPrototype(proto, 'request', prop, 'TestAdapter');
    const ctx = createContext();
    ctx.set(augmentValidatedKey('request', prop), { validated: true });
    const instance = Object.create(proto) as Record<string, () => unknown>;

    // Act
    const result = runInAdapterContext(ctx, () => instance[prop]!());

    // Assert
    expect(result).toEqual({ validated: true });
  });

  it('should install the accessor as a non-enumerable member', () => {
    // Arrange
    const proto: Record<string, unknown> = {};
    const prop = uniqueProp('hidden');

    // Act
    installAugmentAccessorOnPrototype(proto, 'request', prop, 'TestAdapter');

    // Assert
    expect(Object.keys(proto)).not.toContain(prop);
    expect(prop in proto).toBe(true);
  });

  it('should throw a ContextError when read before the validation slot is populated', () => {
    // Arrange
    const proto: Record<string, unknown> = {};
    const prop = uniqueProp('unset');
    installAugmentAccessorOnPrototype(proto, 'request', prop, 'TestAdapter');
    const instance = Object.create(proto) as Record<string, () => unknown>;

    // Act & Assert
    expect(() => runInAdapterContext(createContext(), () => instance[prop]!())).toThrow();
  });

  it('should be idempotent for a re-install of the same prop', () => {
    // Arrange
    const proto: Record<string, unknown> = {};
    const prop = uniqueProp('idem');
    installAugmentAccessorOnPrototype(proto, 'request', prop, 'TestAdapter');

    // Act & Assert
    expect(() => installAugmentAccessorOnPrototype(proto, 'request', prop, 'TestAdapter')).not.toThrow();
  });

  it('should throw when the prop collides with an existing prototype member', () => {
    // Arrange
    const proto = { existing: () => 'real' } as Record<string, unknown>;

    // Act & Assert
    expect(() => installAugmentAccessorOnPrototype(proto, 'request', 'existing', 'TestAdapter')).toThrow(
      "collides with an existing member of 'request'",
    );
  });

  it('should name the declaring adapter in the collision diagnostic', () => {
    // Arrange
    const proto = { taken: 1 } as Record<string, unknown>;

    // Act & Assert
    expect(() => installAugmentAccessorOnPrototype(proto, 'request', 'taken', 'GrpcAdapter')).toThrow(
      '[GrpcAdapter]',
    );
  });
});
