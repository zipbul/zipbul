import { err, isErr } from '@zipbul/result';
import type { Err, Result, ResultAsync } from '@zipbul/result';
import { deserialize, isBakerError } from '@zipbul/baker';
import type { MiddlewareDefinition, MiddlewareHandlerFn } from '@zipbul/common';
import type { GuardDefinition, GuardHandlerFn } from '@zipbul/common';
import type { ExceptionFilterDefinition, ExceptionFilterHandlerFn, ExceptionConstructorLike } from '@zipbul/common';
import type { Adapter as AdapterContract, AdapterClass, AdapterEntryDecorators, AdapterContext, ApplicationContext } from '@zipbul/common';
import { ClusterStrategy } from '@zipbul/common';
import type { ZipbulContainer } from '@zipbul/common';
import { runInInjectionContext } from '../injection-context';
import { runInAdapterContext } from '../adapter-context';
import { CoreStep } from './enums';

/**
 * Resolved middleware: factory has been called, handler is ready.
 *
 * @public
 */
export interface ResolvedMiddleware {
  readonly handler: MiddlewareHandlerFn;
}

/**
 * Resolved guard: factory has been called, handler is ready.
 *
 * @public
 */
export interface ResolvedGuard {
  readonly handler: GuardHandlerFn;
}

/**
 * Resolved exception filter: factory has been called, handler is ready.
 *
 * @public
 */
export interface ResolvedExceptionFilter {
  readonly handler: ExceptionFilterHandlerFn;
  readonly catchTypes: readonly ExceptionConstructorLike[];
}

/**
 * Resolved validation entry: AOT metatypeKey resolved to actual class constructor.
 *
 * @public
 */
export interface ResolvedValidationEntry {
  /** Access kind. Adapter uses this to determine validation input (e.g. 'body', 'query', 'params'). */
  readonly kind: string;
  /** DTO class constructor. Passed to baker `deserialize()`. */
  readonly metatype: new (...args: readonly unknown[]) => unknown;
}

/**
 * Base class for all Zipbul adapters.
 *
 * Provides framework-level pipeline orchestration (3-Phase error boundary),
 * middleware/guard/exception-filter execution primitives, and DI resolution.
 * Subclasses own their pipeline assembly via `executePipeline` and declare
 * protocol-specific phases via `static readonly validPhases`.
 *
 * @public
 */
export abstract class Adapter implements AdapterContract {
  abstract readonly decorators: AdapterEntryDecorators;

  /**
   * Set of valid middleware phase identifiers for this adapter.
   * AOT compiler extracts this statically for build-time phase validation.
   * Every adapter subclass must declare this as a static readonly property.
   *
   * @public
   */
  static readonly validPhases: ReadonlySet<string>;

  /**
   * Clustering strategy for this adapter.
   * Shared = N workers with reusePort. Exclusive = exactly 1 worker.
   * Subclasses override to declare their strategy.
   *
   * @public
   */
  readonly clusterStrategy: ClusterStrategy = ClusterStrategy.Shared;

  private middlewareRegistry = new Map<string, MiddlewareDefinition[]>();
  private resolvedMiddlewareRegistry = new Map<string, ResolvedMiddleware[]>();

  protected exceptionFilterDefs: ExceptionFilterDefinition[] = [];
  protected guardDefs: GuardDefinition[] = [];

  protected resolvedExceptionFilters: ResolvedExceptionFilter[] = [];
  protected resolvedGuards: ResolvedGuard[] = [];

  /** Compiled pipeline — built from static `pipeline` declaration after initializePipeline(). */
  protected compiledPipeline: readonly string[] = [];

  /** Per-handler compiled pipelines. Key: handler function reference. */
  private readonly handlerPipelineMap = new Map<Function, readonly string[]>();

  // ── Abstract hooks (subclass implements) ────────────────────

  /**
   * Assembles and executes the adapter-specific pipeline.
   * The adapter controls step ordering, phase hooks, and protocol-specific
   * logic (parsing, routing, handler invocation).
   *
   * @param context - The current execution context.
   * @returns `Result<unknown, unknown>` — domain `Err` or handler success value.
   *
   * @public
   */
  protected abstract executePipeline(context: AdapterContext): Promise<Result<unknown, unknown>>;

