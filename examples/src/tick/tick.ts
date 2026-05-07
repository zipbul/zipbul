/**
 * Inline TickAdapter — a complete, contract-compliant user-app adapter
 * compiled in-place. Demonstrates that a project can ship its own adapter
 * inside `src/` without splitting into a separate `kind: "adapter"`
 * package, and that the inline adapter participates in the full Zipbul
 * pipeline contract:
 *
 * - `dispatchRequest` wraps each handler invocation in `runInAdapterContext`
 *   so handler code can call `getAdapterContext()`.
 * - `executePipeline` runs broad OnTick middleware (handles runtime-
 *   registered middleware skipped by AOT dead-step elimination), then
 *   delegates to `Adapter.runPipeline` with handler-scoped pre/post —
 *   guards, exception filters, and middleware all honoured.
 * - Real periodic transport: a `setInterval` schedules tick rounds at
 *   `intervalMs` cadence; `stop()` clears the timer and waits for any
 *   in-flight tick to drain.
 *
 * Cycle-free by construction — the entire adapter (enums + context +
 * decorators + class + definition) lives in this single module. Dispatch
 * state never bleeds onto the public context surface — it's carried in a
 * `WeakMap` keyed by the per-tick `TickContext` instance.
 */
import {
  Adapter,
  CoreStep,
  getBootstrapState,
  type PipelineStepFn,
  type ResolvedExceptionFilter,
  type ResolvedGuard,
  type ResolvedMiddleware,
} from '@zipbul/core';
import {
  ContextError,
  defineAdapter,
  type AdapterContext,
  type AdapterEntryDecorators,
  type ApplicationContext,
  type ClassToken,
  type CompiledHandlerEntry,
  type ContextKey,
  type MiddlewareDefinition,
} from '@zipbul/common';
import { isErr } from '@zipbul/result';
import { Logger } from '@zipbul/logger';

/** Namespaced context-type identifier — avoids collision with other adapters
 *  that might also use the bare label `"tick"`. */
const TICK_CONTEXT_TYPE = 'zipbul.examples.tick';

export const TickPhase = {
  OnTick: 'TickOnTick',
} as const;

/** Type alias for the phase value union — single source of truth. */
export type TickPhaseValue = typeof TickPhase[keyof typeof TickPhase];

export const TickStep = {
  Dispatch: 'TickDispatch',
} as const;

export interface TickAdapterOptions {
  /** Tick interval in milliseconds. Default 1000. */
  readonly intervalMs?: number;
  /** Maximum number of tick rounds before automatic stop. Default Infinity. */
  readonly maxRounds?: number;
}

interface ResolvedRoutePipeline {
  readonly pre: readonly PipelineStepFn[];
  readonly post: readonly PipelineStepFn[];
  readonly filters: readonly ResolvedExceptionFilter[];
}

interface DispatchState {
  readonly entry: CompiledHandlerEntry;
  readonly instance: object;
  readonly pipeline: ResolvedRoutePipeline;
}

/**
 * Per-context dispatch state, keyed by `TickContext` instance. WeakMap
 * keeps state hidden from the public context surface — handlers cannot
 * read or mutate it. Garbage-collected when the context goes out of scope.
 */
const dispatchStates = new WeakMap<TickContext, DispatchState>();

/**
 * TickContext — minimal AdapterContext implementation. Carries only the
 * tick timestamp and round number on its public surface.
 */
export class TickContext implements AdapterContext {
  private readonly store = new Map<symbol, unknown>();

  constructor(
    public readonly tickedAt: number,
    public readonly round: number,
  ) {}

  getType(): string {
    return TICK_CONTEXT_TYPE;
  }

  get<T>(key: ContextKey<T>): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  set<T>(key: ContextKey<T>, value: T): void {
    this.store.set(key, value);
  }

  use<T>(key: ContextKey<T>): T {
    if (!this.store.has(key)) {
      throw new ContextError(`Context key not set: ${String(key)}`);
    }
    return this.store.get(key) as T;
  }

  to<T>(ctor: ClassToken<T>): T {
    if ((ctor as unknown) === TickContext) {
      return this as unknown as T;
    }
    throw new ContextError(`Context cast failed: ${ctor.name || 'UnknownContext'}`);
  }
}

/** Marks a class as a tick controller. AOT collects the class via this name. */
export const TickController = (): ClassDecorator => () => {};

/** Marks a method as a tick handler. AOT collects the method via this name. */
export const OnTick = (): MethodDecorator => () => {};

const DEFAULT_INTERVAL_MS = 1000;

