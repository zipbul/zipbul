import { describe, it, expect } from 'bun:test';
import { getContext, runInRequestContext } from './request-context';
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

describe('getContext', () => {
  it('throws when called outside a request lifecycle', () => {
    expect(() => getContext()).toThrow(
      'getContext() must be called within a request.',
    );
  });
});

describe('runInRequestContext', () => {
  it('makes the context available via getContext()', () => {
    const ctx = createStubContext('test');
    runInRequestContext(ctx, () => {
      expect(getContext()).toBe(ctx);
    });
  });

  it('returns the callback return value', () => {
    const ctx = createStubContext('test');
    const result = runInRequestContext(ctx, () => 42);
    expect(result).toBe(42);
  });

  it('restores the outer context after nested runInRequestContext', () => {
    const outer = createStubContext('outer');
    const inner = createStubContext('inner');

    runInRequestContext(outer, () => {
      expect(getContext()).toBe(outer);

      runInRequestContext(inner, () => {
        expect(getContext()).toBe(inner);
      });

      expect(getContext()).toBe(outer);
    });
  });

  it('propagates context through async code', async () => {
    const ctx = createStubContext('async');

    await runInRequestContext(ctx, async () => {
      await Promise.resolve();
      expect(getContext()).toBe(ctx);
    });
  });

  it('isolates concurrent requests via Promise.all', async () => {
    const ctxA = createStubContext('request-a');
    const ctxB = createStubContext('request-b');

    await Promise.all([
      runInRequestContext(ctxA, async () => {
        await Promise.resolve();
        expect(getContext()).toBe(ctxA);
        expect(getContext().getType()).toBe('request-a');
      }),
      runInRequestContext(ctxB, async () => {
        await Promise.resolve();
        expect(getContext()).toBe(ctxB);
        expect(getContext().getType()).toBe('request-b');
      }),
    ]);
  });

  it('propagates context into setTimeout callbacks', async () => {
    const ctx = createStubContext('timer');

    await runInRequestContext(ctx, () => {
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(getContext()).toBe(ctx);
          resolve();
        }, 0);
      });
    });
  });

  it('context is unavailable after runInRequestContext exits', () => {
    const ctx = createStubContext('scoped');
    runInRequestContext(ctx, () => {
      // context available here
      expect(getContext()).toBe(ctx);
    });

    // outside — should throw
    expect(() => getContext()).toThrow(
      'getContext() must be called within a request.',
    );
  });

  it('should work with a synchronous function that returns a value', () => {
    const ctx = createStubContext('sync');

    const result = runInRequestContext(ctx, () => {
      return 'sync-result';
    });

    expect(result).toBe('sync-result');
  });

  it('should propagate thrown errors from the callback', () => {
    const ctx = createStubContext('error');
    const thrownError = new Error('callback boom');

    expect(() =>
      runInRequestContext(ctx, () => {
        throw thrownError;
      }),
    ).toThrow(thrownError);
  });

  it('should throw from getContext after synchronous runInRequestContext completes', () => {
    const ctx = createStubContext('completed');

    runInRequestContext(ctx, () => {
      expect(getContext()).toBe(ctx);
    });

    expect(() => getContext()).toThrow(
      'getContext() must be called within a request.',
    );
  });

  it('should restore context availability after callback throws', () => {
    const ctx = createStubContext('throw-restore');

    try {
      runInRequestContext(ctx, () => {
        throw new Error('intentional');
      });
    } catch {
      // expected
    }

    expect(() => getContext()).toThrow(
      'getContext() must be called within a request.',
    );
  });
});