  /** Converts a `Result` into a protocol-specific response. */
  protected abstract handleResult(result: Result<unknown, unknown>, context: AdapterContext): Promise<void> | void;

  /**
   * Emergency teardown when `handleResult` itself throws.
   * Replaces `forceCloseConnection` — async is allowed for protocols
   * that need I/O (e.g. MQ nack).
   *
   * @param context - The current execution context.
   * @param error - The error thrown by `handleResult`.
   *
   * @public
   */
  protected abstract emergencyTeardown(context: AdapterContext, error?: unknown): Promise<void> | void;

  /**
   * Boots the adapter and begins accepting requests.
   *
   * @param context - The application startup context.
   * @public
   */
  abstract start(context: ApplicationContext): Promise<void>;

  /**
   * Gracefully shuts down the adapter.
   *
   * @public
   */
  abstract stop(): Promise<void>;

  /**
   * Stops accepting new connections and waits for in-flight work to complete.
   * Each adapter implements protocol-specific drain logic.
   *
   * @param timeoutMs - Maximum time to wait for drain completion.
   *                     After timeout, force-close remaining connections.
   * @public
   */
  async drain(timeoutMs: number): Promise<void> {
    // Default: delegate to stop(). Subclasses override with protocol-specific drain.
    void timeoutMs;
    await this.stop();
  }

  // ── Middleware registry ──────────────────────────────────────

  /**
   * Receives AOT-generated middleware configuration.
   * Validates phase keys against `static validPhases` and accumulates definitions.
   *
   * Scope: global pipeline middlewares only. Handler-scoped middlewares are stored
   * in route metadata and managed by each adapter's `executePipeline`.
   *
   * @param config - Phase-keyed middleware definitions (string keys from AOT serialization).
   *
   * @public
   */
  applyMiddlewareConfig(
    config: Readonly<Record<string, readonly MiddlewareDefinition[]>>,
  ): void {
    for (const [phase, definitions] of Object.entries(config)) {
      this.validatePhase(phase);
      const existing = this.middlewareRegistry.get(phase) ?? [];
      this.middlewareRegistry.set(phase, [...existing, ...definitions]);
    }
  }

  /**
   * Stores middleware definitions for a given phase with adapter compatibility check.
   * Adapters expose a typed public method (e.g. `addMiddlewares(phase: HttpPhase, ...)`)
   * that delegates here.
   *
   * @param phase - Phase key (validated against `static validPhases`).
   * @param middlewares - Middleware definitions to append.
   *
   * @public
   */
  protected registerMiddleware(phase: string, middlewares: readonly MiddlewareDefinition[]): void {
    this.validatePhase(phase);
    this.validateAdapterCompatibility(middlewares, 'Middleware');
    const existing = this.middlewareRegistry.get(phase) ?? [];
    this.middlewareRegistry.set(phase, [...existing, ...middlewares]);
  }

  /**
   * Returns resolved middlewares for a given phase.
   * Call from `executePipeline` to retrieve ready-to-call handlers for each phase.
   *
   * Returns an empty array for phases with no registered middlewares —
   * phase validation happens at registration time, not at lookup time.
   *
   * @param phase - Phase key.
   * @returns Resolved middlewares for the phase. Empty if none registered.
   *
   * @public
   */
  protected getPhaseMiddlewares(phase: string): readonly ResolvedMiddleware[] {
    return this.resolvedMiddlewareRegistry.get(phase) ?? [];
  }

  /**
   * Registers exception filter definitions.
   *
   * @param definitions - Exception filter definitions to append.
   * @returns `this` for chaining.
   *
   * @public
   */
  addExceptionFilters(definitions: readonly ExceptionFilterDefinition[]): this {
    this.exceptionFilterDefs = [...this.exceptionFilterDefs, ...definitions];
    return this;
  }

  /**
   * Registers guard definitions.
   *
   * @param guards - Guard definitions to append.
   * @returns `this` for chaining.
   *
   * @public
   */
  addGuards(guards: readonly GuardDefinition[]): this {
    this.validateAdapterCompatibility(guards, 'Guard');
    this.guardDefs = [...this.guardDefs, ...guards];
    return this;
  }

  // ── Pipeline initialization ────────────────────────────────

