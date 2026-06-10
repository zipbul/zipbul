# `@zipbul/mikro-orm` — 아키텍처 / 디렉토리 구조 (확정)

위치: `packages/providers/mikro-orm` (그룹 `providers/` = DI로 주입되는 인프라 리소스 제공자: 향후 redis/bullmq/mailer/s3 형제).
근거: `../../../DESIGN-MIKRO-ORM.md`(검증된 설계) + 4-렌즈 적대적 구조 리뷰 + 공식 `@mikro-orm` 드라이버 패키지 구조 실측(아래 §7) + 7-렌즈 멀티에이전트 크로스리뷰(확정 14건 반영, §7·§8 정정).

## 0. 설계 원칙 (불변 규칙)
- **SRP**: 한 파일 = 한 책임. 디렉토리 = 한 도메인(책임).
- **4-버킷 파일**(`interfaces.ts`/`types.ts`/`enums.ts`/`constants.ts`): 그 문법이 **실제로 존재하는 도메인 안에만** 둔다. 전역 버킷 디렉토리 금지. **내용 없으면 만들지 않는다**(빈 버킷 금지).
- **배럴 `index.ts` 도메인마다 필수**. 크로스 도메인 import는 **대상 도메인 배럴 경유**. 파일 직접 import 금지.
- **클래스 베이스**: 클래스 우선, 함수 최소화. 함수 예외 = `entity/`의 데코레이터 재export, 그리고 `driver/shared/`의 mixin 팩토리(아래 §6 근거).
- **enums.ts 0개**(확정): DB는 드라이버 **클래스**로 구분(discriminant 값 없음). IsolationLevel/AccessMode는 upstream 타입을 **소비**(로컬 재정의 금지).
- **네이밍 규약**(전면 통일): 우리 클래스는 전부 `Bun` 접두, 파일은 `<db>.` 접두. 공식 클래스(`MySqlPlatform`, `MariaDbPlatform` …)와 우리 래퍼(`BunMySqlPlatform` …)를 한눈에 구분.
- **공식 동등성**: 각 `driver/<db>` 는 공식 `@mikro-orm/<db>` 클래스를 **상속**하고, Bun.SQL이 공식 네이티브 드라이버(pg/mysql2/...)와 **다르게 동작하는 지점만** override. 임의 재구현 금지.

## 1. 도메인 목록 (7개)
| 도메인 | 책임 | 의존(배럴 경유) |
|---|---|---|
| `entity/` | 모던 ES 엔티티 데코레이터 단일 import 표면 | (leaf) |
| `bun-sql/` | Bun.SQL ↔ Kysely 글루 (DB 무관; per-DB parts·normalizer 주입) | (leaf, kysely) |
| `driver/<db>/` | MikroORM 드라이버 레이어 (DB별; 공식 Platform 상속). `driver/shared/`에 크로스-DB Bun.SQL 타입 보정 | `bun-sql` |
| `connection/` | 커넥션 토폴로지/레지스트리 (어떤 ORM 인스턴스가 존재하는가) | (leaf, @mikro-orm/core) |
| `context/` | per-request EntityManager 접근 경계 (ALS) | `connection` |
| `orm/` | DI 브리지 — 사용자가 @Injectable 상속하는 베이스 | `connection`, `context` |
| `repository/` | Repository 베이스 — 사용자가 @Injectable 상속 | `context`, `connection` |

## 2. 의존성 DAG (acyclic)
```
entity            (leaf)
bun-sql           (leaf; kysely)
driver/shared     (leaf; @mikro-orm/core type-helpers)
driver/<db>     ─▶ bun-sql, driver/shared
connection        (leaf; @mikro-orm/core)
context         ─▶ connection
orm             ─▶ connection, context
repository      ─▶ context, connection      (DEFAULT_CONNECTION 값 import)
root index      ─▶ entity, bun-sql, driver, connection, context, orm, repository   (배럴만)
```
사이클 없음. 각 크로스 도메인 엣지는 대상 배럴 1개로만 연결.

