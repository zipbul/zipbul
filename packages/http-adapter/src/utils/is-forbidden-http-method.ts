import { FORBIDDEN_HTTP_METHODS } from '../constants';

const FORBIDDEN_SET: ReadonlySet<string> = new Set(FORBIDDEN_HTTP_METHODS);

export function isForbiddenHttpMethod(value: string): value is typeof FORBIDDEN_HTTP_METHODS[number] {
  return FORBIDDEN_SET.has(value);
}
