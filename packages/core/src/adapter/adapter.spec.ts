import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { err, isErr } from '@zipbul/result';
import type { Err, Result } from '@zipbul/result';
import type { AdapterContext, ZipbulContainer, ContextKey } from '@zipbul/common';
import type { MiddlewareHandlerFn } from '@zipbul/common';
import { contextKey, defineMiddleware } from '@zipbul/common';
import { defineGuard } from '@zipbul/common';
import { defineExceptionFilter } from '@zipbul/common';
import { Adapter, type ResolvedGuard, type ResolvedMiddleware, type ResolvedExceptionFilter, type ResolvedValidationEntry, type PipelineStepFn, handlerResultKey } from './adapter';

type Context = AdapterContext;

/** Minimal concrete adapter for testing Common base class behavior. */
class TestAdapter extends Adapter {
  static readonly validPhases: ReadonlySet<string> = new Set(['TestPhase']);
  readonly decorators = { controller: () => {}, handlers: [] };

  private pipelineImpl: ((ctx: Context) => Promise<void> | void) | undefined;

  protected emergencyTeardown(_context: Context, _error?: unknown) {}

  protected async executePipeline(context: Context): Promise<void> {
    if (this.pipelineImpl !== undefined) {
      return this.pipelineImpl(context);
    }

    // Default: run TestPhase middlewares → guards
    const mwResult = await this.runMiddlewares(
      this.getPhaseMiddlewares('TestPhase'), context,
    );

    if (isErr(mwResult)) {
      return;
    }

    const guardResult = await this.runGuards(this['resolvedGuards'], context);

    if (isErr(guardResult)) {
      return;
    }
  }

  setPipelineImpl(impl: (ctx: Context) => Promise<void> | void): void {
    this.pipelineImpl = impl;
  }

  exposeResolveMiddlewareKeys(keys: readonly string[]): ResolvedMiddleware[] {
    return this.resolveMiddlewareKeys(keys);
  }

  exposeResolveGuardKeys(keys: readonly string[]): ResolvedGuard[] {
    return this.resolveGuardKeys(keys);
  }

  exposeResolveExceptionFilterKeys(keys: readonly string[]): ResolvedExceptionFilter[] {
    return this.resolveExceptionFilterKeys(keys);
  }

  exposeExecuteExceptionFilterChain(chain: readonly ResolvedExceptionFilter[], error: unknown, context: Context) {
    return this.executeExceptionFilterChain(chain, error, context);
  }

  exposeResolveStepFns(
    steps: readonly string[],
    adapterSteps: ReadonlyMap<string, PipelineStepFn>,
    guards: readonly ResolvedGuard[],
    validations: readonly ResolvedValidationEntry[],
  ) {
    return this.resolveStepFns(steps, adapterSteps, guards, validations);
  }

  exposeRunPipeline(
    context: Context,
    pre: readonly PipelineStepFn[],
    handler: PipelineStepFn,
    post: readonly PipelineStepFn[],
    filters: readonly ResolvedExceptionFilter[],
  ) {
    return this.runPipeline(context, pre, handler, post, filters);
  }

  exposeRunValidations(validations: readonly ResolvedValidationEntry[], context: Context) {
    return this.runValidations(validations, context);
  }

  exposeWrapValidationError(key: ContextKey<unknown>, thrown: unknown) {
    return this.wrapValidationError(key, thrown);
  }

  async start() {}
  async stop() {}
}

class AnotherAdapter extends Adapter {
  static readonly validPhases: ReadonlySet<string> = new Set();
  readonly decorators = { controller: () => {}, handlers: [] };
  protected emergencyTeardown(_context: Context) {}
  protected async executePipeline(_context: Context): Promise<void> {}
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
  const store = new Map<symbol, unknown>();

