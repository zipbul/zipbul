import type { ControllerOptions, RestControllerDecoratorOptions } from './interfaces';

/**
 * Marks a class as an HTTP controller entry point.
 *
 * AOT-collectable call forms (ADAPTER-R-010):
 *   @RestController()                         — 0 args
 *   @RestController({ adapterNames: ['api'] }) — 1 object literal arg
 *
 * Runtime forms (not AOT-collectable as 1-arg object literal):
 *   @RestController('users')                   — string path
 *   @RestController('users', { adapterNames })  — string path + options
 */
export function RestController(
  _options?: RestControllerDecoratorOptions,
): <T extends abstract new (...args: any) => any>(value: T, context: ClassDecoratorContext<T>) => void;
export function RestController(
  _path?: string,
  _options?: RestControllerDecoratorOptions,
): <T extends abstract new (...args: any) => any>(value: T, context: ClassDecoratorContext<T>) => void;
export function RestController(
  _pathOrOptions?: string | RestControllerDecoratorOptions,
  _options?: RestControllerDecoratorOptions,
) {
  return () => {};
}

export function Controller(
  _prefixOrOptions?: string | ControllerOptions,
): <T extends abstract new (...args: any) => any>(value: T, context: ClassDecoratorContext<T>) => void {
  return () => {};
}
