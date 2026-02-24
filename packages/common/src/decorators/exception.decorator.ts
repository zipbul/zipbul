import type { ExceptionFilterToken } from '../interfaces';
import type { ErrorToken } from '../types';

export function Catch(..._exceptions: Array<ErrorToken>): ClassDecorator {
  return () => {};
}

export function UseExceptionFilters(..._filters: Array<ExceptionFilterToken>): MethodDecorator & ClassDecorator {
  return () => {};
}
