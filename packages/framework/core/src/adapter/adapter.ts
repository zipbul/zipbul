import { err, isErr } from '@zipbul/result';
import type { Err, Result, ResultAsync } from '@zipbul/result';
import { isBakerIssueSet } from '@zipbul/baker';
import type { MiddlewareDefinition, MiddlewareHandlerFn } from '@zipbul/common';
import type { GuardDefinition, GuardHandlerFn } from '@zipbul/common';
import type { ExceptionFilterDefinition, ExceptionFilterHandlerFn, ExceptionConstructorLike } from '@zipbul/common';
import type { Adapter as AdapterContract, AdapterClass, AdapterConfig, AdapterEntryDecorators, AdapterContext, ApplicationContext } from '@zipbul/common';
import { ClusterStrategy } from '@zipbul/common';
import type { ZipbulContainer } from '@zipbul/common';
import { contextKey } from '@zipbul/common';
import { appBaker } from '../baker';
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
 * Resolved validation entry: AOT accessor path resolved to read/write closures.
 *
 * Protocol-agnostic: the core orchestrates `readInput` → `deserialize` → `writeOutput`.
 * Each adapter provides closures that know how to read raw input and store validated
 * results in adapter-specific locations (e.g. HttpRequest internal slots).
 *
 * @public
 */
export interface ResolvedValidationEntry {
  /** Access path from compiled metadata (e.g. `['request', 'getBody']`). For error reporting. */
  readonly accessor: readonly string[];
  /** DTO class constructor. Passed to baker `deserialize()`. */
  readonly metatype: new (...args: readonly unknown[]) => unknown;
  /** Reads raw input from the adapter-specific context. */
  readonly readInput: (context: AdapterContext) => unknown;
  /** Writes validated result back to the adapter-specific context. */
  readonly writeOutput: (context: AdapterContext, value: unknown) => void;
}

/**
 * Context key for storing handler result after handler execution.
 * Post-handler steps read the result from context via this key.
 *
 * @public
 */
export const handlerResultKey = contextKey<Result<unknown, unknown> | undefined>('zipbul.handlerResult');

/**
 * Step function signature for pipeline steps.
 * Returns `Err` to short-circuit, `undefined`/`void` to continue.
 *
 * @public
 */
export type PipelineStepFn = (context: AdapterContext) => Promise<Result<unknown, unknown> | undefined | void> | Result<unknown, unknown> | undefined | void;

/**
 * Base class for all Zipbul adapters.
 *
 * Provides pipeline execution (`runPipeline`), middleware/guard/exception-filter
 * primitives, and DI resolution. Subclasses declare protocol-specific phases
 * via `static readonly validPhases` and provide step implementations.
 *
 * @public
 */
export abstract class Adapter implements AdapterContract {
  abstract readonly decorators: AdapterEntryDecorators;

  /**
   * Set of valid middleware phase identifiers for this adapter.
   * AOT compiler extracts this statically for build-time phase validation.
   *
   * @public
   */
  static readonly validPhases: ReadonlySet<string>;

  /**
   * Clustering strategy for this adapter.
   *
   * @public
   */
  readonly clusterStrategy: ClusterStrategy = ClusterStrategy.Shared;

  private middlewareRegistry = new Map<string, readonly MiddlewareDefinition[]>();
  private resolvedMiddlewareRegistry = new Map<string, ResolvedMiddleware[]>();

  protected exceptionFilterDefs: readonly ExceptionFilterDefinition[] = [];
  protected guardDefs: readonly GuardDefinition[] = [];

  protected resolvedExceptionFilters: ResolvedExceptionFilter[] = [];
  protected resolvedGuards: ResolvedGuard[] = [];
  protected pipelineContainer?: ZipbulContainer;

  // ── Abstract hooks ─────────────────────────────────────────

  /**
   * Adapter-specific pipeline assembly.
   * Runs pre-route steps, matches route, calls `runPipeline`.
   *
   * @param context - The current execution context.
   * @public
   */
  protected abstract executePipeline(context: AdapterContext): Promise<void>;

  /**
   * Emergency teardown when post-handler steps throw.
   *
   * @param context - The current execution context.
   * @param error - The error that triggered teardown.
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
   * Optional test-mode boot path used by `@zipbul/testing` to wire routes
   * and pipeline state without binding a transport. When absent, the
   * testing toolkit treats the adapter as not bootable in-process and
   * skips its start step entirely (the adapter's providers remain
   * registered; its surface — if any — is still callable).
   *
   * Adapters that don't implement startTest cannot be exercised through
   * the toolkit's in-process inject path.
   *
   * @public
   */
  startTest?(context: ApplicationContext): Promise<void>;

