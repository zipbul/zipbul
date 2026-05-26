import type { ExceptionFilterDefinition } from '../define-exception-filter';

export function UseExceptionFilters(
  ..._filters: readonly ExceptionFilterDefinition[]
): (value: Function, context: ClassDecoratorContext | ClassMethodDecoratorContext) => void {
  return () => {};
}
