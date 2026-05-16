import type { ProviderToken, ProviderScope, ProviderVisibleTo, ZipbulValue } from '@zipbul/common';

/**
 * Registration record captured by override builders before {@link compile}.
 *
 * @internal
 */
export interface OverrideRecord {
  readonly token: ProviderToken;
  readonly factory: (...args: unknown[]) => unknown;
  readonly scope?: ProviderScope;
  readonly visibleTo?: ProviderVisibleTo;
}

/**
 * In-memory collection of root + request override records.
 *
 * @internal
 */
export class OverrideRegistry {
  private readonly _root: OverrideRecord[] = [];
  private readonly _request: OverrideRecord[] = [];

  addRoot(record: OverrideRecord): void {
    this._root.push(record);
  }

  addRequest(record: OverrideRecord): void {
    this._request.push(record);
  }

  get root(): ReadonlyArray<OverrideRecord> {
    return this._root;
  }

  get request(): ReadonlyArray<OverrideRecord> {
    return this._request;
  }
}

/**
 * Fluent provider override entry point — `.useValue / .useFactory / .useClass`.
 *
 * @public
 */
export interface ProviderOverrideBuilder<TBuilder> {
  useValue(value: ZipbulValue): TBuilder;
  useFactory(factory: (...args: unknown[]) => unknown): TBuilder;
  useClass(ctor: new (...args: unknown[]) => unknown): TBuilder;
}

/**
 * Creates a `ProviderOverrideBuilder` bound to a registry slot.
 *
 * @internal
 */
export function makeProviderOverrideBuilder<TBuilder>(
  back: TBuilder,
  push: (record: OverrideRecord) => void,
  token: ProviderToken,
  scope?: ProviderScope,
): ProviderOverrideBuilder<TBuilder> {
  return {
    useValue(value) {
      push({ token, factory: () => value, ...(scope !== undefined ? { scope } : {}) });
      return back;
    },
    useFactory(factory) {
      push({ token, factory, ...(scope !== undefined ? { scope } : {}) });
      return back;
    },
    useClass(ctor) {
      push({ token, factory: () => new ctor(), ...(scope !== undefined ? { scope } : {}) });
      return back;
    },
  };
}