  /**
   * Resolves all definition factories (guards, exception filters, middlewares)
   * within the given DI container, producing ready-to-call handler functions.
   *
   * All factories are resolved in a single synchronous pass.
   * Factory functions must not depend on other resolved handlers.
   *
   * @param container - The application DI container.
   *
   * @public
   */
  initializePipeline(container: ZipbulContainer): void {
    this.resolvedGuards = this.guardDefs.map((def) => ({
      handler: runInInjectionContext(container, def.factory),
    }));

    this.resolvedExceptionFilters = this.exceptionFilterDefs.map((def) => ({
      handler: runInInjectionContext(container, def.factory),
      catchTypes: def.catchTypes,
    }));

    for (const [phase, definitions] of this.middlewareRegistry) {
      this.resolvedMiddlewareRegistry.set(
        phase,
        this.resolveMiddlewareDefs(definitions, container),
      );
    }

    this.compiledPipeline = this.buildCompiledPipeline();
  }

  /**
   * Registers a per-handler compiled pipeline.
   * Called by subclasses during route registration (boot time).
   *
   * @param handler - The handler function reference (used as Map key).
   * @param pipeline - The compiled pipeline steps for this handler.
   * @public
   */
  registerHandlerPipeline(handler: Function, pipeline: readonly string[]): void {
    this.handlerPipelineMap.set(handler, pipeline);
  }

  /**
   * Returns the per-handler compiled pipeline, or the adapter-level compiled pipeline as fallback.
   *
   * @param handler - The handler function reference.
   * @returns Compiled pipeline steps.
   * @public
   */
  getHandlerPipeline(handler: Function): readonly string[] | undefined {
    return this.handlerPipelineMap.get(handler);
  }

  /**
   * Builds a compiled pipeline from the adapter's static `pipeline` declaration.
   * Eliminates steps that have no registered handlers:
   * - Phase steps (in `validPhases`): removed when no middlewares registered
   * - `CoreStep.Guard`: removed when no global guards registered
   * - All other steps: always retained
   *
   * Stops at `CoreStep.Handler` — post-handler steps are managed by `handleResult`.
   */
  private buildCompiledPipeline(): readonly string[] {
    const ctor = this.constructor as typeof Adapter & { pipeline?: readonly string[] };
    const pipeline = ctor.pipeline;

    if (pipeline === undefined) {
      return [];
    }

    const validPhases = (ctor as { validPhases?: ReadonlySet<string> }).validPhases;
    const compiled: string[] = [];

    for (const step of pipeline) {
      if (validPhases !== undefined && validPhases.has(step)) {
        if ((this.resolvedMiddlewareRegistry.get(step)?.length ?? 0) > 0) {
          compiled.push(step);
        }
        continue;
      }

      if (step === CoreStep.Guard) {
        if (this.resolvedGuards.length > 0) {
          compiled.push(step);
        }
        continue;
      }

      compiled.push(step);

      if (step === CoreStep.Handler) break;
    }

    return compiled;
  }

  // ── Pipeline orchestration: 3-Phase error boundary ─────────

  /**
   * Drives the full request pipeline with a 3-Phase error boundary.
   *
   * Phase 1: Execute pipeline → obtain `Result`. Panics go through exception filters.
   * Phase 2: `handleResult` — exactly once. If it throws → `emergencyTeardown`.
   * Phase 3: Finalize middlewares — always runs. Errors are swallowed.
   *
   * @param context - The current execution context.
   * @public
   */
  async dispatchRequest(context: AdapterContext): Promise<void> {
    await runInAdapterContext(context, async () => {
      // ── Phase 1: Pipeline execution → Result ──
      let result: Result<unknown, unknown>;

      try {
        result = await this.executePipeline(context);
      } catch (thrown) {
        try {
          result = await this.runExceptionFilters(thrown, context);
        } catch (filterError) {
          result = err({ message: 'Unhandled error', cause: thrown, filterError });
        }
      }

      // ── Phase 2: Result handling (exactly once) ──
      try {
        await this.handleResult(result, context);
      } catch (handleThrown) {
        try {
          await this.emergencyTeardown(context, handleThrown);
        } catch { /* swallow — last resort */ }
      }

      // ── Phase 3: Finalize (always runs) ──
      try {
        const finalizeList = this.getFinalizeMiddlewares();

        if (finalizeList.length > 0) {
          await this.runMiddlewares(finalizeList, context);
        }
      } catch { /* swallow — response already sent */ }
    });
  }