## 3. 파일 트리 + 파일별 단일 책임
```
packages/providers/mikro-orm/
├── package.json / tsconfig.json / tsconfig.build.json
├── ARCHITECTURE.md / CONFORMANCE.md / FEATURE-MATRIX.md / RED-PLAN.md / CLAUDE.md
├── index.ts                             # ROOT 배럴: export * from './src/<domain>' ×7 + ZIPBUL_PACKAGE
└── src/
    ├── entity/
    │   └── index.ts                     # export * from '@mikro-orm/decorators/es'  (함수 예외; 큐레이션 안 함)
    │
    ├── bun-sql/                         # (구 dialect/ — Kysely Dialect와의 용어 혼동 제거 위해 개명)
    │   ├── bun-sql-connection.ts        # class BunSqlConnection implements kysely DatabaseConnection
    │   │                                #   executeQuery: Bun.SQL 결과→{rows, numAffectedRows, insertId}; bigint 정규화; catch→ErrorNormalizer→rethrow
    │   │                                #   streamQuery: StreamingUnsupportedError (하드실링)
    │   ├── bun-sql-transaction.ts       # class BunSqlTransactionController (dialect-aware begin/isolation/accessMode/savepoint)
    │   ├── bun-sql-kysely-driver.ts     # class BunSqlKyselyDriver implements kysely Driver (커넥션 수명 + tx 위임)
    │   ├── bun-sql-dialect.ts           # class BunSqlDialect implements kysely Dialect (주입된 KyselyDialectParts·ErrorNormalizer 사용)
    │   ├── build-url.ts                 # resolveBunSqlUrl(dialect, clientUrl, components) + ConnectionComponents
    │   ├── interfaces.ts                # KyselyDialectParts, BunSqlDialectOptions, ErrorNormalizer(계약)
    │   ├── types.ts                     # BunSqlClient, ReservedConnection, SqlDialectKind
    │   ├── constants.ts                 # DEFAULT_POOL_MAX (internal)
    │   ├── errors.ts                    # StreamingUnsupportedError
    │   └── index.ts                     # 배럴(크로스도메인 표면)
    │
    ├── driver/
    │   ├── shared/                      # 크로스-DB Bun.SQL 타입 보정 (현재 driver/ 루트에 떠있던 것 정리)
    │   │   ├── bun-utc-datetime.type.ts # class BunUtcDateTimeType (no-tz 컬럼의 wall-clock을 UTC로 재해석)
    │   │   ├── with-bun-mysql-fixes.ts  # mixin: <P extends MySqlPlatform-계열>(Base)=> convertsJsonAutomatically()=false + getMappedType(datetime→BunUtcDateTimeType)
    │   │   └── index.ts                 # export { BunUtcDateTimeType, withBunMySqlFixes }
    │   │
    │   ├── postgres/
    │   │   ├── postgres.platform.ts          # class BunPostgreSqlPlatform extends PostgreSqlPlatform (date→'YYYY-MM-DD' string, timestamp→BunUtcDateTimeType)
    │   │   ├── postgres.connection.ts        # class BunPostgreSqlConnection extends AbstractSqlConnection → BunSqlDialect(POSTGRES_KYSELY_PARTS, BunPostgreSqlErrorNormalizer, opts)
    │   │   ├── postgres.driver.ts            # class BunPostgreSqlDriver extends AbstractSqlDriver
    │   │   ├── postgres.error-normalizer.ts  # class BunPostgreSqlErrorNormalizer (SQLSTATE errno→code; detail/constraint/table 보존) [internal]
    │   │   ├── postgres.kysely-parts.ts      # POSTGRES_KYSELY_PARTS (Postgres Adapter/Compiler/Introspector) [internal]
    │   │   └── index.ts                      # export { BunPostgreSqlDriver }
    │   │
    │   ├── mysql/
    │   │   ├── mysql.platform.ts             # class BunMySqlPlatform = withBunMySqlFixes(MySqlPlatform)  (@mikro-orm/mysql)
    │   │   ├── mysql.connection.ts           # class BunMySqlConnection extends AbstractSqlConnection (callRoutine: fn select / proc CALL+@var OUT)
    │   │   ├── mysql.driver.ts               # class BunMySqlDriver extends AbstractSqlDriver (RETURNING 없음 → batch insert PK back-fill: insertId + idx*auto_increment_increment)
    │   │   ├── mysql.error-normalizer.ts     # class BunMySqlErrorNormalizer (pass-through; Bun.SQL이 native errno 노출) [internal, mariadb와 공유]
    │   │   ├── mysql.kysely-parts.ts         # MYSQL_KYSELY_PARTS [internal, mariadb와 공유]
    │   │   └── index.ts                      # export { BunMySqlDriver }
    │   │
    │   ├── mariadb/                          # 신규. 공식과 동일하게 MariaDB = MySQL의 자식(공식 MariaDbPlatform extends MySqlPlatform, MariaDbDriver extends MySqlDriver)
    │   │   ├── mariadb.platform.ts           # class BunMariaDbPlatform = withBunMySqlFixes(MariaDbPlatform)  (@mikro-orm/mariadb; schemaHelper+JSON 특수화 보존)
    │   │   ├── mariadb.query-builder.ts      # class BunMariaDbQueryBuilder (공식 MariaDbQueryBuilder 기반; wrapPaginateSubQuery json_arrayagg/json_contains 우회 — MariaDB는 WHERE IN (서브쿼리)에 LIMIT 불가)
    │   │   ├── mariadb.connection.ts         # class BunMariaDbConnection extends BunMySqlConnection (kysely-parts·normalizer는 mysql 것 재사용)
    │   │   ├── mariadb.driver.ts             # class BunMariaDbDriver extends BunMySqlDriver — back-fill 유지(공식과 동일, RETURNING 안 씀). override만: createQueryBuilder(→BunMariaDbQueryBuilder), this.platform=new BunMariaDbPlatform(), getORMClass 등가
    │   │   └── index.ts                      # export { BunMariaDbDriver }
    │   │
    │   ├── sqlite/
    │   │   ├── sqlite.connection.ts          # class BunSqliteConnection extends AbstractSqlConnection (pooled:false 단일커넥션, reserve 없음)
    │   │   ├── sqlite.driver.ts              # class BunSqliteDriver extends AbstractSqlDriver (safeIntegers: BIGINT>2^53 무손실)
    │   │   ├── sqlite.error-normalizer.ts    # class BunSqliteErrorNormalizer (SQLITE_* 메시지 substring) [internal]
    │   │   ├── sqlite.kysely-parts.ts        # SQLITE_KYSELY_PARTS [internal]
    │   │   └── index.ts                      # export { BunSqliteDriver }
    │   │
    │   └── index.ts                          # 배럴: export { BunPostgreSqlDriver, BunMySqlDriver, BunMariaDbDriver, BunSqliteDriver } (서브배럴 경유)
    │
    ├── connection/   # ConnectionRegistry(static Map), ConnectionNotRegisteredError, ConnectionName, DEFAULT_CONNECTION
    ├── context/      # EntityManagerResolver(static), RequestContextRunner(static, ALS enterWith)
    ├── orm/          # MikroOrmService(abstract base: onInit/onDestroy/em/enter), ZipbulMikroOrmOptions
    └── repository/   # BaseRepository(abstract base: Proxy 위임)
```

