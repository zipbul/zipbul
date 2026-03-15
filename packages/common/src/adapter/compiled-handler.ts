/**
 * AOT-compiled parameter metadata.
 *
 * The compiler emits decorator names as-is (e.g. `"Body"`, `"Param"`).
 * The adapter is responsible for interpreting what each name means
 * at runtime.
 *
 * @public
 */
export interface CompiledParamEntry {
  /** Parameter variable name from source code. */
  readonly name: string;
  /** Decorator name if present (e.g. `"Body"`, `"Query"`). Adapter interprets meaning. */
  readonly decoratorName?: string;
  /** Decorator arguments (e.g. `["id"]` for `@Param('id')`). */
  readonly decoratorArgs?: readonly unknown[];
  /** Container key or primitive type name (e.g. `"string"`, `"AppModule::CreateUserDto"`). */
  readonly metatypeKey?: string;
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
  /** Compiled parameter metadata for this handler. */
  readonly params: readonly CompiledParamEntry[];
  /** Container keys for middleware instances. */
  readonly middlewareKeys: readonly string[];
  /** Container keys for exception filter instances. */
  readonly errorFilterKeys: readonly string[];
}
