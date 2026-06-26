<h1 align="center">@zipbul/mikro-orm</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@zipbul/mikro-orm"><img src="https://img.shields.io/npm/v/@zipbul/mikro-orm?style=flat-square&color=cb3837&logo=npm" alt="npm"></a>
  <img src="https://img.shields.io/badge/bun-%3E%3D1.3-000?style=flat-square&logo=bun" alt="bun >= 1.3">
  <img src="https://img.shields.io/badge/MikroORM-v7-2d3748?style=flat-square" alt="MikroORM v7">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT">
</p>

<p align="center">
  <em><b>MikroORM v7 on Bun's native SQL.</b> PostgreSQL · MySQL · MariaDB · SQLite —<br>one interface, zero native drivers (no <code>pg</code> / <code>mysql2</code> / <code>better-sqlite3</code>).</em>
</p>

> It runs the SQL MikroORM generates through **Bun.SQL only** and returns results in the exact shape
> MikroORM expects. The bar: **behave like the official `@mikro-orm/*` SQL drivers** — the only
> allowed deviations are Bun.SQL hard ceilings that **fail loudly** and are documented below.

<br>

## 📦 Installation

```bash
bun add @zipbul/mikro-orm
```

Install MikroORM v7 + Kysely and the `@mikro-orm` driver package for **your** database:

```bash
bun add @mikro-orm/core @mikro-orm/sql @mikro-orm/decorators kysely
bun add @mikro-orm/postgresql   # or @mikro-orm/mysql / @mikro-orm/sqlite
```

> Requires **Bun ≥ 1.3**. The native drivers (`mysql2`, `pg`, …) are never imported at runtime — Bun.SQL replaces them.
>
> Each driver is a **separate subpath** (`@zipbul/mikro-orm/postgresql`, `/mysql`, `/mariadb`, `/sqlite`), so importing the package root never pulls the other dialects — install only the one you use. (`@zipbul/mikro-orm/mariadb` additionally needs `@mikro-orm/mysql`, since MariaDB extends MySQL.)

<br>

## 💡 Core Concept

This package is a **driver layer**, not a new ORM. You use MikroORM exactly as documented; this
package supplies the Bun.SQL-backed driver and a thin, zipbul-native DX on top.

```
your entities + MikroORM API
        │
        ▼
Bun<Db>Driver  ──►  official @mikro-orm/<db> Platform   (quoting, types, exception mapping)
        │           reused as-is; overridden only where Bun.SQL diverges
        ▼
Bun.SQL  ──►  PostgreSQL · MySQL · MariaDB · SQLite
```

On top of the driver it adds three small framework primitives — `MikroOrmService` (DI lifecycle),
`BaseRepository` (per-request repository), and a request-scoped `EntityManager` via
`AsyncLocalStorage`.

<br>

## 🚀 Quick Start

Entities use **modern ES decorators** (TC39 stage-3, no `reflect-metadata`), so every property
declares its `type` explicitly.

```typescript
import {
  Entity, PrimaryKey, Property,
  MikroOrmService, BaseRepository,
} from '@zipbul/mikro-orm';
import { BunMariaDbDriver } from '@zipbul/mikro-orm/mariadb'; // driver from its own subpath

@Entity()
export class User {
  @PrimaryKey({ type: 'number', autoincrement: true }) id!: number;
  @Property({ type: 'string', unique: true }) email!: string;
}

// A DI singleton owns the MikroORM instance. `@Injectable` comes from your zipbul app.
@Injectable({ scope: 'singleton', visibleTo: 'all' })
export class Database extends MikroOrmService {
  protected readonly options = {
    driver: BunMariaDbDriver,
    clientUrl: process.env.DB_URL,
    entities: [User],
  };
}

// Inject it like NestJS's `@InjectRepository` — every access resolves the current request's fork.
@Injectable({ visibleTo: 'all' })
export class UserRepository extends BaseRepository<User> {
  protected readonly entity = User;
}
```

```typescript
// in a handler — UserRepository behaves as MikroORM's EntityRepository<User>
const user = await userRepository.findOneOrFail({ email });
const em = userRepository.getEntityManager();
em.persist(user);
await em.flush();
```

<br>

## 🗄️ Supported Databases

| Database | Driver | Connection model | Verified |
|---|---|---|---|
| PostgreSQL | `BunPostgreSqlDriver` | pooled (`reserve()`) | 18 |
| MySQL | `BunMySqlDriver` | pooled (`reserve()`) | 9.7 |
| MariaDB | `BunMariaDbDriver` | pooled (`reserve()`) | 11.8 |
| SQLite | `BunSqliteDriver` | single connection | `:memory:` / file |

Each driver subclasses the official `@mikro-orm/<db>` Platform/Driver and overrides **only** where
Bun.SQL diverges from the native driver — quoting, `getMappedType`, exception conversion, pivot SQL,
and `RETURNING` vs `lastInsertRowid` all match the official driver.

<br>

## ✨ Features

