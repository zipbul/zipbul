/**
 * Discriminant for every {@link import('./errors').MikroOrmError} the package throws. One error
 * class + a `reason` code is the framework convention (cf. `RateLimiterErrorReason`), so consumers
 * branch on `error.reason` rather than on a class-per-fault hierarchy.
 */
export enum MikroOrmErrorReason {
  /** An EntityManager was resolved for a connection name that was never registered. */
  ConnectionNotRegistered = 'connection_not_registered',
  /** Cursor streaming was requested — a hard Bun.SQL ceiling (no cursor protocol). */
  StreamingUnsupported = 'streaming_unsupported',
  /** A function/async `user`/`password` was supplied — the URL is built synchronously. */
  FunctionCredentialUnsupported = 'function_credential_unsupported',
  /** An unknown transaction isolation level / access mode reached the controller. */
  UnsupportedTransactionMode = 'unsupported_transaction_mode',
  /** A stored routine was invoked on SQLite — Bun.SQL exposes no UDF registration API. */
  SqliteRoutineUnsupported = 'sqlite_routine_unsupported',
  /** A pg refcursor OUT parameter was requested outside a transaction (cursor needs one). */
  RefcursorRequiresTransaction = 'refcursor_requires_transaction',
  /** The Kysely driver was used before `init()`. (internal invariant) */
  DriverNotInitialized = 'driver_not_initialized',
  /** A pooled driver received a Bun.SQL client without `reserve()`. (internal invariant) */
  PooledDriverRequiresReserve = 'pooled_driver_requires_reserve',
  /** A batch operation requires a single-column primary key. (internal invariant) */
  BatchSingleColumnPrimaryKey = 'batch_single_column_primary_key',
}
