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
| Isolation levels / access mode | `bun-sql-transaction.spec` + `transaction` |
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
| Filters / soft-delete (@Filter default) | `inheritance-filters` |
| Identity map / UnitOfWork / per-request fork (RequestContext) | `context-lifecycle` |
| Named connections (registry coexistence) | `context-lifecycle` |
| Query logging (SQL + BEGIN/COMMIT reach the logger) | `logging` |
| Types: Date, json, bigint(no precision loss), decimal, boolean, **string[]**, uuid, enum, **bytea/Buffer** | `types`, `types-edge`, `mysql` |
| MySQL: tinyint(1) boolean, datetime, json, decimal | `mysql` |

## ⚠️ Supported with a documented nuance
| Feature | Nuance |
|---|---|
| `integer[]` arrays | Values round-trip intact, but MikroORM's default ArrayType yields **string elements** (`["1","2","3"]`) over Bun.SQL (no OID type-parser control). Use a typed ArrayType for native number elements. Driver passes the array correctly. `types-edge` |
| pg fine type-parser control | Bun.SQL does its own coercion; MikroORM's `createPostgreSqlTypeParsers`/TypeOverrides are not applied. Common types verified; exotic types fall back to Bun's coercion. |

## 🚫 Not supported (Bun.SQL hard ceiling — documented, explicit error, NOT silent)
| Feature | Reason |
|---|---|
| **Streaming** (`em.stream()` / `qb.stream()`) | Bun.SQL has no cursor (officially "not yet implemented"). Throws `StreamingUnsupportedError` — fail-fast, never a silent OOM fallback. |
| **LISTEN / NOTIFY** pub-sub | Bun.SQL officially not implemented. (Not a MikroORM-core feature.) |
| PostGIS / Point types, multi-dim & NULL-element arrays | Bun.SQL officially not implemented. |
| `callRoutine` / stored-procedure refcursor OUT params | Not implemented in this driver. |
| Read replicas | Bun.SQL is single-URL; multi-pool replicas not wired. |

> COPY bulk-load is "unsupported" in Bun.SQL but **not a gap** — MikroORM uses multi-row
> INSERT, which works.

## Per-database
| | Postgres | MySQL | SQLite |
|---|---|---|---|
| CRUD / tx / savepoint | ✅ | ✅ | ✅ |
| Connection model | pooled (reserve) | pooled (reserve) | single connection (no reserve) |
| Unique → exception | ✅ | ✅ | ✅ |
| Streaming | 🚫 | 🚫 | 🚫 |

## Still to verify (low-risk, ops)
Multiple schemas (test authored), graceful-shutdown drain, MariaDB, SSL/TLS options.
