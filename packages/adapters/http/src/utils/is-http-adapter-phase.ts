import { HttpAdapterPhase } from '../enums/http-adapter-phase';

const HTTP_ADAPTER_PHASE_VALUES: ReadonlySet<string> = new Set(Object.values(HttpAdapterPhase));

/**
 * Type guard for {@link HttpAdapterPhase} enum values.
 *
 * @param value - The string to check.
 * @returns `true` if the value is a valid `HttpAdapterPhase`.
 */
export function isHttpAdapterPhase(value: string): value is HttpAdapterPhase {
  return HTTP_ADAPTER_PHASE_VALUES.has(value);
}
