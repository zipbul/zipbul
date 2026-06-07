# `@zipbul/mikro-orm` — Conformance Bar (defect-free criteria)

The single bar this package is held to: **it must behave exactly like an official MikroORM SQL
driver (`@mikro-orm/postgresql` / `mysql` / `sqlite`) for every contract surface, on every
supported database, with the only allowed deviations being Bun.SQL hard ceilings that fail loudly
and are documented.** "Defect" = any observable divergence from the official driver's behavior
(the de-facto standard — judged against the official driver / `qs` / spec, NOT against our own
docs). The bar is derived from the MikroORM driver contract (`IDatabaseDriver`, `AbstractSqlDriver`,
`AbstractSqlConnection`, `Connection`, `*Platform`, `*ExceptionConverter`) and RED-PLAN.md.

Databases in scope: **PostgreSQL, MySQL, MariaDB, SQLite** — all over **Bun.SQL only** (no `pg`,
`mysql2`, `better-sqlite3`). Each criterion is met ONLY when a test proves it on the real DB(s).

## C1 — Driver contract completeness (`IDatabaseDriver` / `AbstractSqlDriver`)
Every method works or is correctly inherited; no base method that throws "not supported" is left
unimplemented where the DB supports the feature. Covers: find/findOne/findVirtual/count/countVirtual,
nativeInsert/Update/Delete, nativeInsertMany/nativeUpdateMany (MySQL PK back-fill), nativeClone,
loadFromPivotTable, syncCollections, mapResult, lockPessimistic, createEntityManager (pg → PG EM),
getConnection/connect/close/reconnect, execute, getPlatform/getDependencies.

## C2 — Connection contract (`AbstractSqlConnection` / `Connection`)
- `createKyselyDialect(overrides)` per dialect; merges `driverOptions`.
- `execute` → `transformRawResult` returns the exact `{rows, numAffectedRows, insertId}` shape for
  SELECT / INSERT / UPDATE / DELETE on each DB.
- `begin/commit/rollback/transactional` + nested → SAVEPOINT; isolation level + access mode actually
  applied (not silently dropped); savepoint identifiers escaped.
- `callRoutine`: functions, procedures, scalar OUT, pg refcursor OUT (FETCH-in-tx), mysql `@var` OUT/INOUT.
- `executeDump`, `getConnectionOptions` (clientUrl OR discrete host/port).

## C3 — Platform correctness
Reuse the official platform; override ONLY where Bun.SQL diverges from the assumed driver
(`convertsJsonAutomatically` for MySQL). Quoting, `getMappedType`, `usesReturningStatement`,
default schema, pivot SQL must match the official platform.

## C4 — Exception mapping (every subtype, every DB)
Every exception class the official `*ExceptionConverter` can produce must fire from the driver path
(`driver.execute`/`flush`/`nativeX`) on each DB: Unique, NotNull, Check, ForeignKey, TableNotFound,
TableExists, Deadlock, LockWaitTimeout, InvalidFieldName, NonUniqueFieldName, SyntaxError,
Connection, InvalidField. No DB error may degrade to a bare `DriverException` when a typed class exists.

## C5 — Type round-trips (no silent corruption)
Every column type persists and re-reads as the correct JS value on each DB: string, number,
boolean, bigint (no precision loss), decimal (exact), Date/timestamp, json/jsonb, uuid, enum,
bytea/Buffer, arrays, mysql tinyint(1), sqlite affinity. A read value differing in type or value
from what the official driver returns is a defect.

## C6 — Result correctness (insertId / affected / RETURNING)
INSERT returns the right PK (pg RETURNING; mysql/sqlite lastInsertRowid; mysql batch =
insertId + idx*auto_increment_increment); UPDATE/DELETE return the right affected-row count;
batch operations assign each row its own PK. On each DB.

## C7 — Schema generation / diff / migration
`getCreateSchemaSQL` DDL is correct; introspection (`getColumns`/list tables/indexes/FKs) returns
correctly-shaped rows through Bun.SQL; `schema.diff` of an in-sync schema is empty; Migrator up/down
runs. On pg + mysql (sqlite where applicable).

## C8 — Framework integration (zipbul)
DI `MikroOrmService` lifecycle (onInit registers, onDestroy drains, non-destructive);
`BaseRepository` Proxy resolves the request fork; `RequestContextRunner` ALS gives each concurrent
HTTP request its own forked EM (isolation under real concurrency); `ConnectionRegistry` named
connections coexist; error → HTTP filter mapping.

## C9 — Hard ceilings (loud, documented, no silent fallback)
Each genuine Bun.SQL limitation throws an explicit, actionable error (never a silent/buffered
fallback) and is documented in FEATURE-MATRIX.md: cursor streaming (`em.stream`/`qb.stream`),
LISTEN/NOTIFY, SQLite UDF (`callRoutine` functions), refcursor-without-transaction, fine
type-parser control. These are the ONLY allowed feature gaps.

## C10 — Quality gates
Package `tsc --noEmit` = 0 errors; full `bun test` green across pg + MySQL + MariaDB + sqlite;
coverage threshold met; no `test.only`; no stale/speculative TODO (comments must state verified
facts); every `@internal` normalizer's behavior backed by a test.

---
**Process:** RED-first TDD. A criterion is "done" only when (a) a test asserts the official-equivalent
behavior on the real DB, and (b) it is GREEN. Defects are hunted adversarially per criterion until a
fresh hunt comes up dry.