| | Supported |
|---|---|
| CRUD, autoincrement, batch insert, **upsert / upsertMany** | ✅ |
| Transactions, **nested transactions / SAVEPOINTs** (rollback isolation) | ✅ |
| **Isolation levels & access mode** — engine-correct, actually applied | ✅ |
| Relations (1:1 / 1:n / n:1 / m:n + pivot), populate, query-by-relation | ✅ |
| QueryBuilder — joins, GROUP BY/HAVING/aggregate, raw fragments, **cursor pagination** | ✅ |
| **Pessimistic** (`FOR UPDATE`) & **optimistic** (`@Version`) locking | ✅ |
| Embeddables, single-table & table-per-concrete inheritance, filters / soft-delete | ✅ |
| Full lifecycle hooks, event subscribers, cascade / orphan removal | ✅ |
| Composite primary keys, custom `Type`, multi-schema (pg) | ✅ |
| Read replicas, stored functions / procedures, **`em.callRoutine(...)`** | ✅ |
| Schema generation + introspection | ✅ |
| **Type fidelity** — Date/`timestamp`·`datetime` round-trip the exact UTC instant under any host TZ, json→object, decimal exact, bigint no-loss, bytea/Buffer, mysql `tinyint(1)`→bool | ✅ |
| Constraint → typed exception (Unique / NotNull / Check / FK / TableNotFound) | ✅ |
| SSL/TLS — `?sslmode=require` URL pass-through (verified on MySQL · MariaDB) | ✅ |
| **Request-scoped EntityManager** over real concurrency (AsyncLocalStorage) | ✅ |

<br>

## 🔁 Request-Scoped EntityManager

Each HTTP request gets its **own forked `EntityManager`** (its own identity map / unit of work).
Call `enter()` from a request middleware; `BaseRepository` and `service.em` then resolve that fork
transparently.

```typescript
// OnRequest middleware — open a per-request context for this connection
db.enter();

// anywhere downstream, on the same request:
db.em;                       // the request's forked EntityManager
userRepository.find({ … });  // resolves the same fork — isolated from other requests
```

> Isolation is provided by MikroORM's `RequestContext` over `AsyncLocalStorage`. Call `enter()` only
> inside a request scope; reading the EM outside any request returns the global EM.

<br>

## 📤 Error Handling

Two channels, never mixed — both are types this package guarantees, so you can `instanceof` / branch
exactly.

**1. `MikroOrmError`** — failures found without request input (config/boot invariants, Bun.SQL hard
ceilings, transaction/driver misuse). One class, coded by `reason`:

```typescript
import { MikroOrmError, MikroOrmErrorReason } from '@zipbul/mikro-orm';

try { /* … */ } catch (e) {
  if (e instanceof MikroOrmError && e.reason === MikroOrmErrorReason.StreamingUnsupported) { … }
}
```

**2. MikroORM's typed constraint exceptions** — per-request DB violations, produced by MikroORM's
own `ExceptionConverter` and re-exported **unchanged** (so MikroORM's `instanceof` keeps working):

```typescript
import { UniqueConstraintViolationException } from '@zipbul/mikro-orm';
// also: ForeignKey… / NotNull… / CheckConstraintViolationException
```

<br>

## 🧱 Hard Ceilings (Bun.SQL)

These are genuine Bun.SQL limitations. Each **throws an explicit, actionable error — never a silent
fallback** — and is the *only* allowed deviation from official-driver behavior.

| Limitation | Behavior |
|---|---|
| **Cursor streaming** (`em.stream()` / `qb.stream()`) | throws `MikroOrmError(StreamingUnsupported)` — no cursor protocol in Bun.SQL |
| **LISTEN / NOTIFY** pub-sub | not implemented in Bun.SQL |
| **SQLite UDF** (`callRoutine` functions via `bodyJs`) | throws `MikroOrmError(SqliteRoutineUnsupported)` — Bun.SQL exposes no UDF-registration API |
| **pg refcursor OUT without a transaction** | throws `MikroOrmError(RefcursorRequiresTransaction)` — wrap in `em.transactional(...)` |
| **Function `user`/`password`** (async IAM token) | throws `MikroOrmError(FunctionCredentialUnsupported)` — pre-resolve to a string |

**Type-parser nuances** (Bun.SQL owns coercion; no `TypeOverrides` API):

- `integer[]` arrays round-trip intact but yield **string elements** (`["1","2"]`) — use a typed `ArrayType` for native numbers.
- A `timestamp` with **year 0–99** is collapsed to 1900–1999 by Bun.SQL's parser before it reaches us (ancient dates only).
- MySQL/MariaDB discrete options `timezone` / `forceUtcTimezone` / `multipleStatements` are not read from option keys — pass them via `clientUrl` query params or `driverOptions`.

<br>

## ⚙️ Configuration

Accepts a full `clientUrl` **or** discrete `host`/`port`/`user`/`password`/`dbName`; `driverOptions`
are merged into the Bun.SQL dialect.

```typescript
protected readonly options = {
  driver: BunPostgreSqlDriver,
  clientUrl: 'postgres://user:pass@host:5432/db?sslmode=require',
  pool: { max: 20 },
  entities: [/* … */],
  // driverOptions: { poolMax, pooled, createClient, url }
};
```

Name multiple connections with the `connection` option; each `MikroOrmService` owns one connection
name (registering the same name twice throws `ConnectionAlreadyRegistered`).

<br>

## 📄 License

MIT © [Junhyung Park](https://github.com/parkrevil)
