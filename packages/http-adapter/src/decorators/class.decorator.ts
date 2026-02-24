import type { ControllerOptions, RestControllerDecoratorOptions } from './interfaces';

/**
 * Marks a class as an HTTP controller entry point.
 *
 * AOT-collectable call forms (ADAPTER-R-010):
 *   @RestController()                         — 0 args
 *   @RestController({ adapterIds: ['http'] }) — 1 object literal arg
 *
 * Runtime forms (not AOT-collectable as 1-arg object literal):
 *   @RestController('users')                  — string path
 *   @RestController('users', { adapterIds })  — string path + options
 */
export function RestController(_options?: RestControllerDecoratorOptions): ClassDecorator;
export function RestController(_path?: string, _options?: RestControllerDecoratorOptions): ClassDecorator;
export function RestController(
  _pathOrOptions?: string | RestControllerDecoratorOptions,
  _options?: RestControllerDecoratorOptions,
): ClassDecorator {
  return () => {};
}

export function Controller(_prefixOrOptions?: string | ControllerOptions): ClassDecorator {
  return () => {};
}
