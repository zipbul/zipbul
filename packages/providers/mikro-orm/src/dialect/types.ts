/**
 * Bun's global `SQL` client (postgres/mysql pool, or sqlite handle). Bun does not
 * ship a type for the constructed client, so we alias the structural surface we use.
 */
export type BunSqlClient = {
  reserve(): Promise<ReservedConnection>;
  unsafe(query: string, params: readonly unknown[]): Promise<unknown>;
  close?(): Promise<void> | void;
};

/** A reserved (pool-pinned) Bun.SQL connection — required for pooled transactions. */
export type ReservedConnection = {
  unsafe(query: string, params: readonly unknown[]): Promise<unknown>;
  release(): Promise<void> | void;
};
