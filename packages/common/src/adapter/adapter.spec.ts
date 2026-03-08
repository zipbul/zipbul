import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { err, isErr } from '@zipbul/result';
import type { Context } from '../interfaces';
import { MiddlewareHook } from './types';
import type { MiddlewareHandlerFn } from '../define-middleware';
import { defineMiddleware } from '../define-middleware';
import { Adapter } from './adapter';

class TestAdapter extends Adapter {
  readonly decorators = { controller: () => {}, handler: [] };
  async start() {}
  async stop() {}
}

class AnotherAdapter extends Adapter {
  readonly decorators = { controller: () => {}, handler: [] };
  async start() {}
  async stop() {}
}

class ChildAdapter extends TestAdapter {}

function createContext(): Context {
  return {
    getType: () => 'test',
    get: () => undefined,
    to() {
      throw new Error('unsupported');
    },
  };
}

function mw(handler: MiddlewareHandlerFn) {
  return defineMiddleware(handler);
}

describe('Adapter', () => {
  let adapter: TestAdapter;

  beforeEach(() => {
    adapter = new TestAdapter();
  });

  describe('runMiddlewares', () => {
    // ── Happy Path ──────────────────────────────────────────

    it('should return void when hook-based single middleware returns void', async () => {
      // Arrange
      const handler = mock((_ctx: Context) => {});
      adapter.addMiddlewares(MiddlewareHook.OnReceive, [mw(handler)]);

      // Act
      const result = await adapter.runMiddlewares(MiddlewareHook.OnReceive, createContext());

      // Assert
      expect(isErr(result)).toBe(false);
      expect(result).toBeUndefined();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should execute all middlewares and return void when array overload has multiple void middlewares', async () => {
      // Arrange
      const order: string[] = [];
      const h1 = mock((_ctx: Context) => { order.push('1'); });
      const h2 = mock((_ctx: Context) => { order.push('2'); });
      const h3 = mock((_ctx: Context) => { order.push('3'); });

      // Act
      const result = await adapter.runMiddlewares(
        [mw(h1), mw(h2), mw(h3)],
        createContext(),
      );

      // Assert
      expect(isErr(result)).toBe(false);
      expect(result).toBeUndefined();
      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
      expect(h3).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['1', '2', '3']);
    });

    it('should execute all middlewares in registration order when multiple registered via addMiddlewares', async () => {
      // Arrange
      const order: string[] = [];
      const h1 = mock((_ctx: Context) => { order.push('1'); });
      const h2 = mock((_ctx: Context) => { order.push('2'); });
      const h3 = mock((_ctx: Context) => { order.push('3'); });
      adapter.addMiddlewares(MiddlewareHook.PreHandle, [mw(h1), mw(h2), mw(h3)]);

      // Act
      const result = await adapter.runMiddlewares(MiddlewareHook.PreHandle, createContext());

      // Assert
      expect(isErr(result)).toBe(false);
      expect(order).toEqual(['1', '2', '3']);
    });

    it('should return void when array overload has single item', async () => {
      // Arrange
      const handler = mock((_ctx: Context) => {});

      // Act
      const result = await adapter.runMiddlewares([mw(handler)], createContext());

      // Assert
      expect(isErr(result)).toBe(false);
      expect(result).toBeUndefined();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should execute only target hook middlewares when multiple hooks have separate registrations', async () => {
      // Arrange
      const onReceiveHandler = mock((_ctx: Context) => {});
      const preHandleHandler = mock((_ctx: Context) => {});
      adapter.addMiddlewares(MiddlewareHook.OnReceive, [mw(onReceiveHandler)]);
      adapter.addMiddlewares(MiddlewareHook.PreHandle, [mw(preHandleHandler)]);

      // Act
      await adapter.runMiddlewares(MiddlewareHook.OnReceive, createContext());

      // Assert
      expect(onReceiveHandler).toHaveBeenCalledTimes(1);
      expect(preHandleHandler).not.toHaveBeenCalled();
    });

    // ── Negative / Error ────────────────────────────────────

    it('should return Err when single middleware returns err', async () => {
      // Arrange
      const handler = mock((_ctx: Context) => err({ reason: 'test_halt' }));
      adapter.addMiddlewares(MiddlewareHook.OnReceive, [mw(handler)]);

      // Act
      const result = await adapter.runMiddlewares(MiddlewareHook.OnReceive, createContext());

      // Assert
      expect(isErr(result)).toBe(true);
    });

    it('should skip second middleware when first returns err', async () => {
      // Arrange
      const h1 = mock((_ctx: Context) => err({ reason: 'halt' }));
      const h2 = mock((_ctx: Context) => {});
      adapter.addMiddlewares(MiddlewareHook.OnReceive, [mw(h1), mw(h2)]);

      // Act
      const result = await adapter.runMiddlewares(MiddlewareHook.OnReceive, createContext());

      // Assert
      expect(isErr(result)).toBe(true);
      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).not.toHaveBeenCalled();
    });

    it('should run all prior middlewares when last returns err', async () => {
      // Arrange
      const h1 = mock((_ctx: Context) => {});
      const h2 = mock((_ctx: Context) => {});
      const h3 = mock((_ctx: Context) => err({ reason: 'late_halt' }));
      adapter.addMiddlewares(MiddlewareHook.PreHandle, [mw(h1), mw(h2), mw(h3)]);

      // Act
      const result = await adapter.runMiddlewares(MiddlewareHook.PreHandle, createContext());

      // Assert
      expect(isErr(result)).toBe(true);
      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
      expect(h3).toHaveBeenCalledTimes(1);
    });

    it('should preserve reason and message in Err data', async () => {
      // Arrange
      const handler = mock((_ctx: Context) =>
        err({ reason: 'cors_preflight', message: 'Preflight handled' }),
      );
      adapter.addMiddlewares(MiddlewareHook.OnReceive, [mw(handler)]);

      // Act
      const result = await adapter.runMiddlewares(MiddlewareHook.OnReceive, createContext());

      // Assert
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data).toEqual({
          reason: 'cors_preflight',
          message: 'Preflight handled',
        });
      }
    });

    it('should return Err immediately when array overload first middleware returns err', async () => {
      // Arrange
      const h1 = mock((_ctx: Context) => err({ reason: 'first_halt' }));
      const h2 = mock((_ctx: Context) => {});

      // Act
      const result = await adapter.runMiddlewares([mw(h1), mw(h2)], createContext());

      // Assert
      expect(isErr(result)).toBe(true);
      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).not.toHaveBeenCalled();
    });

    it('should propagate rejection when middleware throws exception', async () => {
      // Arrange
      const handler = mock((_ctx: Context) => {
        throw new Error('middleware crash');
      });
      adapter.addMiddlewares(MiddlewareHook.OnReceive, [mw(handler)]);

      // Act & Assert
      await expect(
        adapter.runMiddlewares(MiddlewareHook.OnReceive, createContext()),
      ).rejects.toThrow('middleware crash');
    });

    // ── Edge ────────────────────────────────────────────────

    it('should return void when hook has no registered middlewares', async () => {
      // Arrange — no addMiddlewares called for OnReceive

      // Act
      const result = await adapter.runMiddlewares(MiddlewareHook.OnReceive, createContext());

      // Assert
      expect(isErr(result)).toBe(false);
      expect(result).toBeUndefined();
    });

    it('should return void when empty array passed to overload', async () => {
      // Arrange — empty array
      const emptyList: ReturnType<typeof defineMiddleware>[] = [];

      // Act
      const result = await adapter.runMiddlewares(
        emptyList,
        createContext(),
      );

      // Assert
      expect(isErr(result)).toBe(false);
      expect(result).toBeUndefined();
    });

    it('should return void when sync middleware returns void', async () => {
      // Arrange
      const handler = mock((_ctx: Context) => undefined);
      adapter.addMiddlewares(MiddlewareHook.OnReceive, [mw(handler)]);

      // Act
      const result = await adapter.runMiddlewares(MiddlewareHook.OnReceive, createContext());

      // Assert
      expect(isErr(result)).toBe(false);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    // ── Corner ──────────────────────────────────────────────

    it('should preserve context modifications when err halts pipeline', async () => {
      // Arrange
      const state = { modified: false };
      const h1 = mock((_ctx: Context) => {
        state.modified = true;
      });
      const h2 = mock((_ctx: Context) => err({ reason: 'halt_after_modify' }));
      adapter.addMiddlewares(MiddlewareHook.PreHandle, [mw(h1), mw(h2)]);

      // Act
      const result = await adapter.runMiddlewares(MiddlewareHook.PreHandle, createContext());

      // Assert
      expect(isErr(result)).toBe(true);
      expect(h1).toHaveBeenCalledTimes(1);
      expect(state.modified).toBe(true);
    });

    // ── State Transition ────────────────────────────────────

    it('should include newly added middlewares when addMiddlewares called between runs', async () => {
      // Arrange
      const h1 = mock((_ctx: Context) => {});
      adapter.addMiddlewares(MiddlewareHook.OnReceive, [mw(h1)]);

      // Act — first run
      await adapter.runMiddlewares(MiddlewareHook.OnReceive, createContext());

      // Arrange — add more
      const h2 = mock((_ctx: Context) => {});
      adapter.addMiddlewares(MiddlewareHook.OnReceive, [mw(h2)]);

      // Act — second run
      await adapter.runMiddlewares(MiddlewareHook.OnReceive, createContext());

      // Assert
      expect(h1).toHaveBeenCalledTimes(2);
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it('should return void when runMiddlewares called before any addMiddlewares', async () => {
      // Arrange — fresh adapter, no middlewares

      // Act
      const result = await adapter.runMiddlewares(MiddlewareHook.PreHandle, createContext());

      // Assert
      expect(isErr(result)).toBe(false);
      expect(result).toBeUndefined();
    });

    it('should restart from beginning when retrying after err', async () => {
      // Arrange
      const h1 = mock((_ctx: Context) => {});
      const h2 = mock((_ctx: Context) => err({ reason: 'temporary' }));
      adapter.addMiddlewares(MiddlewareHook.OnReceive, [mw(h1), mw(h2)]);

      // Act — two runs
      await adapter.runMiddlewares(MiddlewareHook.OnReceive, createContext());
      await adapter.runMiddlewares(MiddlewareHook.OnReceive, createContext());

      // Assert — h1 called twice (once per run), h2 called twice (once per run)
      expect(h1).toHaveBeenCalledTimes(2);
      expect(h2).toHaveBeenCalledTimes(2);
    });

    // ── Idempotency ─────────────────────────────────────────

    it('should return same result when called twice with same hook and context', async () => {
      // Arrange
      const handler = mock((_ctx: Context) => {});
      adapter.addMiddlewares(MiddlewareHook.OnReceive, [mw(handler)]);
      const ctx = createContext();

      // Act
      const result1 = await adapter.runMiddlewares(MiddlewareHook.OnReceive, ctx);
      const result2 = await adapter.runMiddlewares(MiddlewareHook.OnReceive, ctx);

      // Assert
      expect(result1).toBeUndefined();
      expect(result2).toBeUndefined();
      expect(isErr(result1)).toBe(isErr(result2));
    });

    // ── Ordering ────────────────────────────────────────────

    it('should halt at exact position when err returned at index N', async () => {
      // Arrange — 5 middlewares, err at index 2
      const handlers = Array.from({ length: 5 }, (_, index) =>
        index === 2
          ? mock((_ctx: Context) => err({ reason: `halt_at_${index}` }))
          : mock((_ctx: Context) => {}),
      );
      adapter.addMiddlewares(
        MiddlewareHook.OnReceive,
        handlers.map(handler => mw(handler)),
      );

      // Act
      await adapter.runMiddlewares(MiddlewareHook.OnReceive, createContext());

      // Assert — 0,1,2 ran; 3,4 didn't
      expect(handlers[0]).toHaveBeenCalledTimes(1);
      expect(handlers[1]).toHaveBeenCalledTimes(1);
      expect(handlers[2]).toHaveBeenCalledTimes(1);
      expect(handlers[3]).not.toHaveBeenCalled();
      expect(handlers[4]).not.toHaveBeenCalled();
    });

    it('should preserve combined order when addMiddlewares called twice for same hook', async () => {
      // Arrange
      const order: string[] = [];
      const hA = mock((_ctx: Context) => { order.push('A'); });
      const hB = mock((_ctx: Context) => { order.push('B'); });
      const hC = mock((_ctx: Context) => { order.push('C'); });
      adapter.addMiddlewares(MiddlewareHook.OnReceive, [mw(hA), mw(hB)]);
      adapter.addMiddlewares(MiddlewareHook.OnReceive, [mw(hC)]);

      // Act
      await adapter.runMiddlewares(MiddlewareHook.OnReceive, createContext());

      // Assert
      expect(order).toEqual(['A', 'B', 'C']);
    });

    it('should pass same context object reference to every middleware', async () => {
      // Arrange
      const h1 = mock((_ctx: Context) => {});
      const h2 = mock((_ctx: Context) => {});
      adapter.addMiddlewares(MiddlewareHook.OnReceive, [mw(h1), mw(h2)]);
      const ctx = createContext();

      // Act
      await adapter.runMiddlewares(MiddlewareHook.OnReceive, ctx);

      // Assert
      expect(h1.mock.calls[0]![0]).toBe(ctx);
      expect(h2.mock.calls[0]![0]).toBe(ctx);
    });
  });

  describe('addMiddlewares - adapter compatibility', () => {
    // ── Happy Path ──────────────────────────────────────────

    it('should accept middleware without adapters field (universal)', () => {
      // Arrange
      const def = defineMiddleware((_ctx: Context) => {});

      // Act & Assert
      expect(() => adapter.addMiddlewares(MiddlewareHook.OnReceive, [def])).not.toThrow();
    });

    it('should accept middleware when adapter class matches', () => {
      // Arrange
      const def = defineMiddleware([TestAdapter], (_ctx: Context) => {});

      // Act & Assert
      expect(() => adapter.addMiddlewares(MiddlewareHook.OnReceive, [def])).not.toThrow();
    });

    it('should accept middleware when one of multiple adapter classes matches', () => {
      // Arrange
      const def = defineMiddleware([AnotherAdapter, TestAdapter], (_ctx: Context) => {});

      // Act & Assert
      expect(() => adapter.addMiddlewares(MiddlewareHook.OnReceive, [def])).not.toThrow();
    });

    it('should accept middleware on child adapter when parent class is declared', () => {
      // Arrange
      const child = new ChildAdapter();
      const def = defineMiddleware([TestAdapter], (_ctx: Context) => {});

      // Act & Assert
      expect(() => child.addMiddlewares(MiddlewareHook.OnReceive, [def])).not.toThrow();
    });

    // ── Negative / Error ────────────────────────────────────

    it('should throw when middleware declares incompatible adapter class', () => {
      // Arrange
      const def = defineMiddleware([AnotherAdapter], (_ctx: Context) => {});

      // Act & Assert
      expect(() => adapter.addMiddlewares(MiddlewareHook.OnReceive, [def])).toThrow(
        /AnotherAdapter.*TestAdapter/,
      );
    });

    it('should throw when none of multiple declared adapter classes match', () => {
      // Arrange
      const another = new AnotherAdapter();
      const def = defineMiddleware([TestAdapter], (_ctx: Context) => {});

      // Act & Assert
      expect(() => another.addMiddlewares(MiddlewareHook.OnReceive, [def])).toThrow(
        /TestAdapter.*AnotherAdapter/,
      );
    });

    it('should throw on first incompatible middleware when batch contains mixed compatibility', () => {
      // Arrange
      const compatible = defineMiddleware([TestAdapter], (_ctx: Context) => {});
      const incompatible = defineMiddleware([AnotherAdapter], (_ctx: Context) => {});

      // Act & Assert
      expect(() => adapter.addMiddlewares(MiddlewareHook.OnReceive, [incompatible, compatible])).toThrow(
        /AnotherAdapter/,
      );
    });

    // ── Edge ────────────────────────────────────────────────

    it('should accept middleware with empty adapters array', () => {
      // Arrange
      const def = defineMiddleware([], (_ctx: Context) => {});

      // Act & Assert
      expect(() => adapter.addMiddlewares(MiddlewareHook.OnReceive, [def])).not.toThrow();
    });

    it('should not modify registry when validation fails', () => {
      // Arrange
      const def = defineMiddleware([AnotherAdapter], (_ctx: Context) => {});

      // Act
      try { adapter.addMiddlewares(MiddlewareHook.OnReceive, [def]); } catch { /* expected */ }

      // Assert — registry should remain empty for this hook
      const result = adapter.runMiddlewares(MiddlewareHook.OnReceive, createContext());
      expect(result).resolves.toBeUndefined();
    });
  });
});
