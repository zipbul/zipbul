# `@zipbul/mikro-orm` — Feature Support Matrix

Scope: **Bun.SQL only** (no hybrid, no official `pg`/`mysql2` driver). MikroORM v7.1.1 over
Bun's native Bun.SQL via a custom Kysely dialect, reusing the official MikroORM Platform.

Sources: official Bun.SQL docs + official MikroORM docs + source audit + **integration tests
run against real Postgres 18 + MySQL 9 + in-memory SQLite**. Every ✅ below has a passing
integration test in `test/integration/`.

## ✅ Supported & verified

| Feature | Notes / test |
|---|---|
| CRUD (insert/find/update/delete), autoincrement id | `round-trip`, `sqlite`, `mysql` |
| **Affected row count** (nativeUpdate/nativeDelete) | `affectedRows ?? count` — mysql uses `.affectedRows`, pg uses `.count` |
| Transactions (commit/rollback) | `transaction`, `mysql`, `sqlite` |
| Nested transactions / **savepoints** (rollback isolation) | quoted+escaped identifiers; `transaction`, `sqlite` |
| Isolation levels / access mode (engine-correct: pg composes into BEGIN, mysql SETs before START, sqlite n/a) | `bun-sql-transaction.spec` + `transaction` (asserts the level actually takes effect via `show transaction_isolation`) |
| **Connection pooling** via `reserve()` (pg/mysql), 20 concurrent txns | `transaction` |
| Schema generation (create/drop) + introspection/diff | `helpers` + spike |
| Migrations (Migrator up/down) | needs `tinyglobby`; spike-verified |
| Error → typed exception (UniqueConstraintViolation) | pg + mysql + sqlite — `error-normalization`, `sqlite` |
| Relations 1:1 / 1:n / n:1 / m:n (+ pivot) + populate + query-by-relation | `relations` |
| QueryBuilder: limit/offset, count, GROUP BY/HAVING/aggregate | `query-builder` |
| **Pessimistic locking** (SELECT … FOR UPDATE) | `locking` |
| **Optimistic locking** (@Version) incl. concurrent conflict | `locking` (NOT broken — corrects the audit) |
| Batch insert, **upsert / upsertMany** | `batch-upsert` |
| Embeddables (flattened columns, query by embedded prop) | `embeddable-hooks` |
| Lifecycle hooks (@BeforeCreate) | `embeddable-hooks` |
| Single-table inheritance (discriminator) | `inheritance-filters` |
| **Class-table inheritance** (joined — each subclass its own table) | `table-inheritance` |
| Filters / soft-delete (@Filter default) | `inheritance-filters` |
| **Cascade** persist/remove + **orphan removal** | `cascade` |
| **Full lifecycle hooks** (Before/After Create·Update·Delete, @OnLoad) | `lifecycle-hooks` |
| **Event subscribers** (`EventSubscriber`, create/update/delete) | `subscriber` |
| **Composite primary keys** (multi-column PK + uniqueness) | `composite-pk` |
| **Custom `Type`** (convertToDatabaseValue / convertToJSValue) | `custom-type` |
| **QueryBuilder joins** (leftJoinAndSelect, innerJoin+where), nested-relation subquery, **raw fragments** | `qb-advanced` |
| **Cursor pagination** (`findByCursor`, keyset) + `em.execute` raw | `query-features` |
| Identity map / UnitOfWork / per-request fork (RequestContext) | `context-lifecycle` |
| Named connections (registry coexistence) | `context-lifecycle` |
| Query logging (SQL + BEGIN/COMMIT reach the logger) | `logging` |
| Types: Date, json, bigint(no precision loss), decimal, boolean, **string[]**, uuid, enum, **bytea/Buffer** | `types`, `types-edge`, `mysql` |
| MySQL: tinyint(1) boolean, datetime, json, decimal | `mysql` |
| **Multiple schemas** (entity bound to a non-public schema) | `multi-schema` |
| **Read replicas** (write→primary, read→replica on a distinct connection) | `replica` — MikroORM opens one connection per replica; the driver makes a Bun.SQL client per connection |
| **Stored functions / procedures** via raw `execute()` (`SELECT func(...)`, `CALL proc()`) | `stored-procedure` |
| **`em.callRoutine(...)`** — pg & mysql functions + procedures, scalar OUT params, pg refcursor OUT params (FETCH'd inside a transaction), mysql `@var` OUT/INOUT params | `call-routine`, `call-routine-mysql` |
| **`driverOptions`** merged into the Bun.SQL dialect (custom `createClient`, `poolMax`, `pooled`, `url`) — the official drivers' overrides contract | `connection-config` |
| **PostgreSQL-flavoured EntityManager** (`orm.em` is a `PostgreSqlEntityManager`; pg-only helpers like `refreshMaterializedView`) | `materialized-view` |
| **SSL / TLS** (sslmode pass-through; backend connection actually encrypted) | `ssl` (gated on `DB_URL_PG_SSL`; verified via `pg_stat_ssl`) |
| **Graceful shutdown** — `close(true)` drains in-flight work before teardown | `graceful-shutdown` |
| **MariaDB** (via the MySQL protocol/driver) | `mysql` lane run against MariaDB 11 — CRUD/tx/unique-exception/Date/decimal/**json** all pass |
| **MySQL / MariaDB `JSON` columns → parsed objects** | Bun.SQL returns MySQL/MariaDB JSON as a raw string (unlike `mysql2`); `BunMySqlPlatform.convertsJsonAutomatically()` returns `false` so MikroORM parses it. Round-trips as an object on both MySQL 8 and MariaDB 11. | `mysql` |

## ⚠️ Supported with a documented nuance
| Feature | Nuance |
|---|---|
| `integer[]` arrays | Values round-trip intact, but MikroORM's default ArrayType yields **string elements** (`["1","2","3"]`) over Bun.SQL (no OID type-parser control). Use a typed ArrayType for native number elements. Driver passes the array correctly. `types-edge` |
| pg fine type-parser control | Bun.SQL does its own coercion; MikroORM's `createPostgreSqlTypeParsers`/TypeOverrides are not applied. Common types verified; exotic types fall back to Bun's coercion. |

## 🚫 Not supported (Bun.SQL hard ceiling — documented, explicit error, NOT silent)

> **Sourced, not assumed.** The Bun.SQL API docs explicitly state: *"We haven't implemented
> COPY / LISTEN / NOTIFY / LOAD DATA INFILE support."* Cursors/streaming and custom type
> parsers are absent from the docs (unimplemented). Roadmap status (Bun tracking issue
> [oven-sh/bun#15088](https://github.com/oven-sh/bun/issues/15088), checked 2026-05): the gaps
> below are **planned but have no milestone, owner, linked PR, or committed timeline**.

| Feature | Reason / roadmap |
|---|---|
| **Streaming** (`em.stream()` / `qb.stream()`) | No cursor in Bun.SQL. Throws `StreamingUnsupportedError` — fail-fast, never a silent OOM fallback. Roadmap: "Async iterators support" is an open checklist item in #15088; feature requests [#17181](https://github.com/oven-sh/bun/issues/17181) (cursor), [#25307](https://github.com/oven-sh/bun/issues/25307) (stream) — open, no commitment. **Most likely to land.** |
| **LISTEN / NOTIFY** pub-sub | Docs: explicitly not implemented. Request [#18214](https://github.com/oven-sh/bun/issues/18214) — open, not on the #15088 checklist, no maintainer response. **Weakest roadmap signal.** |
| PostGIS / Point types, multi-dim & NULL-element arrays | Open checklist item "Support Point & geo-related types" in #15088 — planned, no timeline. |
| SQLite **`em.callRoutine` functions** (UDF bridge via `bodyJs`) | The official SQLite driver registers `bodyJs` as a UDF through better-sqlite3's `database.function()`. Bun.SQL exposes **no UDF-registration API** (verified: the sqlite client has no `.function`/`.loadExtension`). `callRoutine` throws an explicit, actionable error. SQLite procedures are unsupported on every driver (SQLite has none). |
| Fine type-parser control (`TypeOverrides`) | Not documented / not on the roadmap — Bun.SQL owns coercion. (See the nuance table.) |

> **Not a ceiling — pg `callRoutine` refcursor OUT params DO work.** They are fetched with
> `FETCH ALL FROM <cursor>` inside the caller's transaction (plain SQL, no pg-protocol cursor
> object), so they do not need the streaming/cursor support Bun.SQL lacks. See `call-routine`.

> COPY bulk-load is "unsupported" in Bun.SQL but **not a gap** — MikroORM uses multi-row
> INSERT, which works.

## Per-database
| | Postgres | MySQL | MariaDB | SQLite |
|---|---|---|---|---|
| CRUD / tx / savepoint | ✅ | ✅ | ✅ | ✅ |
| Connection model | pooled (reserve) | pooled (reserve) | pooled (reserve) | single connection (no reserve) |
| Unique → exception | ✅ | ✅ | ✅ | ✅ |
| JSON columns | ✅ object | ✅ object | ✅ object | ✅ object |
| `em.callRoutine` | ✅ fn + proc + OUT + refcursor | ✅ fn + proc + `@var` OUT | ✅ (same as MySQL) | 🚫 no UDF API (explicit error) |
| Streaming | 🚫 | 🚫 | 🚫 | 🚫 |

## Verification lanes
All ✅ have a passing test in `test/integration/`. Docker-backed lanes skip cleanly when
their env is absent: `DB_URL_PG`, `DB_URL_MYSQL` (point at MySQL or MariaDB),
`DB_URL_PG_SSL` (an SSL-enabled postgres, e.g. `...?sslmode=require`). Verified against
Postgres 18/16, MySQL 9, MariaDB 11, in-memory SQLite.
