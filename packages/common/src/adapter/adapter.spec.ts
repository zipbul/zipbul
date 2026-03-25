import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { err, isErr } from '@zipbul/result';
import type { Err, Result } from '@zipbul/result';
import type { Context, ZipbulContainer } from '../interfaces';
import type { MiddlewareDefinition, MiddlewareHandlerFn } from '../define-middleware';
import { defineMiddleware } from '../define-middleware';
import { defineGuard } from '../define-guard';
import { defineExceptionFilter } from '../define-exception-filter';
import { Adapter, type ResolvedMiddleware } from './adapter';

/** Minimal concrete adapter for testing Common base class behavior. */
class TestAdapter extends Adapter {
  static readonly validPhases: ReadonlySet<string> = new Set(['TestPhase']);
  readonly decorators = { controller: () => {}, handler: [] };

  private testMiddlewareRegistry = new Map<string, MiddlewareDefinition[]>();
  private resolvedTestMiddlewares = new Map<string, ResolvedMiddleware[]>();
  private pipelineImpl: ((ctx: Context) => Promise<Result<unknown, unknown>> | Result<unknown, unknown>) | undefined;

  handleResult(_result: Result<unknown, unknown>, _context: Context) {}

  protected emergencyTeardown(_context: Context, _error?: unknown) {}

  protected async executePipeline(context: Context): Promise<Result<unknown, unknown>> {
    if (this.pipelineImpl !== undefined) {
      return this.pipelineImpl(context);
    }

    // Default: run TestPhase middlewares → guards → return ok
    const mwResult = await this.runMiddlewares(
      this.resolvedTestMiddlewares.get('TestPhase') ?? [], context,
    );

    if (isErr(mwResult)) {
      return mwResult;
    }

    const guardResult = await this.runGuards(context);

    if (isErr(guardResult)) {
      return guardResult;
    }

    return undefined as unknown as Result<unknown, unknown>;
  }

  applyMiddlewareConfig(config: Readonly<Record<string, readonly MiddlewareDefinition[]>>): void {
    for (const [key, definitions] of Object.entries(config)) {
      const existing = this.testMiddlewareRegistry.get(key) ?? [];
      this.testMiddlewareRegistry.set(key, [...existing, ...definitions]);
    }
  }

  addTestMiddlewares(phase: string, middlewares: readonly MiddlewareDefinition[]): this {
    const existing = this.testMiddlewareRegistry.get(phase) ?? [];
    this.testMiddlewareRegistry.set(phase, [...existing, ...middlewares]);
    return this;
  }

  override initializePipeline(container: ZipbulContainer): void {
    super.initializePipeline(container);

    for (const [phase, definitions] of this.testMiddlewareRegistry) {
      this.resolvedTestMiddlewares.set(phase, this.resolveMiddlewareDefs(definitions, container));
    }
  }

  setPipelineImpl(impl: (ctx: Context) => Promise<Result<unknown, unknown>> | Result<unknown, unknown>): void {
    this.pipelineImpl = impl;
  }

  async start() {}
  async stop() {}
}

class AnotherAdapter extends Adapter {
  static readonly validPhases: ReadonlySet<string> = new Set();
  readonly decorators = { controller: () => {}, handler: [] };
  handleResult(_result: Result<unknown, unknown>, _context: Context) {}
  protected emergencyTeardown(_context: Context) {}
  protected async executePipeline(_context: Context): Promise<Result<unknown, unknown>> {
    return undefined as unknown as Result<unknown, unknown>;
  }
  applyMiddlewareConfig() {}
  async start() {}
  async stop() {}
}

class ChildAdapter extends TestAdapter {}

/** TestAdapter that overrides getFinalizeMiddlewares to inject finalize middlewares. */
class TestAdapterWithFinalize extends TestAdapter {
  private readonly finalizeList: ResolvedMiddleware[];

  constructor(finalizeList: ResolvedMiddleware[]) {
    super();
    this.finalizeList = finalizeList;
  }

