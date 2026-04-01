import { describe, it, expect } from 'bun:test';
import { getAdapterContext, runInAdapterContext } from './adapter-context';
import type { Context } from '@zipbul/common';
import type { ContextKey } from '@zipbul/common';

/** Minimal stub that satisfies the Context interface for testing. */
function createStubContext(label: string): Context {
  const store = new Map<symbol, unknown>();
  return {
    getType: () => label,
    get: <T>(key: ContextKey<T>) => store.get(key) as T | undefined,
    set: <T>(key: ContextKey<T>, value: T) => { store.set(key, value); },
    to: () => { throw new Error('not implemented'); },
    setValidated: () => { throw new Error('not implemented'); },
    getValidated: () => { throw new Error('not implemented'); },
  } as Context;
}

describe('getAdapterContext', () => {
  it('throws when called outside a request lifecycle', () => {
    expect(() => getAdapterContext()).toThrow(
      'getAdapterContext() must be called within a request.',
    );
  });
});

describe('runInAdapterContext', () => {
  it('makes the context available via getAdapterContext()', () => {
    const ctx = createStubContext('test');
    runInAdapterContext(ctx, () => {
      expect(getAdapterContext()).toBe(ctx);
    });
  });

  it('returns the callback return value', () => {
    const ctx = createStubContext('test');
    const result = runInAdapterContext(ctx, () => 42);
    expect(result).toBe(42);
  });

  it('restores the outer context after nested runInAdapterContext', () => {
    const outer = createStubContext('outer');
    const inner = createStubContext('inner');

    runInAdapterContext(outer, () => {
      expect(getAdapterContext()).toBe(outer);

      runInAdapterContext(inner, () => {
        expect(getAdapterContext()).toBe(inner);
      });

      expect(getAdapterContext()).toBe(outer);
    });
  });

  it('propagates context through async code', async () => {
    const ctx = createStubContext('async');

    await runInAdapterContext(ctx, async () => {
      await Promise.resolve();
      expect(getAdapterContext()).toBe(ctx);
    });
  });

  it('isolates concurrent requests via Promise.all', async () => {
    const ctxA = createStubContext('request-a');
    const ctxB = createStubContext('request-b');

    await Promise.all([
      runInAdapterContext(ctxA, async () => {
        await Promise.resolve();
        expect(getAdapterContext()).toBe(ctxA);
        expect(getAdapterContext().getType()).toBe('request-a');
      }),
      runInAdapterContext(ctxB, async () => {
        await Promise.resolve();
        expect(getAdapterContext()).toBe(ctxB);
        expect(getAdapterContext().getType()).toBe('request-b');
      }),
    ]);
  });

  it('propagates context into setTimeout callbacks', async () => {
    const ctx = createStubContext('timer');

    await runInAdapterContext(ctx, () => {
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(getAdapterContext()).toBe(ctx);
          resolve();
        }, 0);
      });
    });
  });

  it('context is unavailable after runInAdapterContext exits', () => {
    const ctx = createStubContext('scoped');
    runInAdapterContext(ctx, () => {
      // context available here
      expect(getAdapterContext()).toBe(ctx);
    });

    // outside — should throw
    expect(() => getAdapterContext()).toThrow(
      'getAdapterContext() must be called within a request.',
    );
  });

  it('should work with a synchronous function that returns a value', () => {
    const ctx = createStubContext('sync');

    const result = runInAdapterContext(ctx, () => {
      return 'sync-result';
    });

    expect(result).toBe('sync-result');
  });

  it('should propagate thrown errors from the callback', () => {
    const ctx = createStubContext('error');
    const thrownError = new Error('callback boom');

    expect(() =>
      runInAdapterContext(ctx, () => {
        throw thrownError;
      }),
    ).toThrow(thrownError);
  });

  it('should throw from getAdapterContext after synchronous runInAdapterContext completes', () => {
    const ctx = createStubContext('completed');

    runInAdapterContext(ctx, () => {
      expect(getAdapterContext()).toBe(ctx);
    });

    expect(() => getAdapterContext()).toThrow(
      'getAdapterContext() must be called within a request.',
    );
  });

  it('should restore context availability after callback throws', () => {
    const ctx = createStubContext('throw-restore');

    try {
      runInAdapterContext(ctx, () => {
        throw new Error('intentional');
      });
    } catch {
      // expected
    }

    expect(() => getAdapterContext()).toThrow(
      'getAdapterContext() must be called within a request.',
    );
  });
});