  // ── Validation primitives ──────────────────────────────────

  /**
   * Runs baker validation for each `Validated<T>` accessor declared in the handler.
   * Results are cached in the context's validated store via `context.setValidated()`.
   *
   * Protocol-agnostic: the loop is identical for all adapters.
   * Adapters provide `resolveValidationInput()` to map kind → raw input,
   * and optionally override `wrapValidationError()` for protocol-specific error format.
   *
   * @param validations - Resolved validation entries from AOT manifest.
   * @param context - The current execution context.
   * @returns `void` on success, `Err<unknown>` on validation failure.
   *
   * @public
   */
  protected async runValidations(
    validations: readonly ResolvedValidationEntry[],
    context: AdapterContext,
  ): ResultAsync<void, unknown> {
    for (const validation of validations) {
      const input = this.resolveValidationInput(validation.kind, context);

      const result = await deserialize(validation.metatype, input);

      if (isBakerError(result)) {
        return this.wrapValidationError(validation.kind, result);
      }

      context.setValidated(validation.kind, result);
    }
    return undefined;
  }

  /**
   * Maps a validation kind to the corresponding raw input from the context.
   * Each adapter implements this to extract protocol-specific data.
   *
   * @param kind - The validation kind (e.g. 'body', 'query', 'params' for HTTP).
   * @param context - The current execution context.
   * @returns The raw input value for baker to validate.
   *
   * @public
   */
  protected abstract resolveValidationInput(kind: string, context: AdapterContext): unknown;

  /**
   * Converts a baker validation error into a protocol-specific `Err`.
   *
   * Two paths:
   * - Return `Err` → pipeline short-circuits with domain error (handleResult receives Err)
   * - Throw → error enters exception filter path (dispatchRequest Phase 1 catch)
   *
   * Default: re-throws all errors (exception filter path).
   * Adapters with validation (HTTP, WS, Queue, gRPC) override to return `Err`
   * for `BakerErrors` and re-throw the rest.
   *
   * @param _kind - The validation kind that failed.
   * @param errors - The `BakerErrors` returned by baker `deserialize()`.
   * @returns `Err<unknown>` for the pipeline.
   *
   * @public
   */
  protected wrapValidationError(_kind: string, thrown: unknown): Err<unknown> {
    throw thrown;
  }

  // ── Building blocks: adapters call these inside executePipeline ──

  /**
   * Executes an ordered list of resolved middlewares.
   *
   * @param list - Resolved middlewares to execute in order.
   * @param context - The current execution context.
   * @returns `void` on success, `Err<unknown>` when a middleware halts the pipeline.
   *
   * @public
   */
  protected async runMiddlewares(
    list: readonly ResolvedMiddleware[],
    context: AdapterContext,
  ): ResultAsync<void, unknown> {
    for (const mw of list) {
      const result = await mw.handler(context);

      if (isErr(result)) {
        return result;
      }
    }

    return undefined;
  }

  /**
   * Executes all registered guards in order.
   *
   * @param context - The current execution context.
   * @returns `void` on success, `Err<unknown>` when a guard denies access.
   *
   * @public
   */
  protected async runGuards(context: AdapterContext): ResultAsync<void, unknown> {
    for (const guard of this.resolvedGuards) {
      const result = await guard.handler(context);

      if (isErr(result)) {
        return result;
      }
    }

    return undefined;
  }

  // ── Exception filter dispatch ───────────────────────────────

  /**
   * Returns handler-scoped exception filters from the context.
   * Default: `undefined` (no local filters). Adapters with handler-scoped
   * exception filters override to extract them from the protocol-specific context.
   *
   * @param _context - The current execution context.
   * @returns Local filters, or `undefined` if none.
   *
   * @public
   */
  protected getLocalExceptionFilters(_context: AdapterContext): readonly ResolvedExceptionFilter[] | undefined {
    return undefined;
  }

