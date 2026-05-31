import type { ExceptionFilterDefinition } from '../define-exception-filter';

export function UseExceptionFilters(..._filters: readonly ExceptionFilterDefinition[]): (value: unknown, context: DecoratorContext) => void {
  return () => {};
}
