/**
 * AOT-compiled option decorator entry.
 * Extracted from adapter-declared option decorators on handler methods/classes.
 *
 * @public
 */
export interface CompiledOptionEntry {
  /** Decorator name (e.g. `'RawBody'`). */
  readonly name: string;
  /** Decorator arguments. Empty array when the decorator takes no arguments. */
  readonly arguments: readonly unknown[];
}

/**
 * AOT-compiled validation entry.
 * Extracted from accessor calls like `ctx.request.getBody(Dto)` in handler body.
 *
 * @public
 */
export interface CompiledValidationEntry {
  /** Access path on the handler context (e.g. `['request', 'getBody']`). Protocol-neutral — each adapter interprets the path. */
  readonly accessor: readonly string[];
  /** DTO class name. Resolved to actual class constructor at boot time via metatypeIndex. */
  readonly metatypeKey: string;
}

/**
 * AOT-compiled phase-keyed middleware key set.
 *
 * Keys are adapter-declared phase IDs. Values are deterministic container keys
 * pointing at middleware definitions registered during AOT code generation.
 *
 * @public
 */
export type CompiledPhaseMiddlewareKeys = Readonly<Record<string, readonly string[]>>;

/**
 * Pipeline binding scope, ordered from most specific to broadest.
 *
 * @public
 */
export type CompiledPipelineScope = 'handler' | 'controller' | 'module' | 'global';

/**
 * AOT-compiled middleware binding entry.
 *
 * Keeps phase and scope information losslessly so final pipeline merging can be
 * done after collection without guessing from container keys.
 *
 * @public
 */
export interface CompiledMiddlewareBindingEntry {
  readonly key: string;
  readonly scope: CompiledPipelineScope;
  readonly order: number;
  readonly phase?: string;
}

/**
 * AOT-compiled guard/filter binding entry.
 *
 * @public
 */
export interface CompiledPipelineBindingEntry {
  readonly key: string;
  readonly scope: CompiledPipelineScope;
  readonly order: number;
}

/**
 * AOT-compiled handler metadata.
 *
 * Protocol-agnostic: the compiler does not know what `"Get"` means.
 * It passes decorator names and arguments verbatim so each adapter
 * can interpret them at runtime.
 *
 * @public
 */
export interface CompiledHandlerEntry {
  /** Unique handler ID (e.g. `"HttpAdapter:src/user.controller.ts#UserController.findAll"`). */
  readonly id: string;
  /** Adapter identifier (e.g. `"HttpAdapter"`). */
  readonly adapterId: string;
  /**
   * Class name of the controller (e.g. `"UserController"`). The AOT
   * generator always emits this; it is `optional` only for hand-rolled
   * test fixtures that predate the field.
   */
  readonly className?: string;
  /** Container key for the controller instance (e.g. `"AppModule::UserController"`). */
  readonly controllerKey: string;
  /** Method name on the controller class. */
  readonly methodName: string;
  /** Handler decorator name (e.g. `"Get"`, `"Post"`, `"OnMessage"`). Adapter interprets meaning. */
  readonly handlerDecorator: string;
  /** Handler decorator arguments (e.g. `["/users"]`). Adapter interprets meaning. */
  readonly handlerDecoratorArgs: readonly unknown[];
  /** Container keys for route-level middleware definitions. Empty when no `@UseMiddlewares`/`@Middlewares`. */
  readonly middlewareKeys?: readonly string[];
  /** Container keys for route-level exception filter definitions. Empty when no `@UseExceptionFilters`. */
  readonly exceptionFilterKeys?: readonly string[];
  /** Container keys for route-level guard definitions. Empty when no `@UseGuards`. */
  readonly guardKeys?: readonly string[];
  /** Owning module name for this handler, when resolved by the module graph. */
  readonly ownerModuleName?: string;
  /**
   * Build-time merged, phase-keyed middleware keys.
   * Intended for the generic compiled pipeline runtime.
   */
  readonly mergedPhaseMiddlewareKeys?: CompiledPhaseMiddlewareKeys;
  /**
   * Build-time merged guard keys.
   * Ordering: global → module → controller → handler.
   */
  readonly mergedGuardKeys?: readonly string[];
  /**
   * Build-time merged exception filter keys.
   * Ordering: handler → controller → module → global.
   */
  readonly mergedExceptionFilterKeys?: readonly string[];
  /** Lossless middleware bindings collected during AOT. */
  readonly middlewareBindings?: readonly CompiledMiddlewareBindingEntry[];
  /** Lossless guard bindings collected during AOT. */
  readonly guardBindings?: readonly CompiledPipelineBindingEntry[];
  /** Lossless exception filter bindings collected during AOT. */
  readonly exceptionFilterBindings?: readonly CompiledPipelineBindingEntry[];
  /** Validation entries extracted from handler accessor calls (e.g. `getBody`, `getParams`). */
  readonly validations?: readonly CompiledValidationEntry[];
  /** Option decorators from adapter-declared `decorators.options`. Adapter interprets meaning. */
  readonly options?: readonly CompiledOptionEntry[];
  /** AOT-compiled pre-handler pipeline — steps before Handler, dead-step eliminated. */
  readonly compiledPre?: readonly string[];
  /** AOT-compiled post-handler pipeline — steps after Handler, dead-step eliminated. */
  readonly compiledPost?: readonly string[];
}