## 4. 클래스 베이스 결정
- **static 메서드 클래스** (`ConnectionRegistry`/`EntityManagerResolver`/`RequestContextRunner`): zipbul DI가 BaseRepository 서브클래스에 ctor 주입을 안 하므로 주입 없이 도달 가능한 프로세스 전역이어야 함 → static.
- **추상 베이스** (`MikroOrmService`/`BaseRepository`): 사용자가 `extends` + abstract 멤버만 채움.
- **인터페이스 vs concrete** (`ErrorNormalizer`): 계약은 인터페이스(`bun-sql/interfaces.ts`), 구현은 per-DB concrete 클래스(`driver/<db>`). MariaDB는 MySQL normalizer를 재사용.

## 5. 사용자 코드 (이 구조가 노출하는 DX — 불변)
```ts
import { Entity, PrimaryKey, Property,
         MikroOrmService, BaseRepository, BunMariaDbDriver } from '@zipbul/mikro-orm';

@Entity() export class User { @PrimaryKey() id!: number; @Property() email!: string; }

@Injectable({ scope:'singleton', visibleTo:'all' })
export class Database extends MikroOrmService {
  protected readonly options = { driver: BunMariaDbDriver, clientUrl: env.DB_URL, entities:[User] };
}

@Injectable({ visibleTo:'all' })
export class UserRepository extends BaseRepository<User> { protected readonly entity = User; }
```

