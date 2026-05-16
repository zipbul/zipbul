import type { InjectableOptions } from './interfaces';

export function Injectable(_options?: InjectableOptions): ClassDecorator {
  return () => {};
}
