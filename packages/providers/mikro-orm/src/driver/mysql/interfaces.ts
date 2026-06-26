/** Loose view of the inherited `QueryResult` for the post-insert PK back-fill mutation. */
export interface MutableResult {
  rows: Record<string, unknown>[] | undefined;
  row: Record<string, unknown> | undefined;
  insertId: number | bigint | undefined;
}