## 6. mixin 근거 (`withBunMySqlFixes`)
공식 계층은 `MariaDbPlatform extends MySqlPlatform`(자식). 그러나 우리 보정(`BunMySqlPlatform`)도 `MySqlPlatform`을 상속하므로, MariaDB를 `BunMySqlPlatform`의 자식으로 만들면 공식 MariaDB 고유 로직(SchemaHelper/QueryBuilder/JSON)을 잃는다. 따라서:
- `BunMySqlPlatform = withBunMySqlFixes(MySqlPlatform)`
- `BunMariaDbPlatform = withBunMySqlFixes(MariaDbPlatform)`
양쪽 다 공식 부모를 상속하되, Bun.SQL **공통 보정**은 **mixin 1곳**에서 공유 → 중복 0, 공식 동등성 유지. (클래스-베이스 원칙의 함수 예외로 명시.)

**보정의 실제 공유 범위(크로스리뷰 정정):** 진짜 공통은 **datetime→`BunUtcDateTimeType` 재매핑** 하나뿐. JSON auto-parse off 는 **MySQL 에만** 유효 — 공식 `MariaDbPlatform` 이 이미 `convertsJsonAutomatically()=false` 라 MariaDB 엔 no-op(버그 아님, 무해). 따라서 JSON-off 는 `BunMySqlPlatform` 에서만 적용하고 mixin 은 datetime 보정만 담당하는 편이 정확. → MariaDB JSON 은 "Bun 보정"이 아니라 **공식 동등** 으로 FEATURE-MATRIX 에 기록.

## 7. 공식 구조 실측 (이 설계의 근거)
```
AbstractSqlPlatform                       (@mikro-orm/sql)
  └─ BaseMySqlPlatform                     (@mikro-orm/sql/dialects/mysql; MySqlSchemaHelper+MySqlExceptionConverter 연결)
       └─ MySqlPlatform                    (@mikro-orm/mysql; escape()만 override)
            └─ MariaDbPlatform             (@mikro-orm/mariadb; schemaHelper + JSON(convertJsonToDatabaseValue/convertsJsonAutomatically) override. ExceptionConverter는 MySQL 재사용)

MySqlDriver                                (@mikro-orm/mysql; insertId+idx*auto_increment_increment back-fill, RETURNING 안 씀)
  └─ MariaDbDriver                         (@mikro-orm/mariadb; createQueryBuilder→MariaDbQueryBuilder + this.platform 재할당 + getORMClass. nativeInsertMany/Update는 override 안 함 = back-fill 그대로 상속)
```
→ MariaDB는 MySQL의 형제가 아니라 **자식**(Platform·Driver 둘 다). QueryBuilder 특수화는 **Platform 이 아니라 Driver**(createQueryBuilder)에 있음.
→ **RETURNING 발산 없음**: `Platform.usesReturningStatement()` 기본 false, pg/sqlite만 true override. MySQL·MariaDB 둘 다 false → 동일하게 insertId back-fill. (크로스리뷰 확정: 이전 "MariaDB RETURNING 지원" 전제는 오류였음.)
→ ExceptionConverter는 3819(MySQL)·4025(MariaDB) 둘 다 처리하므로 MariaDB 전용 normalizer 불필요.
→ 공식 Bun.SQL 드라이버·로드맵은 **없음**(공백을 우리가 메움). 정확성 레퍼런스 = 공식 pg/mysql/mariadb/sqlite 드라이버 동작.