  /**
   * Gracefully shuts down the adapter.
   *
   * @public
   */
  abstract stop(): Promise<void>;

  /**
   * Stops accepting new connections and waits for in-flight work to complete.
   *
   * @param timeoutMs - Maximum time to wait for drain completion.
   * @public
   */
  async drain(timeoutMs: number): Promise<void> {
    void timeoutMs;
    await this.stop();
  }

  // ── Declarative config application (AOT bootstrap) ──────────

  /**
   * Receives the adapter's complete AOT-compiled configuration slice and
   * applies it once. The compiler is the single source of truth and the
   * bootstrap calls this exactly once per adapter, so each field is a
   * straight set (not an append): the slice fully describes the adapter's
   * middleware/guard/exception-filter wiring. Every definition is validated
   * for adapter compatibility before being stored; resolution against the DI
   * container happens later in {@link initializePipeline}.
   *
   * @param config - The adapter's compiled config slice.
   * @public
   */
  applyConfig(config: AdapterConfig): void {
    if (config.middlewares !== undefined) {
      for (const [phase, definitions] of Object.entries(config.middlewares)) {
        this.validatePhase(phase);
        this.validateAdapterCompatibility(definitions, 'Middleware');
        this.middlewareRegistry.set(phase, definitions);
      }
    }

    if (config.guards !== undefined) {
      this.validateAdapterCompatibility(config.guards, 'Guard');
      this.guardDefs = config.guards;
    }

    if (config.exceptionFilters !== undefined) {
      this.validateAdapterCompatibility(config.exceptionFilters, 'ExceptionFilter');
      this.exceptionFilterDefs = config.exceptionFilters;
    }
  }

  // ── Middleware registry ─────────────────────────────────────

  /**
   * Returns resolved middlewares for a given phase.
   *
   * @param phase - Phase key.
   * @returns Resolved middlewares. Empty if none registered.
   * @public
   */
  protected getPhaseMiddlewares(phase: string): readonly ResolvedMiddleware[] {
    return this.resolvedMiddlewareRegistry.get(phase) ?? [];
  }

  // ── Pipeline initialization ────────────────────────────────

  /**
   * Resolves all definition factories within the given DI container.
   *
   * @param container - The application DI container.
   * @public
   */
  initializePipeline(container: ZipbulContainer): void {
    this.pipelineContainer = container;
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
  }

  // ── Pipeline execution ─────────────────────────────────────

  /**
   * Dispatches a request: executePipeline + finalize guarantee.
   *
   * @param context - The current execution context.
   * @public
   */
  async dispatchRequest(context: AdapterContext): Promise<void> {
    await runInAdapterContext(context, async () => {
      try {
        await this.executePipeline(context);
      } catch (thrown: unknown) {
        try {
          await this.emergencyTeardown(context, thrown);
        } catch { /* swallow */ }
      } finally {
        try {
          const finalizeList = this.getFinalizeMiddlewares(context);

          if (finalizeList.length > 0) {
            await this.runMiddlewares(finalizeList, context);
          }
        } catch { /* swallow */ }
      }
    });
  }

  /**
   * Executes pre steps -> handler -> post steps with exception filter boundary.
   *
   * @param context - Current execution context.
   * @param pre - Pre-handler step functions.
   * @param handler - Handler step function.
   * @param post - Post-handler step functions.
   * @param filters - Exception filter chain.
   * @public
   */
  protected async runPipeline(
    context: AdapterContext,
    pre: readonly PipelineStepFn[],
    handler: PipelineStepFn,
    post: readonly PipelineStepFn[],
    filters: readonly ResolvedExceptionFilter[],
  ): Promise<void> {
    let result: Result<unknown, unknown> | undefined;

    try {
      for (const step of pre) {
        const stepResult = await step(context);

        if (stepResult !== undefined && isErr(stepResult)) {
          result = stepResult;
          break;
        }
      }

      if (result === undefined) {
        result = await handler(context) ?? undefined;
      }
    } catch (thrown: unknown) {
      result = await this.executeExceptionFilterChain(filters, thrown, context);
    }

    context.set(handlerResultKey, result);

    try {
      for (const step of post) {
        await step(context);
      }
    } catch (postError: unknown) {
      try {
        await this.emergencyTeardown(context, postError);
      } catch { /* swallow */ }
    }
  }

