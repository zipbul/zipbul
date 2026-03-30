/**
 * AOT-compiled validation entry.
 * Extracted from `Validated<T>` method calls in handler body.
 *
 * @public
 */
export interface CompiledValidationEntry {
  /** Access kind. Adapter uses this to determine the validation input (e.g. 'body', 'query', 'params'). */
  readonly kind: string;
  /** Type name of T. Container key or import-path-qualified class name. */
  readonly metatypeKey: string;
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
  /** Validated<T> accessor list extracted from handler body. Empty when no validations. */
  readonly validations?: readonly CompiledValidationEntry[];
}