export class TickAdapter extends Adapter {
  static override readonly validPhases: ReadonlySet<string> = new Set(Object.values(TickPhase));

  readonly decorators: AdapterEntryDecorators = {
    controller: TickController,
    handlers: [OnTick],
    options: [],
  };

  private readonly logger = new Logger('TickAdapter');
  private readonly intervalMs: number;
  private readonly maxRounds: number;

  private timer: ReturnType<typeof setInterval> | null = null;
  private currentRound = 0;
  private inflight: Promise<void> = Promise.resolve();
  private cachedHandlers: ReadonlyArray<{
    readonly entry: CompiledHandlerEntry;
    readonly instance: object;
    readonly pipeline: ResolvedRoutePipeline;
  }> | null = null;

  constructor(options: TickAdapterOptions = {}) {
    super();
    const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error(`[TickAdapter] intervalMs must be a finite positive number; got ${String(options.intervalMs)}.`);
    }
    const maxRounds = options.maxRounds ?? Number.POSITIVE_INFINITY;
    if (!(maxRounds > 0)) {
      throw new Error(`[TickAdapter] maxRounds must be > 0; got ${String(options.maxRounds)}.`);
    }
    this.intervalMs = intervalMs;
    this.maxRounds = maxRounds;
  }

  /**
   * Public wrapper around `Adapter.registerMiddleware` for the OnTick phase.
   *
   * **Lifecycle constraint** — must be called BEFORE `app.start()`. The base
   * `Adapter` resolves `middlewareRegistry` → `resolvedMiddlewareRegistry`
   * once during `initializePipeline` (called by `Application.start` before
   * `adapter.start`), and `TickAdapter.start` snapshots handler pipelines at
   * boot. Late registration would write into a registry the dispatch path no
   * longer reads. Calls after `start()` throw rather than silently no-op.
   */
  addMiddlewares(phase: TickPhaseValue, middlewares: readonly MiddlewareDefinition[]): this {
    if (this.cachedHandlers !== null) {
      throw new Error(`[TickAdapter] addMiddlewares() must be called before app.start(); the adapter has already booted (${String(this.cachedHandlers.length)} handlers cached).`);
    }
    this.registerMiddleware(phase, middlewares);
    return this;
  }

  protected async executePipeline(context: AdapterContext): Promise<void> {
    const tick = context.to(TickContext);
    const state = dispatchStates.get(tick);

    if (state === undefined) {
      throw new Error('[TickAdapter] dispatch state missing — TickContext was created outside the adapter\'s tick loop.');
    }

    // Broad OnTick phase middleware — handles runtime-registered MW that
    // AOT dead-step elimination would otherwise drop. Mirrors HttpAdapter's
    // OnRequest pre-route handling.
    const onTickMws = this.getPhaseMiddlewares(TickPhase.OnTick);
    if (onTickMws.length > 0) {
      const result = await this.runMiddlewares(onTickMws, context);
      // Short-circuit: if any middleware returned an error, skip the
      // handler. Mirrors HttpAdapter's behaviour for OnRequest errors.
      if (result !== undefined && isErr(result)) {
        this.logger.warn(`OnTick middleware returned error — skipping handler ${state.entry.id}`);
        return;
      }
    }

    const handlerFn = (state.instance as Record<string, unknown>)[state.entry.methodName];
    if (typeof handlerFn !== 'function') {
      throw new Error(`[TickAdapter] Handler method '${state.entry.methodName}' not found on controller for ${state.entry.id}.`);
    }

    const handler: PipelineStepFn = async (ctx) => {
      return (handlerFn as (c: AdapterContext) => unknown).call(state.instance, ctx);
    };

    await this.runPipeline(context, state.pipeline.pre, handler, state.pipeline.post, state.pipeline.filters);
  }

  protected emergencyTeardown(_ctx: AdapterContext, error?: unknown): void {
    if (error !== undefined) {
      this.logger.error(`Tick handler crashed: ${(error as Error).message ?? String(error)}`);
    }
  }

  async start(_appCtx: ApplicationContext): Promise<void> {
    this.cachedHandlers = this.resolveHandlers();

    if (this.cachedHandlers.length === 0) {
      this.logger.info('No tick handlers registered (AOT) — adapter idle');
      return;
    }

    this.logger.info(
      `Scheduling ${String(this.cachedHandlers.length)} handlers every ${String(this.intervalMs)}ms` +
      (Number.isFinite(this.maxRounds) ? ` (max ${String(this.maxRounds)} rounds)` : ''),
    );

    this.timer = setInterval(() => {
      // Chain rounds via `inflight` so consecutive ticks never overlap and
      // `stop()` can await drain.
      this.inflight = this.inflight.then(() => this.runRound());
    }, this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.inflight;
    this.cachedHandlers = null;
    // Reset round counter so a subsequent start() begins at round 1 again,
    // honouring `maxRounds` per session rather than accumulating across
    // start/stop cycles.
    this.currentRound = 0;
  }

  /**
   * Stops the scheduler and waits for any in-flight tick round to finish,
   * up to `timeoutMs`. Falls back to clearing the timer and abandoning the
   * pending round if the timeout expires — `stop()`'s indefinite drain
   * is unsuitable for production shutdown paths where a stuck handler
   * would otherwise block the entire process.
   */
  override async drain(timeoutMs: number): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      await this.inflight;
      this.cachedHandlers = null;
      return;
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<'timeout'>((resolveFn) => {
      timeoutHandle = setTimeout(() => resolveFn('timeout'), timeoutMs);
    });

    try {
      const result = await Promise.race([
        this.inflight.then(() => 'drained' as const),
        timeoutPromise,
      ]);
      if (result === 'timeout') {
        this.logger.warn(`drain timed out after ${String(timeoutMs)}ms — abandoning in-flight tick round`);
      }
    } finally {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      this.cachedHandlers = null;
      this.currentRound = 0;
    }
  }

  private async runRound(): Promise<void> {
    if (this.cachedHandlers === null) return;
    if (this.currentRound >= this.maxRounds) {
      if (this.timer !== null) {
        clearInterval(this.timer);
        this.timer = null;
      }
      return;
    }

    this.currentRound += 1;
    const round = this.currentRound;
    const tickedAt = Date.now();

    for (const { entry, instance, pipeline } of this.cachedHandlers) {
      const ctx = new TickContext(tickedAt, round);
      dispatchStates.set(ctx, { entry, instance, pipeline });
      try {
        await this.dispatchRequest(ctx);
      } finally {
        dispatchStates.delete(ctx);
      }
    }
  }

  private resolveHandlers(): ReadonlyArray<{
    readonly entry: CompiledHandlerEntry;
    readonly instance: object;
    readonly pipeline: ResolvedRoutePipeline;
  }> {
    const state = getBootstrapState();
    const entries = (state.handlerIndex ?? []).filter(h => h.adapterId === 'TickAdapter');
    const out: Array<{ entry: CompiledHandlerEntry; instance: object; pipeline: ResolvedRoutePipeline }> = [];

    for (const entry of entries) {
      const instance = state.controllerInstances?.get(entry.controllerKey);
      if (instance === undefined) continue;
      out.push({
        entry,
        instance: instance as object,
        pipeline: this.buildHandlerPipeline(entry),
      });
    }

    return out;
  }

  private buildHandlerPipeline(entry: CompiledHandlerEntry): ResolvedRoutePipeline {
    const phaseMws = entry.mergedPhaseMiddlewareKeys !== undefined
      ? this.resolvePhaseMiddlewareKeys(entry.mergedPhaseMiddlewareKeys)
      : ({} as Readonly<Record<string, readonly ResolvedMiddleware[]>>);

    const guards: readonly ResolvedGuard[] = entry.mergedGuardKeys !== undefined
      ? this.resolveGuardKeys(entry.mergedGuardKeys)
      : [];

    const filters: readonly ResolvedExceptionFilter[] = entry.mergedExceptionFilterKeys !== undefined
      ? this.resolveExceptionFilterKeys(entry.mergedExceptionFilterKeys)
      : [];

    // Adapter-step closures — handler-scoped middleware only (broad MW is
    // run by `executePipeline`, not duplicated here).
    const adapterSteps = new Map<string, PipelineStepFn>([
      [TickPhase.OnTick, async (ctx: AdapterContext) => {
        const list = phaseMws[TickPhase.OnTick] ?? [];
        if (list.length === 0) return undefined;
        return this.runMiddlewares(list, ctx);
      }],
    ]);

    const pre = this.resolveStepFns(entry.compiledPre ?? [], adapterSteps, guards, []);
    const post = this.resolveStepFns(entry.compiledPost ?? [], adapterSteps, guards, []);

    return { pre, post, filters };
  }
}

export const tickAdapterDefinition = defineAdapter({
  adapter: TickAdapter,
  context: TickContext,
  phase: TickPhase,
  step: TickStep,
  pipeline: [TickPhase.OnTick, CoreStep.Handler],
});
