import type { ProviderToken, ProviderScope, ProviderVisibleTo, ZipbulValue } from '@zipbul/common';

/**
 * Recorded provider override. Materialized into a `container.replace(...)`
 * or `requestOverrides` map entry at `Test.create()` time.
 *
 * @internal
 */
export interface ProviderOverrideRecord {
  readonly token: ProviderToken;
  readonly factory: (...args: unknown[]) => unknown;
  readonly scope?: ProviderScope;
  readonly visibleTo?: ProviderVisibleTo;
}

/**
 * Fluent provider override entry point — `.useValue / .useFactory / .useClass`.
 *
 * @public
 */
export interface ProviderOverrideBuilder<T = ZipbulValue> {
  useValue(value: T): void;
  useFactory(factory: (...args: unknown[]) => T): void;
  useClass(ctor: new (...args: never[]) => T): void;
}

/**
 * Creates a `ProviderOverrideBuilder` that pushes its choice into the
 * supplied collector function.
 *
 * @internal
 */
export function makeProviderOverrideBuilder<T = ZipbulValue>(
  push: (record: ProviderOverrideRecord) => void,
  token: ProviderToken,
  scope?: ProviderScope,
): ProviderOverrideBuilder<T> {
  const base: { token: ProviderToken; scope?: ProviderScope } = scope !== undefined
    ? { token, scope }
    : { token };
  return {
    useValue(value): void {
      push({ ...base, factory: () => value });
    },
    useFactory(factory): void {
      push({ ...base, factory });
    },
    useClass(ctor): void {
      push({ ...base, factory: () => new ctor() });
    },
  };
}
