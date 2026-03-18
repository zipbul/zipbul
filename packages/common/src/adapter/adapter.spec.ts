import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { err, isErr } from '@zipbul/result';
import type { Err, Result } from '@zipbul/result';
import type { Context, ZipbulContainer } from '../interfaces';
import type { MiddlewareHandlerFn } from '../define-middleware';
import { defineMiddleware } from '../define-middleware';
import { defineGuard } from '../define-guard';
import { defineExceptionFilter } from '../define-exception-filter';
import { MiddlewareHook } from './types';
import { Adapter } from './adapter';

class TestAdapter extends Adapter {
  readonly decorators = { controller: () => {}, handler: [] };
  parseInput(_context: Context) {}
  resolveHandler(_context: Context): Result<unknown, unknown> { return undefined as unknown as Result<unknown, unknown>; }
  handleResult(_result: Result<unknown, unknown>, _context: Context) {}
  forceCloseConnection(_context: Context) {}
  async start() {}
  async stop() {}
}

class AnotherAdapter extends Adapter {
  readonly decorators = { controller: () => {}, handler: [] };
  parseInput(_context: Context) {}
  resolveHandler(_context: Context): Result<unknown, unknown> { return undefined as unknown as Result<unknown, unknown>; }
  handleResult(_result: Result<unknown, unknown>, _context: Context) {}
  forceCloseConnection(_context: Context) {}
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

function createMockContainer(): ZipbulContainer {
  return {
    get: () => undefined,
    set: () => {},
    has: () => false,
    getInstances: () => [][Symbol.iterator](),
    keys: () => [][Symbol.iterator](),
  } as unknown as ZipbulContainer;
}

function mw(handler: MiddlewareHandlerFn) {
  return defineMiddleware(() => handler);
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
      adapter.initializePipeline(createMockContainer());

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
      adapter.addMiddlewares(MiddlewareHook.OnReceive, [mw(h1), mw(h2), mw(h3)]);
      adapter.initializePipeline(createMockContainer());

      // Act
      const result = await adapter.runMiddlewares(MiddlewareHook.OnReceive, createContext());

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
      adapter.initializePipeline(createMockContainer());

      // Act
      const result = await adapter.runMiddlewares(MiddlewareHook.PreHandle, createContext());

      // Assert
      expect(isErr(result)).toBe(false);
      expect(order).toEqual(['1', '2', '3']);
    });

    it('should return void when array overload has single item', async () => {
      // Arrange
      const handler = mock((_ctx: Context) => {});
      adapter.addMiddlewares(MiddlewareHook.OnReceive, [mw(handler)]);
      adapter.initializePipeline(createMockContainer());

      // Act
      const result = await adapter.runMiddlewares(MiddlewareHook.OnReceive, createContext());

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
      adapter.initializePipeline(createMockContainer());

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
      adapter.initializePipeline(createMockContainer());

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
      adapter.initializePipeline(createMockContainer());

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
      adapter.initializePipeline(createMockContainer());

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
      adapter.initializePipeline(createMockContainer());

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

    it('should propagate rejection when middleware throws exception', async () => {
      // Arrange
      const handler = mock((_ctx: Context) => {
        throw new Error('middleware crash');
      });
      adapter.addMiddlewares(MiddlewareHook.OnReceive, [mw(handler)]);
      adapter.initializePipeline(createMockContainer());

      // Act & Assert
      await expect(
        adapter.runMiddlewares(MiddlewareHook.OnReceive, createContext()),
      ).rejects.toThrow('middleware crash');
    });

    // ── Edge ────────────────────────────────────────────────

    it('should return void when hook has no registered middlewares', async () => {
      // Arrange — no addMiddlewares called for OnReceive
      adapter.initializePipeline(createMockContainer());

      // Act
      const result = await adapter.runMiddlewares(MiddlewareHook.OnReceive, createContext());

      // Assert
      expect(isErr(result)).toBe(false);
      expect(result).toBeUndefined();
    });

    it('should return void when sync middleware returns void', async () => {
      // Arrange
      const handler = mock((_ctx: Context) => undefined);
      adapter.addMiddlewares(MiddlewareHook.OnReceive, [mw(handler)]);
      adapter.initializePipeline(createMockContainer());

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
      adapter.initializePipeline(createMockContainer());

      // Act
      const result = await adapter.runMiddlewares(MiddlewareHook.PreHandle, createContext());

      // Assert
      expect(isErr(result)).toBe(true);
      expect(h1).toHaveBeenCalledTimes(1);
      expect(state.modified).toBe(true);
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
      adapter.initializePipeline(createMockContainer());

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
      adapter.initializePipeline(createMockContainer());

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
      adapter.initializePipeline(createMockContainer());
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
      const def = defineMiddleware(() => (_ctx: Context) => {});

      // Act & Assert
      expect(() => adapter.addMiddlewares(MiddlewareHook.OnReceive, [def])).not.toThrow();
    });

    it('should accept middleware when adapter class matches', () => {
      // Arrange
      const def = defineMiddleware([TestAdapter], () => (_ctx: Context) => {});

      // Act & Assert
      expect(() => adapter.addMiddlewares(MiddlewareHook.OnReceive, [def])).not.toThrow();
    });

    it('should accept middleware when one of multiple adapter classes matches', () => {
      // Arrange
      const def = defineMiddleware([AnotherAdapter, TestAdapter], () => (_ctx: Context) => {});

      // Act & Assert
      expect(() => adapter.addMiddlewares(MiddlewareHook.OnReceive, [def])).not.toThrow();
    });

    it('should accept middleware on child adapter when parent class is declared', () => {
      // Arrange
      const child = new ChildAdapter();
      const def = defineMiddleware([TestAdapter], () => (_ctx: Context) => {});

      // Act & Assert
      expect(() => child.addMiddlewares(MiddlewareHook.OnReceive, [def])).not.toThrow();
    });

    // ── Negative / Error ────────────────────────────────────

    it('should throw when middleware declares incompatible adapter class', () => {
      // Arrange
      const def = defineMiddleware([AnotherAdapter], () => (_ctx: Context) => {});

      // Act & Assert
      expect(() => adapter.addMiddlewares(MiddlewareHook.OnReceive, [def])).toThrow(
        /AnotherAdapter.*TestAdapter/,
      );
    });

    it('should throw when none of multiple declared adapter classes match', () => {
      // Arrange
      const another = new AnotherAdapter();
      const def = defineMiddleware([TestAdapter], () => (_ctx: Context) => {});

      // Act & Assert
      expect(() => another.addMiddlewares(MiddlewareHook.OnReceive, [def])).toThrow(
        /TestAdapter.*AnotherAdapter/,
      );
    });

    it('should throw on first incompatible middleware when batch contains mixed compatibility', () => {
      // Arrange
      const compatible = defineMiddleware([TestAdapter], () => (_ctx: Context) => {});
      const incompatible = defineMiddleware([AnotherAdapter], () => (_ctx: Context) => {});

      // Act & Assert
      expect(() => adapter.addMiddlewares(MiddlewareHook.OnReceive, [incompatible, compatible])).toThrow(
        /AnotherAdapter/,
      );
    });

    // ── Edge ────────────────────────────────────────────────

    it('should accept middleware with empty adapters array', () => {
      // Arrange
      const def = defineMiddleware([], () => (_ctx: Context) => {});

      // Act & Assert
      expect(() => adapter.addMiddlewares(MiddlewareHook.OnReceive, [def])).not.toThrow();
    });

    it('should not modify registry when validation fails', () => {
      // Arrange
      const def = defineMiddleware([AnotherAdapter], () => (_ctx: Context) => {});

      // Act
      try { adapter.addMiddlewares(MiddlewareHook.OnReceive, [def]); } catch { /* expected */ }
      adapter.initializePipeline(createMockContainer());

      // Assert — registry should remain empty for this hook
      const result = adapter.runMiddlewares(MiddlewareHook.OnReceive, createContext());
      expect(result).resolves.toBeUndefined();
    });
  });

  // ── dispatchRequest ─────────────────────────────────────────

  describe('dispatchRequest', () => {
    it('should execute full pipeline: OnReceive -> parseInput -> PostParseData -> Guards -> PreHandle -> resolveHandler -> handleResult -> OnComplete', async () => {
      // Arrange
      const order: string[] = [];
      adapter.addMiddlewares(MiddlewareHook.OnReceive, [mw(() => { order.push('OnReceive'); })]);
      adapter.addMiddlewares(MiddlewareHook.PostParseData, [mw(() => { order.push('PostParseData'); })]);
      adapter.addMiddlewares(MiddlewareHook.PreHandle, [mw(() => { order.push('PreHandle'); })]);
      adapter.addMiddlewares(MiddlewareHook.OnComplete, [mw(() => { order.push('OnComplete'); })]);
      adapter.initializePipeline(createMockContainer());

      adapter.parseInput = mock((_ctx: Context) => { order.push('parseInput'); });
      adapter.resolveHandler = mock((_ctx: Context) => { order.push('resolveHandler'); return { value: 'ok' } as Result<unknown, unknown>; });
      adapter.handleResult = mock((_result: Result<unknown, unknown>, _ctx: Context) => { order.push('handleResult'); });

      // Act
      await adapter.dispatchRequest(createContext());

      // Assert
      expect(order).toEqual([
        'OnReceive', 'parseInput', 'PostParseData', 'PreHandle',
        'resolveHandler', 'handleResult', 'OnComplete',
      ]);
    });

    it('should skip after middleware err and jump to handleResult', async () => {
      // Arrange
      adapter.addMiddlewares(MiddlewareHook.OnReceive, [mw(() => err({ status: 401 }))]);
      adapter.initializePipeline(createMockContainer());
      adapter.resolveHandler = mock((_ctx: Context) => { throw new Error('should not be called'); });
      adapter.handleResult = mock((_result: Result<unknown, unknown>, _ctx: Context) => {});

      // Act
      await adapter.dispatchRequest(createContext());

      // Assert
      expect(adapter.resolveHandler).not.toHaveBeenCalled();
      expect(adapter.handleResult).toHaveBeenCalledTimes(1);
    });

    it('should run exception filters when pipeline throws', async () => {
      // Arrange
      class TestError extends Error {
        constructor() { super('test error'); }
      }

      const filterHandler = mock((_error: TestError, _context: Context): Err<unknown> => {
        return err({ status: 400, message: 'caught' });
      });

      adapter.addExceptionFilters([defineExceptionFilter([TestError], () => filterHandler)]);
      adapter.initializePipeline(createMockContainer());
      adapter.resolveHandler = mock((_ctx: Context) => { throw new TestError(); });
      const handleResultCalls: unknown[] = [];
      adapter.handleResult = mock((result: Result<unknown, unknown>, _ctx: Context) => { handleResultCalls.push(result); });

      // Act
      await adapter.dispatchRequest(createContext());

      // Assert
      expect(adapter.handleResult).toHaveBeenCalledTimes(1);
      expect(isErr(handleResultCalls[0])).toBe(true);
    });

    it('should call forceCloseConnection when handleResult throws on error path', async () => {
      // Arrange
      adapter.initializePipeline(createMockContainer());
      adapter.resolveHandler = mock((_ctx: Context) => { throw new Error('pipeline error'); });
      adapter.handleResult = mock((_result: Result<unknown, unknown>, _ctx: Context) => { throw new Error('handleResult failed'); });
      adapter.forceCloseConnection = mock((_ctx: Context) => {});

      // Act
      await adapter.dispatchRequest(createContext());

      // Assert
      expect(adapter.forceCloseConnection).toHaveBeenCalledTimes(1);
    });

    it('should swallow OnComplete errors', async () => {
      // Arrange
      adapter.addMiddlewares(MiddlewareHook.OnComplete, [mw(() => { throw new Error('complete fail'); })]);
      adapter.initializePipeline(createMockContainer());
      adapter.resolveHandler = mock((_ctx: Context) => undefined as unknown as Result<unknown, unknown>);
      adapter.handleResult = mock((_result: Result<unknown, unknown>, _ctx: Context) => {});

      // Act & Assert — no throw
      await expect(adapter.dispatchRequest(createContext())).resolves.toBeUndefined();
    });

    it('should run guards before PreHandle and resolveHandler', async () => {
      // Arrange
      const order: string[] = [];
      adapter.addGuards([defineGuard(() => () => { order.push('guard'); })]);
      adapter.addMiddlewares(MiddlewareHook.PreHandle, [mw(() => { order.push('PreHandle'); })]);
      adapter.initializePipeline(createMockContainer());
      adapter.resolveHandler = mock((_ctx: Context) => { order.push('resolveHandler'); return undefined as unknown as Result<unknown, unknown>; });
      adapter.handleResult = mock((_result: Result<unknown, unknown>, _ctx: Context) => {});

      // Act
      await adapter.dispatchRequest(createContext());

      // Assert
      expect(order).toEqual(['guard', 'PreHandle', 'resolveHandler']);
    });

    it('should skip pipeline after guard err', async () => {
      // Arrange
      adapter.addGuards([defineGuard(() => () => err({ status: 403 }))]);
      adapter.initializePipeline(createMockContainer());
      adapter.resolveHandler = mock((_ctx: Context) => undefined as unknown as Result<unknown, unknown>);
      adapter.handleResult = mock((_result: Result<unknown, unknown>, _ctx: Context) => {});

      // Act
      await adapter.dispatchRequest(createContext());

      // Assert
      expect(adapter.resolveHandler).not.toHaveBeenCalled();
      expect(adapter.handleResult).toHaveBeenCalledTimes(1);
    });
  });

  // ── runExceptionFilters ────────────────────────────────────

  describe('runExceptionFilters', () => {
    it('should match filter by error type via instanceof', async () => {
      // Arrange
      class DbError extends Error {}

      const filterHandler = mock((_error: DbError, _context: Context): Err<unknown> => {
        return err({ status: 503, message: 'db down' });
      });

      adapter.addExceptionFilters([defineExceptionFilter([DbError], () => filterHandler)]);
      adapter.initializePipeline(createMockContainer());

      // Act
      const result = await adapter.runExceptionFilters(new DbError(), createContext());

      // Assert
      expect(isErr(result)).toBe(true);
      expect(result.data).toEqual({ status: 503, message: 'db down' });
    });

    it('should skip filter when error type does not match', async () => {
      // Arrange
      class SpecificError extends Error {}

      const filterHandler = mock((_error: SpecificError, _context: Context): Err<unknown> => {
        return err({ caught: true });
      });

      adapter.addExceptionFilters([defineExceptionFilter([SpecificError], () => filterHandler)]);
      adapter.initializePipeline(createMockContainer());
      const originalError = new Error('generic');

      // Act
      const result = await adapter.runExceptionFilters(originalError, createContext());

      // Assert
      expect(result.data).toHaveProperty('message', 'Unhandled error');
      expect(result.data).toHaveProperty('cause', originalError);
    });

    it('should match catch-all filter (empty catchTypes)', async () => {
      // Arrange
      const filterHandler = mock((_error: unknown, _context: Context): Err<unknown> => {
        return err({ status: 500, message: 'caught all' });
      });

      adapter.addExceptionFilters([defineExceptionFilter([], () => filterHandler)]);
      adapter.initializePipeline(createMockContainer());

      // Act
      const result = await adapter.runExceptionFilters(new Error('anything'), createContext());

      // Assert
      expect(result.data).toEqual({ status: 500, message: 'caught all' });
    });

    it('should return default error with cause when no filters are registered', async () => {
      // Arrange
      adapter.initializePipeline(createMockContainer());
      const orphanError = new Error('orphan');

      // Act
      const result = await adapter.runExceptionFilters(orphanError, createContext());

      // Assert
      expect(isErr(result)).toBe(true);
      expect(result.data).toHaveProperty('message', 'Unhandled error');
      expect(result.data).toHaveProperty('cause', orphanError);
    });

    it('should use first matching filter and skip remaining', async () => {
      // Arrange
      class AppError extends Error {}
      const order: string[] = [];

      const firstHandler = mock((_error: AppError, _context: Context): Err<unknown> => {
        order.push('first');
        return err({ matched: 'first' });
      });

      const secondHandler = mock((_error: AppError, _context: Context): Err<unknown> => {
        order.push('second');
        return err({ matched: 'second' });
      });

      adapter.addExceptionFilters([
        defineExceptionFilter([AppError], () => firstHandler),
        defineExceptionFilter([AppError], () => secondHandler),
      ]);
      adapter.initializePipeline(createMockContainer());

      // Act
      const result = await adapter.runExceptionFilters(new AppError(), createContext());

      // Assert
      expect(order).toEqual(['first']);
      expect(result.data).toEqual({ matched: 'first' });
    });
  });

  // ── addExceptionFilters ──────────────────────────────────

  describe('addExceptionFilters', () => {
    it('should register exception filter definitions', async () => {
      // Arrange
      const filterHandler = mock((_error: unknown, _context: Context): Err<unknown> => {
        return err({ caught: true });
      });

      const defs = [defineExceptionFilter([], () => filterHandler)];

      // Act
      adapter.addExceptionFilters(defs);
      adapter.initializePipeline(createMockContainer());
      const result = await adapter.runExceptionFilters(new Error('test'), createContext());

      // Assert
      expect(result.data).toEqual({ caught: true });
    });

    it('should return this for chaining', () => {
      // Act
      const returned = adapter.addExceptionFilters([]);

      // Assert
      expect(returned).toBe(adapter);
    });
  });

  // ── addGuards ──────────────────────────────────────────────

  describe('addGuards', () => {
    it('should return this for chaining', () => {
      // Act
      const returned = adapter.addGuards([]);

      // Assert
      expect(returned).toBe(adapter);
    });

    it('should accept guard without adapters field (universal)', () => {
      // Arrange
      const guard = defineGuard(() => (_ctx: Context) => {});

      // Act & Assert
      expect(() => adapter.addGuards([guard])).not.toThrow();
    });

    it('should accept guard when adapter class matches', () => {
      // Arrange
      const guard = defineGuard([TestAdapter], () => (_ctx: Context) => {});

      // Act & Assert
      expect(() => adapter.addGuards([guard])).not.toThrow();
    });

    it('should throw when guard declares incompatible adapter class', () => {
      // Arrange
      const guard = defineGuard([AnotherAdapter], () => (_ctx: Context) => {});

      // Act & Assert
      expect(() => adapter.addGuards([guard])).toThrow(
        /AnotherAdapter.*TestAdapter/,
      );
    });

    it('should accept guard on child adapter when parent class is declared', () => {
      // Arrange
      const child = new ChildAdapter();
      const guard = defineGuard([TestAdapter], () => (_ctx: Context) => {});

      // Act & Assert
      expect(() => child.addGuards([guard])).not.toThrow();
    });
  });

  // ── dispatchRequest - exception filter safety ──────────────

  describe('dispatchRequest - exception filter safety', () => {
    it('should call forceCloseConnection when exception filter throws', async () => {
      // Arrange
      const brokenHandler = mock((_error: unknown, _context: Context): Err<unknown> => {
        throw new Error('filter crashed');
      });

      adapter.addExceptionFilters([defineExceptionFilter([], () => brokenHandler)]);
      adapter.initializePipeline(createMockContainer());
      adapter.resolveHandler = mock(() => { throw new Error('pipeline error'); });
      adapter.handleResult = mock(() => { throw new Error('handleResult also failed'); });
      adapter.forceCloseConnection = mock(() => {});

      // Act
      await adapter.dispatchRequest(createContext());

      // Assert
      expect(adapter.forceCloseConnection).toHaveBeenCalledTimes(1);
    });
  });

  // ── Async handler paths ──────────────────────────────────

  describe('async middleware handlers', () => {
    it('should handle async middleware that returns void', async () => {
      // Arrange
      const order: string[] = [];
      const asyncMw = defineMiddleware(() => async (_ctx: Context) => {
        await Promise.resolve();
        order.push('async-mw');
      });

      adapter.addMiddlewares(MiddlewareHook.OnReceive, [asyncMw]);
      adapter.initializePipeline(createMockContainer());

      // Act
      const result = await adapter.runMiddlewares(MiddlewareHook.OnReceive, createContext());

      // Assert
      expect(isErr(result)).toBe(false);
      expect(order).toEqual(['async-mw']);
    });

    it('should handle async middleware that returns Err', async () => {
      // Arrange
      const asyncMw = defineMiddleware(() => async (_ctx: Context) => {
        await Promise.resolve();
        return err({ halted: true });
      });

      adapter.addMiddlewares(MiddlewareHook.OnReceive, [asyncMw]);
      adapter.initializePipeline(createMockContainer());

      // Act
      const result = await adapter.runMiddlewares(MiddlewareHook.OnReceive, createContext());

      // Assert
      expect(isErr(result)).toBe(true);
    });
  });

  describe('async guard handlers', () => {
    it('should handle async guard that allows', async () => {
      // Arrange
      const asyncGuard = defineGuard(() => async (_ctx: Context) => {
        await Promise.resolve();
      });

      adapter.addGuards([asyncGuard]);
      adapter.initializePipeline(createMockContainer());
      adapter.parseInput = mock((_ctx: Context) => {});
      adapter.resolveHandler = mock((_ctx: Context) => ({ value: 'ok' }) as Result<unknown, unknown>);
      adapter.handleResult = mock((_result: Result<unknown, unknown>, _ctx: Context) => {});

      // Act
      await adapter.dispatchRequest(createContext());

      // Assert
      expect(adapter.resolveHandler).toHaveBeenCalledTimes(1);
    });

    it('should handle async guard that denies', async () => {
      // Arrange
      const asyncGuard = defineGuard(() => async (_ctx: Context) => {
        await Promise.resolve();
        return err({ status: 403 });
      });

      adapter.addGuards([asyncGuard]);
      adapter.initializePipeline(createMockContainer());
      adapter.parseInput = mock((_ctx: Context) => {});
      adapter.resolveHandler = mock((_ctx: Context) => ({ value: 'ok' }) as Result<unknown, unknown>);
      adapter.handleResult = mock((_result: Result<unknown, unknown>, _ctx: Context) => {});

      // Act
      await adapter.dispatchRequest(createContext());

      // Assert
      expect(adapter.resolveHandler).not.toHaveBeenCalled();
    });
  });

  describe('async exception filter', () => {
    it('should handle async exception filter handler', async () => {
      // Arrange
      const asyncHandler = mock(async (_error: unknown, _context: Context): Promise<Err<unknown>> => {
        await Promise.resolve();
        return err({ async: true });
      });

      adapter.addExceptionFilters([defineExceptionFilter([], () => asyncHandler)]);
      adapter.initializePipeline(createMockContainer());

      // Act
      const result = await adapter.runExceptionFilters(new Error('test'), createContext());

      // Assert
      expect(result.data).toEqual({ async: true });
    });
  });

  // ── legacy API removal ──────────────────────────────────

  describe('legacy API removal', () => {
    it('should not have errorFilterTokens property on adapter instance', () => {
      // Arrange — fresh adapter from beforeEach

      // Act
      const hasProperty = 'errorFilterTokens' in adapter;

      // Assert
      expect(hasProperty).toBe(false);
    });

    it('should not have addErrorFilters method on adapter instance', () => {
      // Arrange — fresh adapter from beforeEach

      // Act
      const hasMethod = 'addErrorFilters' in adapter;

      // Assert
      expect(hasMethod).toBe(false);
    });

    it('should not have addExceptionFilterEntries method on adapter instance', () => {
      // Arrange — fresh adapter from beforeEach

      // Act
      const hasMethod = 'addExceptionFilterEntries' in adapter;

      // Assert
      expect(hasMethod).toBe(false);
    });

    it('should accept definitions via addExceptionFilters', () => {
      // Arrange
      const filterHandler = mock((_error: unknown, _context: Context): Err<unknown> => {
        return err({ caught: true });
      });

      const defs = [defineExceptionFilter([], () => filterHandler)];

      // Act
      const returned = adapter.addExceptionFilters(defs);

      // Assert
      expect(returned).toBe(adapter);
    });

    it('should accumulate definitions across multiple addExceptionFilters calls', async () => {
      // Arrange
      class FirstError extends Error {}
      class SecondError extends Error {}

      const firstHandler = mock((_error: FirstError, _context: Context): Err<unknown> => {
        return err({ matched: 'first' });
      });

      const secondHandler = mock((_error: SecondError, _context: Context): Err<unknown> => {
        return err({ matched: 'second' });
      });

      // Act — two separate calls
      adapter.addExceptionFilters([defineExceptionFilter([FirstError], () => firstHandler)]);
      adapter.addExceptionFilters([defineExceptionFilter([SecondError], () => secondHandler)]);
      adapter.initializePipeline(createMockContainer());

      const firstResult = await adapter.runExceptionFilters(new FirstError(), createContext());
      const secondResult = await adapter.runExceptionFilters(new SecondError(), createContext());

      // Assert
      expect(firstResult.data).toEqual({ matched: 'first' });
      expect(secondResult.data).toEqual({ matched: 'second' });
    });
  });
});