  /**
   * Returns finalize middlewares. Override in adapters.
   *
   * @public
   */
  protected getFinalizeMiddlewares(_context?: AdapterContext): readonly ResolvedMiddleware[] {
    return [];
  }

  // ── Building blocks ────────────────────────────────────────

  /**
   * Runs baker validation for each resolved validation entry.
   * Reads the raw value via `entry.readInput(context)`, validates against the DTO,
   * and stores the validated result via `entry.writeOutput(context, result)`.
   *
   * @param validations - Resolved validation entries.
   * @param context - The current execution context.
   * @public
   */
  protected async runValidations(
    validations: readonly ResolvedValidationEntry[],
    context: AdapterContext,
  ): ResultAsync<void, unknown> {
    for (const validation of validations) {
      const input = validation.readInput(context);
      const result = await appBaker.deserialize(validation.metatype, input);

      if (isBakerIssueSet(result)) {
        return this.wrapValidationError(validation, result);
      }

      validation.writeOutput(context, result);
    }
    return undefined;
  }

  /**
   * Converts a baker validation error into a protocol-specific `Err`.
   * Default: re-throws (exception filter path).
   *
   * @param _entry - The validation entry that failed.
   * @param thrown - The baker error.
   * @public
   */
  protected wrapValidationError(_entry: ResolvedValidationEntry, thrown: unknown): Err<unknown> {
    throw thrown;
  }

  /**
   * Executes an ordered list of resolved middlewares.
   *
   * @param list - Resolved middlewares.
   * @param context - The current execution context.
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
   * Executes guards in order.
   *
   * @param guards - Guard list to execute. Adapter passes merged guards (AOT) or global guards.
   * @param context - The current execution context.
   * @public
   */
  protected async runGuards(
    guards: readonly ResolvedGuard[],
    context: AdapterContext,
  ): ResultAsync<void, unknown> {
    for (const guard of guards) {
      const result = await guard.handler(context);

      if (isErr(result)) {
        return result;
      }
    }

    return undefined;
  }

  // ── Exception filter dispatch ──────────────────────────────

  /**
   * Iterates the exception filter chain, returns first matching filter result.
   *
   * @param chain - Exception filter chain.
   * @param error - The thrown error.
   * @param context - The current execution context.
   * @public
   */
  protected async executeExceptionFilterChain(
    chain: readonly ResolvedExceptionFilter[],
    error: unknown,
    context: AdapterContext,
  ): Promise<Err<unknown>> {
    for (const entry of chain) {
      if (!this.matchesExceptionFilter(error, entry)) {
        continue;
      }

      const filterResult = await entry.handler(error, context);

      if (!isErr(filterResult)) {
        return this.wrapInvalidFilterResult(error, filterResult);
      }

      return filterResult;
    }

    return this.wrapUnhandledException(error);
  }

  /**
   * Protocol-translation hook: builds the `Err` returned when no registered
   * exception filter matches a thrown value.
   *
   * The core base class returns a protocol-agnostic `{ message, cause }`
   * shape. Adapters override this to produce their protocol-specific error
   * payload (e.g. `ErrorResponseData` for HTTP). This is the symmetric
   * counterpart to {@link wrapValidationError}.
   *
   * @param error - The thrown value that matched no filter.
   * @public
   */
  protected wrapUnhandledException(error: unknown): Err<unknown> {
    return err({ message: 'Unhandled error', cause: error });
  }

  /**
   * Protocol-translation hook: builds the `Err` returned when a matched
   * exception filter returns a non-`Err` value (filter-author contract
   * violation).
   *
   * The core base class returns a protocol-agnostic `{ message, cause }`
   * shape. Adapters override this to produce their protocol-specific error
   * payload.
   *
   * @param error - The original thrown value.
   * @param _filterResult - The non-`Err` value the filter returned.
   * @public
   */
  protected wrapInvalidFilterResult(error: unknown, _filterResult: unknown): Err<unknown> {
    return err({ message: 'Exception filter must return Err', cause: error });
  }

  // ── Pipeline step resolution ───────────────────────────────

