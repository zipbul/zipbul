import type { InjectableOptions } from './interfaces';

export function Injectable(_options?: InjectableOptions) {
  return <T extends abstract new (...args: any) => any>(
    _value: T,
    _context: ClassDecoratorContext<T>,
  ): void => {};
}
