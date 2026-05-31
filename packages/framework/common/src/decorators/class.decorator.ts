import type { InjectableOptions } from './interfaces';

export function Injectable(_options?: InjectableOptions): (value: unknown, context: DecoratorContext) => void {
  return () => {};
}