  /**
   * Converts a compiled step name array into ready-to-call `PipelineStepFn[]`.
   *
   * CoreStep entries are mapped to core methods (`runGuards`, `runValidations`).
   * All other entries are looked up from the adapter-provided step Map.
   * Called at boot time to produce the final `pre`/`post` arrays stored in route metadata.
   *
   * @param steps - Compiled step names (from `compiledPre`/`compiledPost`).
   * @param adapterSteps - Adapter-specific step name → function Map.
   * @param guards - Resolved guards for this handler.
   * @param validations - Resolved validation entries for this handler.
   * @returns Ready-to-call step function array.
   * @public
   */
  protected resolveStepFns(
    steps: readonly string[],
    adapterSteps: ReadonlyMap<string, PipelineStepFn>,
    guards: readonly ResolvedGuard[],
    validations: readonly ResolvedValidationEntry[],
  ): PipelineStepFn[] {
    return steps.map(step => {
      switch (step) {
        case CoreStep.Validation:
          return (ctx: AdapterContext) => this.runValidations(validations, ctx);
        case CoreStep.Guard:
          return (ctx: AdapterContext) => this.runGuards(guards, ctx);
        case CoreStep.Handler:
          throw new Error(`[Adapter] CoreStep.Handler must not appear in resolved step arrays. The AOT compiler splits the pipeline around Handler.`);
        default: {
          const fn = adapterSteps.get(step);
          if (fn === undefined) {
            throw new Error(`[Adapter] Unknown pipeline step '${step}'. Ensure the adapter registers this step.`);
          }
          return fn;
        }
      }
    });
  }

  // ── Key resolution (AOT -> runtime) ────────────────────────

  /**
   * Resolves middleware definition keys into ready-to-call handlers.
   *
   * @param keys - Deterministic container keys.
   * @param container - DI container.
   * @public
   */
  protected resolveMiddlewareKeys(
    keys: readonly string[],
    container: ZipbulContainer = this.getPipelineContainer(),
  ): ResolvedMiddleware[] {
    if (keys.length === 0) {
      return [];
    }

    const definitions = keys.map(key => container.get(key) as MiddlewareDefinition);

    this.validateAdapterCompatibility(definitions, 'Middleware');

    return this.resolveMiddlewareDefs(definitions, container);
  }

  /**
   * Resolves phase-keyed middleware definition keys.
   *
   * @param phaseKeys - Phase-keyed container keys.
   * @param container - DI container.
   * @public
   */
  protected resolvePhaseMiddlewareKeys(
    phaseKeys: Readonly<Record<string, readonly string[]>>,
    container: ZipbulContainer = this.getPipelineContainer(),
  ): Readonly<Record<string, readonly ResolvedMiddleware[]>> {
    const resolved = Object.fromEntries(
      Object.entries(phaseKeys).map(([phase, keys]) => [phase, this.resolveMiddlewareKeys(keys, container)]),
    ) as Record<string, readonly ResolvedMiddleware[]>;

    return Object.freeze(resolved);
  }

  /**
   * Resolves guard definition keys into ready-to-call handlers.
   *
   * @param keys - Deterministic container keys.
   * @param container - DI container.
   * @public
   */
  protected resolveGuardKeys(
    keys: readonly string[],
    container: ZipbulContainer = this.getPipelineContainer(),
  ): ResolvedGuard[] {
    if (keys.length === 0) {
      return [];
    }

    const definitions = keys.map(key => container.get(key) as GuardDefinition);

    this.validateAdapterCompatibility(definitions, 'Guard');

    return definitions.map((def) => ({
      handler: runInInjectionContext(container, def.factory),
    }));
  }

  /**
   * Resolves exception filter definition keys into ready-to-call handlers.
   *
   * @param keys - Deterministic container keys.
   * @param container - DI container.
   * @public
   */
  protected resolveExceptionFilterKeys(
    keys: readonly string[],
    container: ZipbulContainer = this.getPipelineContainer(),
  ): ResolvedExceptionFilter[] {
    if (keys.length === 0) {
      return [];
    }

    const definitions = keys.map(key => container.get(key) as ExceptionFilterDefinition);

    this.validateAdapterCompatibility(definitions, 'Exception filter');

    return definitions.map((def) => ({
      handler: runInInjectionContext(container, def.factory),
      catchTypes: def.catchTypes,
    }));
  }

  // ── Internal ───────────────────────────────────────────────

  /**
   * Resolves middleware definitions into ready-to-call handlers.
   *
   * @param definitions - Middleware definitions.
   * @param container - DI container.
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

  /**
   * Checks whether an error matches a given exception filter entry.
   *
   * @param error - The thrown error.
   * @param entry - The exception filter entry.
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

  private getPipelineContainer(): ZipbulContainer {
    if (this.pipelineContainer === undefined) {
      throw new Error('Pipeline container is not initialized. Call initializePipeline() first.');
    }

    return this.pipelineContainer;
  }
}
   