## 8. 구현 계획 (TDD: RED → GREEN, 단계별 게이트)
| 단계 | 내용 | 게이트 |
|---|---|---|
| **0** | `@mikro-orm/mariadb`를 optional peer + dev dep 추가. **버전은 `@mikro-orm/mysql`와 동일 라인으로 핀**(mariadb가 mysql을 정확버전 하드핀 → 중복 인스턴스 시 `instanceof`/프로토타입 동일성 깨짐, §6 이중래퍼가 의존). peerDependenciesMeta optional 등록, mysql 단일 인스턴스로 dedupe. (네이티브 `mariadb`/`mysql2`는 트랜지티브로 설치되나 **런타임 import 안 함** — Bun.SQL이 대체) | 설치 OK, mysql 단일 인스턴스, `tsc` EXIT=0 |
| **1** | 순수 리팩터(행동 불변): `dialect/`→`bun-sql/` 개명, `driver/shared/` 신설 + `bun-utc-datetime` 이전 + `withBunMySqlFixes` 추출, 네이밍 전면 통일. **테스트 먼저 통과 확인 후 리네임, 매 커밋 GREEN 유지** | 기존 전체 테스트 0 fail |
| **1.5** | MariaDB 테스트 레인 하니스 선행: `helpers.ts`에 `MARIADB_URL=env.DB_URL_MARIADB` + `describeMariadb`(없으면 skip), `makeOrm` driver union에 `BunMariaDbDriver`(+`BunSqliteDriver`) 추가 | docker 없이 clean skip |
| **2** | MariaDB 발산 조사 → **RED 먼저**: 공식 mariadb vs mysql 라인별 diff, 각 차이를 Bun.SQL 하에서 검증할 실패 테스트 작성. 발산 = **JSON**(convertJsonToDatabaseValue/convertsJsonAutomatically) · **introspection**(MariaDbSchemaHelper) · **createQueryBuilder**(MariaDbQueryBuilder, 관계+페이지네이션 쿼리) · **errno**(4025 vs 3819, 공용 컨버터). **back-fill PK 복구(insertId+increment)도 MariaDB에서 RED로 고정** — RETURNING 아님. `describeMariadb` 레인 | RED 재현 |
| **3** | `driver/mariadb/` 구현(platform=mixin, driver=BunMySqlDriver 상속+createQueryBuilder/platform override, query-builder, connection) → barrel·root index 연결 → RED를 GREEN으로 | MariaDB lane GREEN |
| **4** | 문서/정의 정정: CLAUDE.md 4종, FEATURE-MATRIX·CONFORMANCE MariaDB 1급화(JSON은 공식 동등으로 기록), package.json keywords/description, `mysql.driver.ts` "zero mysql2" 주석을 "런타임 미import"로 정정 | — |
| **5** | 최종 게이트: `bun test`(pg+mysql+mariadb+sqlite) 0 fail, `tsc` EXIT=0, 커버리지 임계 | 통과 |

**§8-2 (크로스리뷰로 확정됨, 더 이상 미해결 아님):** `BunMariaDbDriver`는 **`BunMySqlDriver`를 상속하고 back-fill을 유지**한다. 근거(실측): `core Platform.usesReturningStatement()`=false, MySql/BaseMySql/MariaDbPlatform 모두 override 안 함 → MariaDB도 false. 공식 `MariaDbDriver extends MySqlDriver`이며 `nativeInsertMany/Update`를 override 안 함 = MySQL의 insertId+increment back-fill을 그대로 상속. `BunMariaDbDriver`가 override할 것은 **createQueryBuilder(→`BunMariaDbQueryBuilder`)·`this.platform`재할당·getORMClass 등가**뿐. "AbstractSqlDriver 직접 상속/back-fill 비활성" 안은 폐기(틀렸음). "RETURNING 행 이중처리" 우려는 무효(MikroORM은 MariaDB에 RETURNING을 발행하지 않음).