  protected override getFinalizeMiddlewares(): readonly ResolvedMiddleware[] {
    return this.finalizeList;
  }
}

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
    it('should return void when single middleware returns void', async () => {
      const handler = mock((_ctx: Context) => {});
      adapter.addTestMiddlewares('TestPhase', [mw(handler)]);
      adapter.initializePipeline(createMockContainer());

      const result = await adapter['runMiddlewares'](
        adapter['resolvedTestMiddlewares'].get('TestPhase')!, createContext(),
      );

      expect(isErr(result)).toBe(false);
      expect(result).toBeUndefined();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should execute all middlewares in order', async () => {
      const order: string[] = [];
      const h1 = mock((_ctx: Context) => { order.push('1'); });
      const h2 = mock((_ctx: Context) => { order.push('2'); });
      const h3 = mock((_ctx: Context) => { order.push('3'); });
      adapter.addTestMiddlewares('TestPhase', [mw(h1), mw(h2), mw(h3)]);
      adapter.initializePipeline(createMockContainer());

      await adapter['runMiddlewares'](
        adapter['resolvedTestMiddlewares'].get('TestPhase')!, createContext(),
      );

      expect(order).toEqual(['1', '2', '3']);
    });

    it('should return Err when middleware returns err', async () => {
      const handler = mock((_ctx: Context) => err({ reason: 'test_halt' }));
      adapter.addTestMiddlewares('TestPhase', [mw(handler)]);
      adapter.initializePipeline(createMockContainer());

      const result = await adapter['runMiddlewares'](
        adapter['resolvedTestMiddlewares'].get('TestPhase')!, createContext(),
      );

      expect(isErr(result)).toBe(true);
    });

    it('should skip second middleware when first returns err', async () => {
      const h1 = mock((_ctx: Context) => err({ reason: 'halt' }));
      const h2 = mock((_ctx: Context) => {});
      adapter.addTestMiddlewares('TestPhase', [mw(h1), mw(h2)]);
      adapter.initializePipeline(createMockContainer());

      const result = await adapter['runMiddlewares'](
        adapter['resolvedTestMiddlewares'].get('TestPhase')!, createContext(),
      );

      expect(isErr(result)).toBe(true);
      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).not.toHaveBeenCalled();
    });

    it('should propagate rejection when middleware throws', async () => {
      const handler = mock((_ctx: Context) => {
        throw new Error('middleware crash');
      });
      adapter.addTestMiddlewares('TestPhase', [mw(handler)]);
      adapter.initializePipeline(createMockContainer());

      await expect(
        adapter['runMiddlewares'](
          adapter['resolvedTestMiddlewares'].get('TestPhase')!, createContext(),
        ),
      ).rejects.toThrow('middleware crash');
    });

    it('should return void when empty list', async () => {
      const result = await adapter['runMiddlewares']([], createContext());

      expect(isErr(result)).toBe(false);
      expect(result).toBeUndefined();
    });

    it('should halt at exact position when err returned at index N', async () => {
      const handlers = Array.from({ length: 5 }, (_, index) =>
        index === 2
          ? mock((_ctx: Context) => err({ reason: `halt_at_${index}` }))
          : mock((_ctx: Context) => {}),
      );
      adapter.addTestMiddlewares('TestPhase', handlers.map(handler => mw(handler)));
      adapter.initializePipeline(createMockContainer());

      await adapter['runMiddlewares'](
        adapter['resolvedTestMiddlewares'].get('TestPhase')!, createContext(),
      );

      expect(handlers[0]).toHaveBeenCalledTimes(1);
      expect(handlers[1]).toHaveBeenCalledTimes(1);
      expect(handlers[2]).toHaveBeenCalledTimes(1);
      expect(handlers[3]).not.toHaveBeenCalled();
      expect(handlers[4]).not.toHaveBeenCalled();
    });

    it('should preserve combined order when addTestMiddlewares called twice', async () => {
      const order: string[] = [];
      const hA = mock((_ctx: Context) => { order.push('A'); });
      const hB = mock((_ctx: Context) => { order.push('B'); });
      const hC = mock((_ctx: Context) => { order.push('C'); });
      adapter.addTestMiddlewares('TestPhase', [mw(hA), mw(hB)]);
      adapter.addTestMiddlewares('TestPhase', [mw(hC)]);
      adapter.initializePipeline(createMockContainer());

      await adapter['runMiddlewares'](
        adapter['resolvedTestMiddlewares'].get('TestPhase')!, createContext(),
      );

      expect(order).toEqual(['A', 'B', 'C']);
    });

    it('should pass same context object reference to every middleware', async () => {
      const h1 = mock((_ctx: Context) => {});
      const h2 = mock((_ctx: Context) => {});
      adapter.addTestMiddlewares('TestPhase', [mw(h1), mw(h2)]);
      adapter.initializePipeline(createMockContainer());
      const ctx = createContext();

      await adapter['runMiddlewares'](
        adapter['resolvedTestMiddlewares'].get('TestPhase')!, ctx,
      );

      expect(h1.mock.calls[0]![0]).toBe(ctx);
      expect(h2.mock.calls[0]![0]).toBe(ctx);
    });
  });

  describe('applyMiddlewareConfig', () => {
    it('should store middleware definitions by phase key', () => {
      const def = defineMiddleware(() => (_ctx: Context) => {});

      adapter.applyMiddlewareConfig({ TestPhase: [def] });
      adapter.initializePipeline(createMockContainer());

      expect(adapter['resolvedTestMiddlewares'].get('TestPhase')).toHaveLength(1);
    });
  });

  describe('addGuards - adapter compatibility', () => {
    it('should accept guard without adapters field (universal)', () => {
      const guard = defineGuard(() => (_ctx: Context) => {});
      expect(() => adapter.addGuards([guard])).not.toThrow();
    });

    it('should accept guard when adapter class matches', () => {
      const guard = defineGuard([TestAdapter], () => (_ctx: Context) => {});
      expect(() => adapter.addGuards([guard])).not.toThrow();
    });

    it('should throw when guard declares incompatible adapter class', () => {
      const guard = defineGuard([AnotherAdapter], () => (_ctx: Context) => {});
      expect(() => adapter.addGuards([guard])).toThrow(/AnotherAdapter.*TestAdapter/);
    });

    it('should accept guard on child adapter when parent class is declared', () => {
      const child = new ChildAdapter();
      const guard = defineGuard([TestAdapter], () => (_ctx: Context) => {});
      expect(() => child.addGuards([guard])).not.toThrow();
    });

    it('should return this for chaining', () => {
      expect(adapter.addGuards([])).toBe(adapter);
    });
  });

  // ── dispatchRequest — 3-Phase error boundary ──────────────────

  describe('dispatchRequest', () => {
    it('should execute pipeline → handleResult → finalize in order', async () => {
      const order: string[] = [];
      adapter.setPipelineImpl(async () => {
        order.push('pipeline');
        return { value: 'ok' } as Result<unknown, unknown>;
      });
      adapter['handleResult'] = mock(() => { order.push('handleResult'); });
      adapter.initializePipeline(createMockContainer());

      await adapter.dispatchRequest(createContext());

      expect(order).toEqual(['pipeline', 'handleResult']);
    });

    it('should call handleResult exactly once with pipeline Err', async () => {
      adapter.setPipelineImpl(async () => err({ status: 401 }));
      adapter['handleResult'] = mock(() => {});
      adapter.initializePipeline(createMockContainer());

      await adapter.dispatchRequest(createContext());

      expect(adapter['handleResult']).toHaveBeenCalledTimes(1);
      const callResult = (adapter['handleResult'] as ReturnType<typeof mock>).mock.calls[0]![0];
      expect(isErr(callResult)).toBe(true);
    });

    it('should run exception filters when pipeline throws and call handleResult once', async () => {
      class TestError extends Error {
        constructor() { super('test error'); }
      }

      const filterHandler = mock((_error: TestError, _context: Context): Err<unknown> => {
        return err({ status: 400, message: 'caught' });
      });

      adapter.addExceptionFilters([defineExceptionFilter([TestError], () => filterHandler)]);
      adapter.initializePipeline(createMockContainer());
      adapter.setPipelineImpl(async () => { throw new TestError(); });
      const handleResultCalls: unknown[] = [];
      adapter['handleResult'] = mock((result: Result<unknown, unknown>) => { handleResultCalls.push(result); });

      await adapter.dispatchRequest(createContext());

      expect(adapter['handleResult']).toHaveBeenCalledTimes(1);
      expect(isErr(handleResultCalls[0])).toBe(true);
    });

    it('should call emergencyTeardown when handleResult throws', async () => {
      adapter.initializePipeline(createMockContainer());
      adapter.setPipelineImpl(async () => { throw new Error('pipeline error'); });
      adapter['handleResult'] = mock(() => { throw new Error('handleResult failed'); });
      adapter['emergencyTeardown'] = mock(() => {});

      await adapter.dispatchRequest(createContext());

      expect(adapter['emergencyTeardown']).toHaveBeenCalledTimes(1);
    });

    it('should not call handleResult twice even when pipeline throws', async () => {
      adapter.initializePipeline(createMockContainer());
      adapter.setPipelineImpl(async () => { throw new Error('crash'); });
      adapter['handleResult'] = mock(() => {});

      await adapter.dispatchRequest(createContext());

      expect(adapter['handleResult']).toHaveBeenCalledTimes(1);
    });

    it('should skip pipeline after guard err', async () => {
      adapter.addGuards([defineGuard(() => () => err({ status: 403 }))]);
      adapter.initializePipeline(createMockContainer());
      adapter['handleResult'] = mock(() => {});

      await adapter.dispatchRequest(createContext());

      expect(adapter['handleResult']).toHaveBeenCalledTimes(1);
      const callResult = (adapter['handleResult'] as ReturnType<typeof mock>).mock.calls[0]![0];
      expect(isErr(callResult)).toBe(true);
    });

    it('should swallow emergencyTeardown errors', async () => {
      adapter.initializePipeline(createMockContainer());
      adapter.setPipelineImpl(async () => ({ value: 'ok' }) as Result<unknown, unknown>);
      adapter['handleResult'] = mock(() => { throw new Error('handle fail'); });
      adapter['emergencyTeardown'] = mock(() => { throw new Error('teardown fail'); });

      // Should not throw
      await expect(adapter.dispatchRequest(createContext())).resolves.toBeUndefined();
    });

    it('should produce synthetic Err with cause and filterError when exception filter throws', async () => {
      adapter.addExceptionFilters([defineExceptionFilter([], () => () => { throw new Error('filter crash'); })]);
      adapter.initializePipeline(createMockContainer());
      adapter.setPipelineImpl(async () => { throw new Error('pipeline crash'); });
      const receivedResults: unknown[] = [];
      adapter['handleResult'] = mock((result: Result<unknown, unknown>) => { receivedResults.push(result); });

      await adapter.dispatchRequest(createContext());

      expect(adapter['handleResult']).toHaveBeenCalledTimes(1);
      expect(isErr(receivedResults[0])).toBe(true);
      const data = (receivedResults[0] as Err<Record<string, unknown>>).data;
      expect(data.message).toBe('Unhandled error');
      expect((data.cause as Error).message).toBe('pipeline crash');
      expect((data.filterError as Error).message).toBe('filter crash');
    });

    it('should run finalize middlewares on success path', async () => {
      const finalizeFn = mock((_ctx: Context) => {});
      const finalizeAdapter = new TestAdapterWithFinalize([{ handler: finalizeFn }]);
      finalizeAdapter.setPipelineImpl(async () => ({ value: 'ok' }) as Result<unknown, unknown>);
      finalizeAdapter['handleResult'] = mock(() => {});
      finalizeAdapter.initializePipeline(createMockContainer());

      await finalizeAdapter.dispatchRequest(createContext());

      expect(finalizeFn).toHaveBeenCalledTimes(1);
    });

    it('should run finalize middlewares on Err path', async () => {
      const finalizeFn = mock((_ctx: Context) => {});
      const finalizeAdapter = new TestAdapterWithFinalize([{ handler: finalizeFn }]);
      finalizeAdapter.setPipelineImpl(async () => err({ status: 500 }));
      finalizeAdapter['handleResult'] = mock(() => {});
      finalizeAdapter.initializePipeline(createMockContainer());

      await finalizeAdapter.dispatchRequest(createContext());

      expect(finalizeFn).toHaveBeenCalledTimes(1);
    });

    it('should run finalize middlewares on exception path', async () => {
      const finalizeFn = mock((_ctx: Context) => {});
      const finalizeAdapter = new TestAdapterWithFinalize([{ handler: finalizeFn }]);
      finalizeAdapter.setPipelineImpl(async () => { throw new Error('crash'); });
      finalizeAdapter['handleResult'] = mock(() => {});
      finalizeAdapter.initializePipeline(createMockContainer());

      await finalizeAdapter.dispatchRequest(createContext());

      expect(finalizeFn).toHaveBeenCalledTimes(1);
    });

    it('should run finalize middlewares even after emergencyTeardown', async () => {
      const finalizeFn = mock((_ctx: Context) => {});
      const finalizeAdapter = new TestAdapterWithFinalize([{ handler: finalizeFn }]);
      finalizeAdapter.setPipelineImpl(async () => ({ value: 'ok' }) as Result<unknown, unknown>);
      finalizeAdapter['handleResult'] = mock(() => { throw new Error('handle fail'); });
      finalizeAdapter['emergencyTeardown'] = mock(() => {});
      finalizeAdapter.initializePipeline(createMockContainer());

      await finalizeAdapter.dispatchRequest(createContext());

      expect(finalizeAdapter['emergencyTeardown']).toHaveBeenCalledTimes(1);
      expect(finalizeFn).toHaveBeenCalledTimes(1);
    });

    it('should swallow finalize middleware errors', async () => {
      const finalizeAdapter = new TestAdapterWithFinalize([{ handler: () => { throw new Error('finalize crash'); } }]);
      finalizeAdapter.setPipelineImpl(async () => ({ value: 'ok' }) as Result<unknown, unknown>);
      finalizeAdapter['handleResult'] = mock(() => {});
      finalizeAdapter.initializePipeline(createMockContainer());

      await expect(finalizeAdapter.dispatchRequest(createContext())).resolves.toBeUndefined();
    });
  });

  // ── runExceptionFilters ────────────────────────────────────

  describe('runExceptionFilters', () => {
    it('should match filter by error type via instanceof', async () => {
      class DbError extends Error {}

      const filterHandler = mock((_error: DbError, _context: Context): Err<unknown> => {
        return err({ status: 503, message: 'db down' });
      });

      adapter.addExceptionFilters([defineExceptionFilter([DbError], () => filterHandler)]);
      adapter.initializePipeline(createMockContainer());

      const result = await adapter.runExceptionFilters(new DbError(), createContext());

      expect(isErr(result)).toBe(true);
      expect(result.data).toEqual({ status: 503, message: 'db down' });
    });

    it('should skip filter when error type does not match', async () => {
      class SpecificError extends Error {}

      adapter.addExceptionFilters([defineExceptionFilter([SpecificError], () => mock(() => err({ caught: true })))]);
      adapter.initializePipeline(createMockContainer());
      const originalError = new Error('generic');

      const result = await adapter.runExceptionFilters(originalError, createContext());

      expect(result.data).toHaveProperty('message', 'Unhandled error');
      expect(result.data).toHaveProperty('cause', originalError);
    });

    it('should match catch-all filter (empty catchTypes)', async () => {
      const filterHandler = mock((_error: unknown, _context: Context): Err<unknown> => {
        return err({ status: 500, message: 'caught all' });
      });

      adapter.addExceptionFilters([defineExceptionFilter([], () => filterHandler)]);
      adapter.initializePipeline(createMockContainer());

      const result = await adapter.runExceptionFilters(new Error('anything'), createContext());

      expect(result.data).toEqual({ status: 500, message: 'caught all' });
    });

    it('should return synthetic Err when filter returns non-Err', async () => {
      const badFilter = mock((_error: unknown, _context: Context): Err<unknown> => {
        return undefined as unknown as Err<unknown>;
      });

      adapter.addExceptionFilters([defineExceptionFilter([], () => badFilter)]);
      adapter.initializePipeline(createMockContainer());

      const result = await adapter.runExceptionFilters(new Error('test'), createContext());

      expect(isErr(result)).toBe(true);
      expect(result.data).toHaveProperty('message', 'Exception filter must return Err');
    });

    it('should return default error with cause when no filters registered', async () => {
      adapter.initializePipeline(createMockContainer());
      const orphanError = new Error('orphan');

      const result = await adapter.runExceptionFilters(orphanError, createContext());

      expect(isErr(result)).toBe(true);
      expect(result.data).toHaveProperty('message', 'Unhandled error');
      expect(result.data).toHaveProperty('cause', orphanError);
    });

    it('should match filter when error matches second catchType in multi-type filter', async () => {
      class ErrorA extends Error {}
      class ErrorB extends Error {}

      const filterHandler = mock((_error: unknown, _context: Context): Err<unknown> => {
        return err({ matched: 'multi' });
      });

      adapter.addExceptionFilters([defineExceptionFilter([ErrorA, ErrorB], () => filterHandler)]);
      adapter.initializePipeline(createMockContainer());

      const result = await adapter.runExceptionFilters(new ErrorB(), createContext());

      expect(result.data).toEqual({ matched: 'multi' });
      expect(filterHandler).toHaveBeenCalledTimes(1);
    });

    it('should use first matching filter and skip remaining', async () => {
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

      const result = await adapter.runExceptionFilters(new AppError(), createContext());

      expect(order).toEqual(['first']);
      expect(result.data).toEqual({ matched: 'first' });
    });
  });

  // ── addExceptionFilters ──────────────────────────────────

  describe('addExceptionFilters', () => {
    it('should register and resolve exception filter definitions', async () => {
      const filterHandler = mock((_error: unknown, _context: Context): Err<unknown> => {
        return err({ caught: true });
      });

      adapter.addExceptionFilters([defineExceptionFilter([], () => filterHandler)]);
      adapter.initializePipeline(createMockContainer());
      const result = await adapter.runExceptionFilters(new Error('test'), createContext());

      expect(result.data).toEqual({ caught: true });
    });

    it('should return this for chaining', () => {
      expect(adapter.addExceptionFilters([])).toBe(adapter);
    });

    it('should accumulate definitions across multiple calls', async () => {
      class FirstError extends Error {}
      class SecondError extends Error {}

      adapter.addExceptionFilters([defineExceptionFilter([FirstError], () => mock(() => err({ matched: 'first' })))]);
      adapter.addExceptionFilters([defineExceptionFilter([SecondError], () => mock(() => err({ matched: 'second' })))]);
      adapter.initializePipeline(createMockContainer());

      const firstResult = await adapter.runExceptionFilters(new FirstError(), createContext());
      const secondResult = await adapter.runExceptionFilters(new SecondError(), createContext());

      expect(firstResult.data).toEqual({ matched: 'first' });
      expect(secondResult.data).toEqual({ matched: 'second' });
    });
  });

  // ── async handlers ────────────────────────────────────────

  describe('async middleware handlers', () => {
    it('should handle async middleware that returns void', async () => {
      const order: string[] = [];
      const asyncMw = defineMiddleware(() => async (_ctx: Context) => {
        await Promise.resolve();
        order.push('async-mw');
      });

      adapter.addTestMiddlewares('TestPhase', [asyncMw]);
      adapter.initializePipeline(createMockContainer());

      const result = await adapter['runMiddlewares'](
        adapter['resolvedTestMiddlewares'].get('TestPhase')!, createContext(),
      );

      expect(isErr(result)).toBe(false);
      expect(order).toEqual(['async-mw']);
    });

    it('should handle async middleware that returns Err', async () => {
      const asyncMw = defineMiddleware(() => async (_ctx: Context) => {
        await Promise.resolve();
        return err({ halted: true });
      });

      adapter.addTestMiddlewares('TestPhase', [asyncMw]);
      adapter.initializePipeline(createMockContainer());

      const result = await adapter['runMiddlewares'](
        adapter['resolvedTestMiddlewares'].get('TestPhase')!, createContext(),
      );

      expect(isErr(result)).toBe(true);
    });
  });

  describe('async guard handlers', () => {
    it('should handle async guard that allows', async () => {
      const asyncGuard = defineGuard(() => async (_ctx: Context) => {
        await Promise.resolve();
      });

      adapter.addGuards([asyncGuard]);
      adapter.initializePipeline(createMockContainer());
      adapter.setPipelineImpl(async (ctx) => {
        const guardResult = await adapter['runGuards'](ctx);

        if (isErr(guardResult)) {
          return guardResult;
        }

        return { value: 'ok' } as Result<unknown, unknown>;
      });
      adapter['handleResult'] = mock(() => {});

      await adapter.dispatchRequest(createContext());

      expect(adapter['handleResult']).toHaveBeenCalledTimes(1);
    });

    it('should handle async guard that denies', async () => {
      const asyncGuard = defineGuard(() => async (_ctx: Context) => {
        await Promise.resolve();
        return err({ status: 403 });
      });

      adapter.addGuards([asyncGuard]);
      adapter.initializePipeline(createMockContainer());
      adapter['handleResult'] = mock(() => {});

      await adapter.dispatchRequest(createContext());

      expect(adapter['handleResult']).toHaveBeenCalledTimes(1);
      const callResult = (adapter['handleResult'] as ReturnType<typeof mock>).mock.calls[0]![0];
      expect(isErr(callResult)).toBe(true);
    });
  });

  describe('async exception filter', () => {
    it('should handle async exception filter handler', async () => {
      const asyncHandler = mock(async (_error: unknown, _context: Context): Promise<Err<unknown>> => {
        await Promise.resolve();
        return err({ async: true });
      });

      adapter.addExceptionFilters([defineExceptionFilter([], () => asyncHandler)]);
      adapter.initializePipeline(createMockContainer());

      const result = await adapter.runExceptionFilters(new Error('test'), createContext());

      expect(result.data).toEqual({ async: true });
    });
  });
});