  /**
   * Two-stage exception filter dispatch: local (handler-scoped) → global.
   *
   * Stage 1: Iterates local filters from `getLocalExceptionFilters()`.
   * Stage 2: Iterates globally registered filters.
   * Falls back to a generic `Err` if no filter matches.
   *
   * Filter return values are validated: must be `Err`. If a filter returns
   * a non-Err value, a synthetic `Err` wrapping the original error is returned.
   *
   * @param error - The thrown error.
   * @param context - The current execution context.
   * @returns `Err<unknown>` to feed into `handleResult`.
   *
   * @public
   */
  async runExceptionFilters(error: unknown, context: AdapterContext): Promise<Err<unknown>> {
    // Stage 1: handler-scoped (local) filters
    const localFilters = this.getLocalExceptionFilters(context);

    if (localFilters !== undefined) {
      for (const entry of localFilters) {
        if (!this.matchesExceptionFilter(error, entry)) {
          continue;
        }

        const filterResult = await entry.handler(error, context);

        if (!isErr(filterResult)) {
          return err({ message: 'Exception filter must return Err', cause: error });
        }

        return filterResult;
      }
    }

    // Stage 2: global filters
    for (const entry of this.resolvedExceptionFilters) {
      if (!this.matchesExceptionFilter(error, entry)) {
        continue;
      }

      const filterResult = await entry.handler(error, context);

      if (!isErr(filterResult)) {
        return err({ message: 'Exception filter must return Err', cause: error });
      }

      return filterResult;
    }

    return err({ message: 'Unhandled error', cause: error });
  }

  // ── Middleware definition resolution utility ─────────────────

  /**
   * Resolves middleware definitions into ready-to-call handlers using
   * the DI container. Adapters call this in their `initializePipeline`
   * override for each phase in their registry.
   *
   * @param definitions - Middleware definitions with factory functions.
   * @param container - The DI container for injection context.
   * @returns Array of resolved middlewares with callable handlers.
   *
   * @public
   */
  protected resolveMiddlewareDefs(
    definitions: readonly MiddlewareDefinition[],
    container: ZipbulContainer,
  ): ResolvedMiddleware[] {
    return definitions.map((def) => ({
      handler: runInInjectionContext(container, def.factory),
    }));
  }

  // ── Finalize middlewares ─────────────────────────────────────

  /**
   * Returns the finalize middleware list for Phase 3 of `dispatchRequest`.
   * Override in adapters to provide protocol-specific finalize middlewares
   * (e.g. `OnComplete` for HTTP).
   *
   * @returns Resolved middlewares to run after response. Default: empty.
   *
   * @public
   */
  protected getFinalizeMiddlewares(): readonly ResolvedMiddleware[] {
    return [];
  }

  // ── Internal ────────────────────────────────────────────────

  /**
   * Checks whether an error matches a given exception filter entry.
   * Empty `catchTypes` acts as a catch-all.
   *
   * @param error - The thrown error.
   * @param entry - The exception filter entry to test against.
   * @returns `true` if the filter should handle this error.
   *
   * @public
   */
  protected matchesExceptionFilter(error: unknown, entry: ResolvedExceptionFilter): boolean {
    if (entry.catchTypes.length === 0) {
      return true;
    }

    for (const exceptionType of entry.catchTypes) {
      if (error instanceof exceptionType) {
        return true;
      }
    }

    return false;
  }

  private validatePhase(phase: string): void {
    const phases = (this.constructor as typeof Adapter).validPhases;

    if (phases === undefined) {
      throw new Error(
        `${this.constructor.name} must declare static validPhases.`,
      );
    }

    if (!phases.has(phase)) {
      throw new Error(
        `Invalid middleware phase '${phase}' for ${this.constructor.name}. ` +
        `Valid phases: ${[...phases].join(', ')}.`,
      );
    }
  }

  protected validateAdapterCompatibility(
    definitions: readonly { readonly adapters?: readonly AdapterClass[] }[],
    label: string,
  ): void {
    for (const def of definitions) {
      if (def.adapters !== undefined && def.adapters.length > 0) {
        const compatible = def.adapters.some((adapterClass) => this instanceof adapterClass);

        if (!compatible) {
          const adapterNames = def.adapters.map((cls) => cls.name).join(', ');
          const thisName = this.constructor.name;

          throw new Error(
            `${label} is declared for [${adapterNames}] but was registered on ${thisName}. ` +
            `Check the adapter compatibility of your ${label.toLowerCase()} definition.`,
          );
        }
      }
    }
  }
}