  return {
    getType: () => 'test',
    get: key => store.get(key as symbol),
    set: (key, value) => { store.set(key as symbol, value); },
    use(key) {
      const value = store.get(key as symbol);
      if (value === undefined) throw new Error(`Context key not set: ${String(key)}`);
      return value;
    },
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

function createRegistryContainer(entries: Readonly<Record<string, unknown>>): ZipbulContainer {
  return {
    get: (token: string) => entries[token],
    set: () => {},
    has: (token: string) => Object.prototype.hasOwnProperty.call(entries, token),
    getInstances: () => [][Symbol.iterator](),
    keys: () => Object.keys(entries)[Symbol.iterator](),
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
      adapter.applyMiddlewareConfig({ TestPhase: [mw(handler)] });
      adapter.initializePipeline(createMockContainer());

      const result = await adapter['runMiddlewares'](
        adapter['getPhaseMiddlewares']('TestPhase'), createContext(),
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
      adapter.applyMiddlewareConfig({ TestPhase: [mw(h1), mw(h2), mw(h3)] });
      adapter.initializePipeline(createMockContainer());

      await adapter['runMiddlewares'](
        adapter['getPhaseMiddlewares']('TestPhase'), createContext(),
      );

      expect(order).toEqual(['1', '2', '3']);
    });

    it('should return Err when middleware returns err', async () => {
      const handler = mock((_ctx: Context) => err({ reason: 'test_halt' }));
      adapter.applyMiddlewareConfig({ TestPhase: [mw(handler)] });
      adapter.initializePipeline(createMockContainer());

      const result = await adapter['runMiddlewares'](
        adapter['getPhaseMiddlewares']('TestPhase'), createContext(),
      );

      expect(isErr(result)).toBe(true);
    });

    it('should skip second middleware when first returns err', async () => {
      const h1 = mock((_ctx: Context) => err({ reason: 'halt' }));
      const h2 = mock((_ctx: Context) => {});
      adapter.applyMiddlewareConfig({ TestPhase: [mw(h1), mw(h2)] });
      adapter.initializePipeline(createMockContainer());

      const result = await adapter['runMiddlewares'](
        adapter['getPhaseMiddlewares']('TestPhase'), createContext(),
      );

      expect(isErr(result)).toBe(true);
      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).not.toHaveBeenCalled();
    });

    it('should propagate rejection when middleware throws', async () => {
      const handler = mock((_ctx: Context) => {
        throw new Error('middleware crash');
      });
      adapter.applyMiddlewareConfig({ TestPhase: [mw(handler)] });
      adapter.initializePipeline(createMockContainer());

      await expect(
        adapter['runMiddlewares'](
          adapter['getPhaseMiddlewares']('TestPhase'), createContext(),
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
      adapter.applyMiddlewareConfig({ TestPhase: handlers.map(handler => mw(handler)) });
      adapter.initializePipeline(createMockContainer());

      await adapter['runMiddlewares'](
        adapter['getPhaseMiddlewares']('TestPhase'), createContext(),
      );

      expect(handlers[0]).toHaveBeenCalledTimes(1);
      expect(handlers[1]).toHaveBeenCalledTimes(1);
      expect(handlers[2]).toHaveBeenCalledTimes(1);
      expect(handlers[3]).not.toHaveBeenCalled();
      expect(handlers[4]).not.toHaveBeenCalled();
    });

    it('should preserve combined order when applyMiddlewareConfig called twice', async () => {
      const order: string[] = [];
      const hA = mock((_ctx: Context) => { order.push('A'); });
      const hB = mock((_ctx: Context) => { order.push('B'); });
      const hC = mock((_ctx: Context) => { order.push('C'); });
      adapter.applyMiddlewareConfig({ TestPhase: [mw(hA), mw(hB)] });
      adapter.applyMiddlewareConfig({ TestPhase: [mw(hC)] });
      adapter.initializePipeline(createMockContainer());

      await adapter['runMiddlewares'](
        adapter['getPhaseMiddlewares']('TestPhase'), createContext(),
      );

      expect(order).toEqual(['A', 'B', 'C']);
    });

    it('should pass same context object reference to every middleware', async () => {
      const h1 = mock((_ctx: Context) => {});
      const h2 = mock((_ctx: Context) => {});
      adapter.applyMiddlewareConfig({ TestPhase: [mw(h1), mw(h2)] });
      adapter.initializePipeline(createMockContainer());
      const ctx = createContext();

      await adapter['runMiddlewares'](
        adapter['getPhaseMiddlewares']('TestPhase'), ctx,
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

      expect(adapter['getPhaseMiddlewares']('TestPhase')).toHaveLength(1);
    });

    it('should throw on invalid phase key', () => {
      const def = defineMiddleware(() => (_ctx: Context) => {});
      expect(() => adapter.applyMiddlewareConfig({ InvalidPhase: [def] })).toThrow(/Invalid middleware phase 'InvalidPhase'/);
    });

    it('should accumulate across multiple calls', () => {
      const def1 = defineMiddleware(() => (_ctx: Context) => {});
      const def2 = defineMiddleware(() => (_ctx: Context) => {});

      adapter.applyMiddlewareConfig({ TestPhase: [def1] });
      adapter.applyMiddlewareConfig({ TestPhase: [def2] });
      adapter.initializePipeline(createMockContainer());

      expect(adapter['getPhaseMiddlewares']('TestPhase')).toHaveLength(2);
    });

    it('should throw when validPhases is not declared', () => {
      class NoPhaseAdapter extends Adapter {
        readonly decorators = { controller: () => {}, handlers: [] };
        protected emergencyTeardown() {}
        protected async executePipeline(): Promise<Result<unknown, unknown>> {
          return undefined as unknown as Result<unknown, unknown>;
        }
        async start() {}
        async stop() {}
      }
      const noPhase = new NoPhaseAdapter();
      expect(() => noPhase.applyMiddlewareConfig({ X: [] })).toThrow(/must declare static validPhases/);
    });
  });

  describe('getPhaseMiddlewares', () => {
    it('should return empty array for unregistered phase', () => {
      adapter.initializePipeline(createMockContainer());
      expect(adapter['getPhaseMiddlewares']('TestPhase')).toEqual([]);
    });
  });

  describe('registerMiddleware', () => {
    it('should validate adapter compatibility', () => {
      const incompatibleMw = defineMiddleware([AnotherAdapter], () => (_ctx: Context) => {});
      expect(() => adapter['registerMiddleware']('TestPhase', [incompatibleMw])).toThrow(/AnotherAdapter.*TestAdapter/);
    });

    it('should throw on invalid phase', () => {
      const def = defineMiddleware(() => (_ctx: Context) => {});
      expect(() => adapter['registerMiddleware']('BadPhase', [def])).toThrow(/Invalid middleware phase/);
    });
  });

  describe('resolve AOT keys', () => {
    it('should resolve middleware definition keys into ready handlers', async () => {
      const handler = mock((_ctx: Context) => {});
      const container = createRegistryContainer({
        mw1: defineMiddleware(() => handler),
      });

      adapter.initializePipeline(container);

      const resolved = adapter.exposeResolveMiddlewareKeys(['mw1']);

      expect(resolved).toHaveLength(1);
      await resolved[0]!.handler(createContext());
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should resolve guard definition keys into ready handlers', async () => {
      const handler = mock((_ctx: Context) => {});
      const container = createRegistryContainer({
        gd1: defineGuard(() => handler),
      });

      adapter.initializePipeline(container);

      const resolved = adapter.exposeResolveGuardKeys(['gd1']);

      expect(resolved).toHaveLength(1);
      await resolved[0]!.handler(createContext());
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should resolve exception filter definition keys into ready handlers', async () => {
      class TestError extends Error {}

      const handler = mock((_error: TestError, _ctx: Context) => err({ handled: true }));
      const container = createRegistryContainer({
        ef1: defineExceptionFilter([TestError], () => handler),
      });

      adapter.initializePipeline(container);

      const resolved = adapter.exposeResolveExceptionFilterKeys(['ef1']);

      expect(resolved).toHaveLength(1);
      expect(resolved[0]!.catchTypes).toEqual([TestError]);
      await resolved[0]!.handler(new TestError(), createContext());
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should throw when resolving keys before initializePipeline', () => {
      expect(() => adapter.exposeResolveMiddlewareKeys(['mw1'])).toThrow(/initializePipeline/);
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

  // ── dispatchRequest — pipeline + finalize ──────────────────

  describe('dispatchRequest', () => {
    it('should execute pipeline and complete without error', async () => {
      const order: string[] = [];
      adapter.setPipelineImpl(async () => {
        order.push('pipeline');
        return { value: 'ok' } as Result<unknown, unknown>;
      });
      adapter.initializePipeline(createMockContainer());

      await adapter.dispatchRequest(createContext());

      expect(order).toEqual(['pipeline']);
    });

    it('should call emergencyTeardown when pipeline throws', async () => {
      adapter.initializePipeline(createMockContainer());
      adapter.setPipelineImpl(async () => { throw new Error('pipeline error'); });
      adapter['emergencyTeardown'] = mock(() => {});

      await adapter.dispatchRequest(createContext());

      expect(adapter['emergencyTeardown']).toHaveBeenCalledTimes(1);
    });

    it('should swallow emergencyTeardown errors', async () => {
      adapter.initializePipeline(createMockContainer());
      adapter.setPipelineImpl(async () => { throw new Error('crash'); });
      adapter['emergencyTeardown'] = mock(() => { throw new Error('teardown fail'); });

      await expect(adapter.dispatchRequest(createContext())).resolves.toBeUndefined();
    });

    it('should run finalize middlewares on success path', async () => {
      const finalizeFn = mock((_ctx: Context) => {});
      const finalizeAdapter = new TestAdapterWithFinalize([{ handler: finalizeFn }]);
      finalizeAdapter.setPipelineImpl(async () => ({ value: 'ok' }) as Result<unknown, unknown>);
      finalizeAdapter.initializePipeline(createMockContainer());

      await finalizeAdapter.dispatchRequest(createContext());

      expect(finalizeFn).toHaveBeenCalledTimes(1);
    });

    it('should run finalize middlewares on Err path', async () => {
      const finalizeFn = mock((_ctx: Context) => {});
      const finalizeAdapter = new TestAdapterWithFinalize([{ handler: finalizeFn }]);
      finalizeAdapter.setPipelineImpl(async () => err({ status: 500 }));
      finalizeAdapter.initializePipeline(createMockContainer());

      await finalizeAdapter.dispatchRequest(createContext());

      expect(finalizeFn).toHaveBeenCalledTimes(1);
    });

    it('should run finalize middlewares on exception path', async () => {
      const finalizeFn = mock((_ctx: Context) => {});
      const finalizeAdapter = new TestAdapterWithFinalize([{ handler: finalizeFn }]);
      finalizeAdapter.setPipelineImpl(async () => { throw new Error('crash'); });
      finalizeAdapter.initializePipeline(createMockContainer());

      await finalizeAdapter.dispatchRequest(createContext());

      expect(finalizeFn).toHaveBeenCalledTimes(1);
    });

    it('should run finalize middlewares even after emergencyTeardown', async () => {
      const finalizeFn = mock((_ctx: Context) => {});
      const finalizeAdapter = new TestAdapterWithFinalize([{ handler: finalizeFn }]);
      finalizeAdapter.setPipelineImpl(async () => { throw new Error('crash'); });
      finalizeAdapter['emergencyTeardown'] = mock(() => {});
      finalizeAdapter.initializePipeline(createMockContainer());

      await finalizeAdapter.dispatchRequest(createContext());

      expect(finalizeAdapter['emergencyTeardown']).toHaveBeenCalledTimes(1);
      expect(finalizeFn).toHaveBeenCalledTimes(1);
    });

    it('should swallow finalize middleware errors', async () => {
      const finalizeAdapter = new TestAdapterWithFinalize([{ handler: () => { throw new Error('finalize crash'); } }]);
      finalizeAdapter.setPipelineImpl(async () => ({ value: 'ok' }) as Result<unknown, unknown>);
      finalizeAdapter.initializePipeline(createMockContainer());

      await expect(finalizeAdapter.dispatchRequest(createContext())).resolves.toBeUndefined();
    });
  });

  // ── runExceptionFilters ────────────────────────────────────

  describe('executeExceptionFilterChain', () => {
    it('should match filter by error type via instanceof', async () => {
      class DbError extends Error {}

      const filterHandler = mock((_error: DbError, _context: Context): Err<unknown> => {
        return err({ status: 503, message: 'db down' });
      });

      adapter.addExceptionFilters([defineExceptionFilter([DbError], () => filterHandler)]);
      adapter.initializePipeline(createMockContainer());

      const result = await adapter.exposeExecuteExceptionFilterChain(adapter['resolvedExceptionFilters'], new DbError(), createContext());

      expect(isErr(result)).toBe(true);
      expect(result.data).toEqual({ status: 503, message: 'db down' });
    });

    it('should skip filter when error type does not match', async () => {
      class SpecificError extends Error {}

      adapter.addExceptionFilters([defineExceptionFilter([SpecificError], () => mock(() => err({ caught: true })))]);
      adapter.initializePipeline(createMockContainer());
      const originalError = new Error('generic');

      const result = await adapter.exposeExecuteExceptionFilterChain(adapter['resolvedExceptionFilters'], originalError, createContext());

      expect(result.data).toHaveProperty('message', 'Unhandled error');
      expect(result.data).toHaveProperty('cause', originalError);
    });

    it('should match catch-all filter (empty catchTypes)', async () => {
      const filterHandler = mock((_error: unknown, _context: Context): Err<unknown> => {
        return err({ status: 500, message: 'caught all' });
      });

      adapter.addExceptionFilters([defineExceptionFilter([], () => filterHandler)]);
      adapter.initializePipeline(createMockContainer());

      const result = await adapter.exposeExecuteExceptionFilterChain(adapter['resolvedExceptionFilters'], new Error('anything'), createContext());

      expect(result.data).toEqual({ status: 500, message: 'caught all' });
    });

    it('should return synthetic Err when filter returns non-Err', async () => {
      const badFilter = mock((_error: unknown, _context: Context): Err<unknown> => {
        return undefined as unknown as Err<unknown>;
      });

      adapter.addExceptionFilters([defineExceptionFilter([], () => badFilter)]);
      adapter.initializePipeline(createMockContainer());

      const result = await adapter.exposeExecuteExceptionFilterChain(adapter['resolvedExceptionFilters'], new Error('test'), createContext());

      expect(isErr(result)).toBe(true);
      expect(result.data).toHaveProperty('message', 'Exception filter must return Err');
    });

    it('should return default error with cause when no filters registered', async () => {
      adapter.initializePipeline(createMockContainer());
      const orphanError = new Error('orphan');

      const result = await adapter.exposeExecuteExceptionFilterChain(adapter['resolvedExceptionFilters'], orphanError, createContext());

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

      const result = await adapter.exposeExecuteExceptionFilterChain(adapter['resolvedExceptionFilters'], new ErrorB(), createContext());

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

      const result = await adapter.exposeExecuteExceptionFilterChain(adapter['resolvedExceptionFilters'], new AppError(), createContext());

      expect(order).toEqual(['first']);
      expect(result.data).toEqual({ matched: 'first' });
    });
  });

  describe('executeExceptionFilterChain — global fallback', () => {
    it('should use global filters when no bound chain exists', async () => {
      const globalHandler = mock((_error: unknown, _ctx: Context): Err<unknown> => {
        return err({ source: 'global' });
      });

      adapter.addExceptionFilters([defineExceptionFilter([], () => globalHandler)]);
      adapter.initializePipeline(createMockContainer());

      const result = await adapter.exposeExecuteExceptionFilterChain(adapter['resolvedExceptionFilters'], new Error('test'), createContext());

      expect(result.data).toEqual({ source: 'global' });
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
      const result = await adapter.exposeExecuteExceptionFilterChain(adapter['resolvedExceptionFilters'], new Error('test'), createContext());

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

      const firstResult = await adapter.exposeExecuteExceptionFilterChain(adapter['resolvedExceptionFilters'], new FirstError(), createContext());
      const secondResult = await adapter.exposeExecuteExceptionFilterChain(adapter['resolvedExceptionFilters'], new SecondError(), createContext());

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

      adapter.applyMiddlewareConfig({ TestPhase: [asyncMw] });
      adapter.initializePipeline(createMockContainer());

      const result = await adapter['runMiddlewares'](
        adapter['getPhaseMiddlewares']('TestPhase'), createContext(),
      );

      expect(isErr(result)).toBe(false);
      expect(order).toEqual(['async-mw']);
    });

    it('should handle async middleware that returns Err', async () => {
      const asyncMw = defineMiddleware(() => async (_ctx: Context) => {
        await Promise.resolve();
        return err({ halted: true });
      });

      adapter.applyMiddlewareConfig({ TestPhase: [asyncMw] });
      adapter.initializePipeline(createMockContainer());

      const result = await adapter['runMiddlewares'](
        adapter['getPhaseMiddlewares']('TestPhase'), createContext(),
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

      await adapter.dispatchRequest(createContext());
    });

    it('should handle async guard that denies', async () => {
      const asyncGuard = defineGuard(() => async (_ctx: Context) => {
        await Promise.resolve();
        return err({ status: 403 });
      });

      adapter.addGuards([asyncGuard]);
      adapter.initializePipeline(createMockContainer());

      const context = createContext();
      await adapter.dispatchRequest(context);
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

      const result = await adapter.exposeExecuteExceptionFilterChain(adapter['resolvedExceptionFilters'], new Error('test'), createContext());

      expect(result.data).toEqual({ async: true });
    });
  });

  // =======================================================================
  // runPipeline
  // =======================================================================

  describe('runPipeline', () => {
    it('should execute pre steps sequentially then handler', async () => {
      adapter.initializePipeline(createMockContainer());
      const order: string[] = [];
      const ctx = createContext();

      await adapter.exposeRunPipeline(
        ctx,
        [
          async () => { order.push('pre1'); },
          async () => { order.push('pre2'); },
        ],
        async () => { order.push('handler'); return 'ok'; },
        [],
        [],
      );

      expect(order).toEqual(['pre1', 'pre2', 'handler']);
    });

    it('should short-circuit pre steps on Err and skip handler', async () => {
      adapter.initializePipeline(createMockContainer());
      const order: string[] = [];
      const ctx = createContext();

      await adapter.exposeRunPipeline(
        ctx,
        [
          async () => { order.push('pre1'); return err('blocked'); },
          async () => { order.push('pre2'); },
        ],
        async () => { order.push('handler'); return 'ok'; },
        [],
        [],
      );

      expect(order).toEqual(['pre1']);
      expect(ctx.get(handlerResultKey)).toEqual(err('blocked'));
    });

    it('should set handlerResultKey on context after handler execution', async () => {
      adapter.initializePipeline(createMockContainer());
      const ctx = createContext();

      await adapter.exposeRunPipeline(
        ctx,
        [],
        async () => 'handler-result',
        [],
        [],
      );

      expect(ctx.get(handlerResultKey)).toBe('handler-result');
    });

    it('should execute post steps after handler', async () => {
      adapter.initializePipeline(createMockContainer());
      const order: string[] = [];
      const ctx = createContext();

      await adapter.exposeRunPipeline(
        ctx,
        [],
        async () => { order.push('handler'); return 'ok'; },
        [
          async () => { order.push('post1'); },
          async () => { order.push('post2'); },
        ],
        [],
      );

      expect(order).toEqual(['handler', 'post1', 'post2']);
    });

    it('should run exception filter chain when pre step throws', async () => {
      adapter.initializePipeline(createMockContainer());
      const ctx = createContext();
      const testError = new Error('pre-throw');

      const filters: ResolvedExceptionFilter[] = [{
        handler: (_error, _ctx) => err({ caught: true }),
        catchTypes: [],
      }];

      await adapter.exposeRunPipeline(
        ctx,
        [async () => { throw testError; }],
        async () => 'ok',
        [],
        filters,
      );

      const result = ctx.get(handlerResultKey) as Err<{ caught: boolean }>;
      expect(isErr(result)).toBe(true);
      expect(result.data).toEqual({ caught: true });
    });

    it('should run exception filter chain when handler throws', async () => {
      adapter.initializePipeline(createMockContainer());
      const ctx = createContext();

      const filters: ResolvedExceptionFilter[] = [{
        handler: (_error, _ctx) => err({ caught: 'handler-error' }),
        catchTypes: [],
      }];

      await adapter.exposeRunPipeline(
        ctx,
        [],
        async () => { throw new Error('handler-throw'); },
        [],
        filters,
      );

      const result = ctx.get(handlerResultKey) as Err<{ caught: string }>;
      expect(isErr(result)).toBe(true);
      expect(result.data).toEqual({ caught: 'handler-error' });
    });

    it('should call emergencyTeardown when post step throws', async () => {
      const teardownFn = mock(() => {});
      adapter.emergencyTeardown = teardownFn;
      adapter.initializePipeline(createMockContainer());
      const ctx = createContext();
      const postError = new Error('post-throw');

      await adapter.exposeRunPipeline(
        ctx,
        [],
        async () => 'ok',
        [async () => { throw postError; }],
        [],
      );

      expect(teardownFn).toHaveBeenCalledWith(ctx, postError);
    });

    it('should swallow emergencyTeardown error during post failure', async () => {
      adapter.emergencyTeardown = () => { throw new Error('teardown-throw'); };
      adapter.initializePipeline(createMockContainer());
      const ctx = createContext();

      // Should not throw
      await adapter.exposeRunPipeline(
        ctx,
        [],
        async () => 'ok',
        [async () => { throw new Error('post-throw'); }],
        [],
      );

      expect(ctx.get(handlerResultKey)).toBe('ok');
    });

    it('should set handlerResultKey before post steps execute', async () => {
      adapter.initializePipeline(createMockContainer());
      const ctx = createContext();
      let resultDuringPost: unknown;

      await adapter.exposeRunPipeline(
        ctx,
        [],
        async () => 'the-result',
        [async (postCtx) => { resultDuringPost = postCtx.get(handlerResultKey); }],
        [],
      );

      expect(resultDuringPost).toBe('the-result');
    });

    it('should set undefined handlerResultKey when handler returns void', async () => {
      adapter.initializePipeline(createMockContainer());
      const ctx = createContext();

      await adapter.exposeRunPipeline(
        ctx,
        [],
        async () => {},
        [],
        [],
      );

      expect(ctx.get(handlerResultKey)).toBeUndefined();
    });

    it('should continue pre steps when step returns undefined', async () => {
      adapter.initializePipeline(createMockContainer());
      const order: string[] = [];
      const ctx = createContext();

      await adapter.exposeRunPipeline(
        ctx,
        [
          async () => { order.push('pre1'); return undefined; },
          async () => { order.push('pre2'); },
        ],
        async () => { order.push('handler'); },
        [],
        [],
      );

      expect(order).toEqual(['pre1', 'pre2', 'handler']);
    });

    it('should skip remaining post steps when a post step throws', async () => {
      const teardownFn = mock(() => {});
      adapter.emergencyTeardown = teardownFn;
      adapter.initializePipeline(createMockContainer());
      const order: string[] = [];
      const ctx = createContext();

      await adapter.exposeRunPipeline(
        ctx,
        [],
        async () => { order.push('handler'); },
        [
          async () => { order.push('post1'); throw new Error('post1-throw'); },
          async () => { order.push('post2'); },
        ],
        [],
      );

      expect(order).toEqual(['handler', 'post1']);
      expect(teardownFn).toHaveBeenCalled();
    });

    it('should execute post steps even when pre returns Err', async () => {
      adapter.initializePipeline(createMockContainer());
      const order: string[] = [];
      const ctx = createContext();

      await adapter.exposeRunPipeline(
        ctx,
        [async () => { order.push('pre'); return err('fail'); }],
        async () => { order.push('handler'); },
        [async () => { order.push('post'); }],
        [],
      );

      expect(order).toEqual(['pre', 'post']);
    });
  });

  // ── resolveStepFns ─────────────────────────────────────────

  describe('resolveStepFns', () => {
    let adapter: TestAdapter;

    beforeEach(() => {
      adapter = new TestAdapter();
      adapter.initializePipeline(createMockContainer());
    });

    it('should map adapter step names to their corresponding functions', () => {
      // Arrange
      const stepFn: PipelineStepFn = () => undefined;
      const adapterSteps = new Map<string, PipelineStepFn>([['Parse', stepFn]]);

      // Act
      const result = adapter.exposeResolveStepFns(['Parse'], adapterSteps, [], []);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(stepFn);
    });

    it('should map CoreStep.Guard to a function that calls runGuards', async () => {
      // Arrange
      const guardCalled = mock(() => undefined);
      const guards: ResolvedGuard[] = [{ handler: guardCalled }];
      const adapterSteps = new Map<string, PipelineStepFn>();

      // Act
      const result = adapter.exposeResolveStepFns(['Guard'], adapterSteps, guards, []);
      const ctx = createContext();
      await result[0]!(ctx);

      // Assert
      expect(result).toHaveLength(1);
      expect(guardCalled).toHaveBeenCalledWith(ctx);
    });

    it('should map CoreStep.Validation to a callable step function', async () => {
      // Arrange
      const validations: ResolvedValidationEntry[] = [];
      const adapterSteps = new Map<string, PipelineStepFn>();

      // Act
      const result = adapter.exposeResolveStepFns(['Validation'], adapterSteps, [], validations);
      const ctx = createContext();
      const stepResult = await result[0]!(ctx);

      // Assert
      expect(result).toHaveLength(1);
      expect(stepResult).toBeUndefined();
    });

    it('should preserve step ordering in the output array', () => {
      // Arrange
      const order: string[] = [];
      const parseFn: PipelineStepFn = () => { order.push('parse'); };
      const writeFn: PipelineStepFn = () => { order.push('write'); };
      const adapterSteps = new Map<string, PipelineStepFn>([
        ['Parse', parseFn],
        ['Write', writeFn],
      ]);
      const guardCalled = mock(() => undefined);
      const guards: ResolvedGuard[] = [{ handler: guardCalled }];

      // Act
      const result = adapter.exposeResolveStepFns(
        ['Parse', 'Guard', 'Write'],
        adapterSteps,
        guards,
        [],
      );

      // Assert
      expect(result).toHaveLength(3);
      expect(result[0]).toBe(parseFn);
      expect(result[2]).toBe(writeFn);
    });

    it('should return empty array for empty steps', () => {
      // Arrange & Act
      const result = adapter.exposeResolveStepFns([], new Map(), [], []);

      // Assert
      expect(result).toEqual([]);
    });

    it('should throw when CoreStep.Handler appears in steps', () => {
      // Arrange
      const adapterSteps = new Map<string, PipelineStepFn>();

      // Act & Assert
      expect(() => adapter.exposeResolveStepFns(['Handler'], adapterSteps, [], []))
        .toThrow(/CoreStep\.Handler must not appear in resolved step arrays/);
    });

    it('should throw when an unknown step is not registered in adapterSteps', () => {
      // Arrange
      const adapterSteps = new Map<string, PipelineStepFn>();

      // Act & Assert
      expect(() => adapter.exposeResolveStepFns(['NonExistent'], adapterSteps, [], []))
        .toThrow(/Unknown pipeline step 'NonExistent'/);
    });
  });

  // ── createContext: use / validated ──────────────────────────

  describe('createContext helpers', () => {
    it('use() should return value when key is set', () => {
      const ctx = createContext();
      const key = contextKey<string>('test');
      ctx.set(key, 'hello');

      expect(ctx.use(key)).toBe('hello');
    });

    it('use() should throw when key is not set', () => {
      const ctx = createContext();
      const key = contextKey<string>('missing');

      expect(() => ctx.use(key)).toThrow();
    });

  });

  // ── wrapValidationError ──────────────────────────────────────

  describe('wrapValidationError', () => {
    it('should re-throw the error by default', () => {
      const adapter = new TestAdapter();
      adapter.initializePipeline(createMockContainer());
      const key = contextKey<unknown>('test.body');
      const bakerError = new Error('validation failed');

      expect(() => adapter.exposeWrapValidationError(key, bakerError)).toThrow(bakerError);
    });
  });

  // ── runValidations ────────────────────────────────────────────

  describe('runValidations', () => {
    let adapter: TestAdapter;

    beforeEach(() => {
      adapter = new TestAdapter();
      adapter.initializePipeline(createMockContainer());
    });

    it('should return undefined when validations array is empty', async () => {
      const ctx = createContext();
      const result = await adapter.exposeRunValidations([], ctx);

      expect(result).toBeUndefined();
    });
  });

  // ── resolveStepFns edge cases ─────────────────────────────────

  describe('resolveStepFns additional edge cases', () => {
    let adapter: TestAdapter;

    beforeEach(() => {
      adapter = new TestAdapter();
      adapter.initializePipeline(createMockContainer());
    });

    it('should create a callable guard step even with empty guards array', async () => {
      const adapterSteps = new Map<string, PipelineStepFn>();
      const result = adapter.exposeResolveStepFns(['Guard'], adapterSteps, [], []);

      const ctx = createContext();
      const stepResult = await result[0]!(ctx);

      // Empty guards → runGuards returns undefined (no-op)
      expect(stepResult).toBeUndefined();
    });

    it('should create a callable validation step even with empty validations array', async () => {
      const adapterSteps = new Map<string, PipelineStepFn>();
      const result = adapter.exposeResolveStepFns(['Validation'], adapterSteps, [], []);

      const ctx = createContext();
      const stepResult = await result[0]!(ctx);

      // Empty validations → runValidations returns undefined (no-op)
      expect(stepResult).toBeUndefined();
    });

    it('should resolve mixed core and adapter steps in correct order', async () => {
      const order: string[] = [];
      const parseFn: PipelineStepFn = () => { order.push('parse'); };
      const writeFn: PipelineStepFn = () => { order.push('write'); };
      const adapterSteps = new Map<string, PipelineStepFn>([
        ['Parse', parseFn],
        ['Write', writeFn],
      ]);

      const guardHandler = mock(() => { order.push('guard'); });
      const guards: ResolvedGuard[] = [{ handler: guardHandler }];

      const result = adapter.exposeResolveStepFns(
        ['Parse', 'Guard', 'Validation', 'Write'],
        adapterSteps,
        guards,
        [],
      );

      const ctx = createContext();
      for (const step of result) {
        await step(ctx);
      }

      expect(order).toEqual(['parse', 'guard', 'write']);
    });
  });
});
