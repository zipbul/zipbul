# `@zipbul/mikro-orm` — 아키텍처 / 디렉토리 구조 (확정)

위치: `packages/providers/mikro-orm` (그룹 `providers/` = DI로 주입되는 인프라 리소스 제공자: 향후 redis/bullmq/mailer/s3 형제).
근거: `../../../DESIGN-MIKRO-ORM.md`(검증된 설계) + 4-렌즈 적대적 구조 리뷰(SRP·버킷배치·의존성그래프·클래스베이스, 블로킹 4건 반영).

## 0. 설계 원칙 (불변 규칙)
- **SRP**: 한 파일 = 한 책임. 디렉토리 = 한 도메인(책임).
- **4-버킷 파일**(`interfaces.ts`/`types.ts`/`enums.ts`/`constants.ts`): 그 문법이 **실제로 존재하는 도메인 안에만** 둔다. 전역 버킷 디렉토리 금지. **내용 없으면 만들지 않는다**(빈 버킷 금지).
- **배럴 `index.ts` 도메인마다 필수**. 크로스 도메인 import는 **대상 도메인 배럴 경유**. 파일 직접 import 금지.
- **클래스 베이스**: 클래스 우선, 함수 최소화. 유일한 함수 예외 = `entity/`의 MikroORM 데코레이터 재export(데코레이터는 본질적으로 함수, 래핑 시 메타데이터 리플렉션 깨짐).
- **enums.ts 0개**(확정): DB는 드라이버 **클래스**로 구분(discriminant 값 없음). IsolationLevel/AccessMode는 `@mikro-orm/core`·Kysely `TransactionSettings`의 upstream 타입을 **소비**(로컬 재정의 금지). → 어떤 도메인에도 enums.ts 없음.

## 1. 도메인 목록 (7개)
| 도메인 | 책임 | 의존(배럴 경유) |
|---|---|---|
| `entity/` | 모던 ES 엔티티 데코레이터 단일 import 표면 | (leaf) |
| `dialect/` | Bun.SQL ↔ Kysely 글루 (DB 무관; per-DB parts·normalizer 주입) | (leaf, kysely) |
| `driver/<db>/` | MikroORM 드라이버 레이어 (DB별; 공식 Platform 재사용) | `dialect` |
| `connection/` | 커넥션 토폴로지/레지스트리 (어떤 ORM 인스턴스가 존재하는가) | (leaf, @mikro-orm/core) |
| `context/` | per-request EntityManager 접근 경계 (ALS) | `connection` |
| `orm/` | DI 브리지 — 사용자가 @Injectable 상속하는 베이스 | `connection`, `context` |
| `repository/` | Repository 베이스 — 사용자가 @Injectable 상속 | `context` |

## 2. 의존성 DAG (acyclic, 검증)
```
entity        (leaf)
dialect       (leaf; kysely)
driver/<db> ─▶ dialect
connection    (leaf; @mikro-orm/core)
context     ─▶ connection
orm         ─▶ connection, context
repository  ─▶ context
root index  ─▶ entity, dialect, driver, connection, context, orm, repository   (배럴만)
```
사이클 없음. 각 크로스 도메인 엣지는 대상 배럴 1개로만 연결.

## 3. 파일 트리 + 파일별 단일 책임
```
packages/providers/mikro-orm/
├── package.json / tsconfig.json / tsconfig.build.json
├── ARCHITECTURE.md                      # (이 문서)
├── index.ts                             # ROOT 배럴: export * from './src/<domain>' ×7 + ZIPBUL_PACKAGE. 파일 직접 재export 금지.
└── src/
    ├── entity/
    │   └── index.ts                     # export * from '@mikro-orm/decorators/es'  (유일한 함수 예외; 큐레이션 안 함)
    │
    ├── dialect/
    │   ├── bun-sql-connection.ts        # class BunSqlConnection implements kysely DatabaseConnection
    │   │                                #   - executeQuery: sql.unsafe → {rows, numAffectedRows, insertId(lastInsertRowid)}; catch→ErrorNormalizer.normalize→rethrow
    │   │                                #   - streamQuery: 필수 멤버(kysely non-optional) → StreamingUnsupportedError throw (실제 메서드, 함수 추출 금지)
    │   │                                #   - release(); ctor에 ErrorNormalizer 주입(composition)
    │   ├── bun-sql-transaction.ts       # class BunSqlTransactionController
    │   │                                #   - begin(conn, settings): isolationLevel/accessMode SQL 매핑(private 메서드) + 'begin'
    │   │                                #   - commit/rollback/savepoint/rollbackToSavepoint/releaseSavepoint(conn, name)
    │   ├── bun-sql-kysely-driver.ts     # class BunSqlKyselyDriver implements kysely Driver
    │   │                                #   - init/acquireConnection(sql.reserve)/releaseConnection/destroy  ← 커넥션 수명만
    │   │                                #   - beginTransaction/commit/rollback/savepoint... → BunSqlTransactionController에 위임
    │   ├── bun-sql-dialect.ts           # class BunSqlDialect implements kysely Dialect
    │   │                                #   - createDriver/createQueryCompiler/createAdapter/createIntrospector ← 주입된 KyselyDialectParts로
    │   ├── interfaces.ts                # KyselyDialectParts(adapter/compiler/introspector 팩토리), BunSqlDialectOptions, ErrorNormalizer(계약: normalize(e):e)
    │   ├── types.ts                     # BunSqlClient, ReservedConnection (Bun.SQL 위 별칭)
    │   ├── constants.ts                 # DEFAULT_POOL_MAX (BunSqlDialectOptions 기본값으로만 참조)
    │   ├── errors.ts                    # StreamingUnsupportedError
    │   └── index.ts                     # 배럴(크로스도메인 전체 표면):
    │                                    #   export { BunSqlDialect, BunSqlConnection, BunSqlKyselyDriver, BunSqlTransactionController }
    │                                    #   export type { KyselyDialectParts, BunSqlDialectOptions, ErrorNormalizer, BunSqlClient, ReservedConnection }
    │                                    #   export { StreamingUnsupportedError }
    │                                    #   (DEFAULT_POOL_MAX는 internal — 배럴 미노출)
    │
    ├── driver/
    │   ├── postgres/
    │   │   ├── postgres.connection.ts       # class PostgresConnection extends AbstractSqlConnection
    │   │   │                                #   createKyselyDialect() → new BunSqlDialect(POSTGRES_KYSELY_PARTS, new PostgresErrorNormalizer(), opts)
    │   │   ├── postgres.driver.ts           # class BunPostgreSqlDriver extends AbstractSqlDriver (super: new PostgreSqlPlatform(), PostgresConnection, ['kysely'])
    │   │   ├── postgres.error-normalizer.ts # class PostgresErrorNormalizer implements ErrorNormalizer (errno→code SQLSTATE; detail/constraint/table 보존)  [internal]
    │   │   ├── kysely-parts.ts              # const POSTGRES_KYSELY_PARTS: KyselyDialectParts = { Adapter:PostgresAdapter, ... }  [internal]
    │   │   └── index.ts                     # export { BunPostgreSqlDriver }  (normalizer/parts는 internal, 미노출)
    │   ├── mysql/                           # 동형: mysql.connection/mysql.driver/mysql.error-normalizer(errno 1062 등)/kysely-parts/index
    │   ├── sqlite/                          # 동형; bun:sqlite 동기 브리지(reserve 없음), SQLITE_* 코드 normalizer
    │   └── index.ts                         # 배럴: export { BunPostgreSqlDriver } from './postgres'; ...mysql; ...sqlite (서브배럴만 경유)
    │
    ├── connection/
    │   ├── connection-registry.ts       # class ConnectionRegistry { static set/get/has/delete(name, orm) }  ← 프로세스 전역 static Map
    │   ├── errors.ts                     # ConnectionNotRegisteredError
    │   ├── types.ts                      # ConnectionName (= string)
    │   ├── constants.ts                  # DEFAULT_CONNECTION = 'default'
    │   └── index.ts                      # export { ConnectionRegistry, ConnectionNotRegisteredError, DEFAULT_CONNECTION }; export type { ConnectionName }
    │
    ├── context/
    │   ├── entity-manager-resolver.ts    # class EntityManagerResolver { static resolve(name): EntityManager }
    │   │                                 #   = MikroRequestContext.getEntityManager(name) ?? ConnectionRegistry.get(name).em
    │   ├── request-context-runner.ts     # class RequestContextRunner { static enter(name): void } = MikroRequestContext.enter(ConnectionRegistry.get(name).em)
    │   └── index.ts                      # export { EntityManagerResolver, RequestContextRunner }
    │                                     #   (interfaces/types/constants 없음 — 실내용 없어 빈 버킷 금지 규칙 적용)
    │
    ├── orm/
    │   ├── mikro-orm.service.ts          # abstract class MikroOrmService
    │   │                                 #   protected abstract readonly options: ZipbulMikroOrmOptions
    │   │                                 #   orm!: MikroORM
    │   │                                 #   onInit(): MikroORM.init(options) ONLY(비파괴) + ConnectionRegistry.set(conn, orm)
    │   │                                 #   onDestroy(): ConnectionRegistry.delete(conn) + orm.close()
    │   │                                 #   get em(): EntityManagerResolver.resolve(conn)
    │   │                                 #   enter(): RequestContextRunner.enter(conn)
    │   ├── interfaces.ts                 # ZipbulMikroOrmOptions extends @mikro-orm Options + connection?: ConnectionName
    │   └── index.ts                      # export { MikroOrmService }; export type { ZipbulMikroOrmOptions }
    │
    └── repository/
        ├── base-repository.ts           # abstract class BaseRepository<T extends object>
        │                                #   protected abstract readonly entity: EntityName<T>
        │                                #   protected abstract readonly connection?: ConnectionName  (기본 'default')
        │                                #   constructor → Proxy: 사용자 정의 메서드 우선, 없으면 EntityManagerResolver.resolve(conn).getRepository(entity)로 위임
        └── index.ts                     # export { BaseRepository }  (interfaces.ts 없음 — 빈 버킷 금지)
```

## 4. 클래스 베이스 결정 (리뷰 반영)
- **static 메서드 클래스** (`ConnectionRegistry`/`EntityManagerResolver`/`RequestContextRunner`): zipbul DI는 `BaseRepository` 서브클래스에 ctor 주입을 안 하므로(사용자 repo는 인자 없는 클래스), 리졸버/레지스트리는 **주입 없이 도달 가능한 프로세스 전역**이어야 함 → static 메서드(클래스 유지, 모듈 레벨 함수 아님, 클래스로 목 가능).
- **추상 베이스** (`MikroOrmService`/`BaseRepository`): 사용자가 `extends` + abstract 멤버만 채움(이전 팩토리-함수 방식 폐기). 라이프사이클/위임 로직은 베이스 메서드.
- **인터페이스 vs 추상클래스** (`ErrorNormalizer`): 계약은 **인터페이스**(dialect/interfaces.ts), 구현은 per-DB **concrete 클래스**(driver/<db>). 크로스 도메인 추상클래스 상속 회피 + DB별 완전 소유 + 구현은 클래스.
- **함수 예외 1개**: `entity/index.ts`의 `export * from '@mikro-orm/decorators/es'`. 래핑 금지(메타데이터 리플렉션·제네릭 추론 보존).

## 5. 사용자 코드 (이 구조가 노출하는 DX — 불변)
```ts
import { Entity, PrimaryKey, Property,
         MikroOrmService, BaseRepository, BunPostgreSqlDriver } from '@zipbul/mikro-orm';

// entity
@Entity() export class User { @PrimaryKey(...) id!: number; @Property(...) email!: string; }

// database — 유일한 셋업 글루 (추상 클래스 상속, abstract options 채움)
@Injectable({ scope:'singleton', visibleTo:'all' })
export class Database extends MikroOrmService {
  protected readonly options = { driver: BunPostgreSqlDriver, clientUrl: env.DB_URL, entities:[User] };
}
export const dbContext = defineMiddleware([HttpAdapter], () => { const db = inject(Database); return () => db.enter(); });

// repository — 엔티티당 한 줄 (추상 클래스 상속, abstract entity 채움)
@Injectable({ visibleTo:'all' })
export class UserRepository extends BaseRepository<User> { protected readonly entity = User; }

// service — inject 하나
@Injectable()
export class UsersService {
  private readonly users = inject(UserRepository);   // NestJS @InjectRepository 동급
  list() { return this.users.findAll(); }
}
```

## 6. 미해결/구현 시 검증할 것
- per-request 격리: `inject(UserRepository)`가 동시요청에서 distinct EM fork인지 재실증(스캐폴딩 후 구현 단계).
- `@mikro-orm/decorators/es` 서브패스 실제 resolve 확인(설치 후).
- 에러 정규화 라운드트립(UniqueConstraint 등)이 공식 ExceptionConverter로 잡히는지(errno→code) 테스트.
- BLOCKING/SHOULD-FIX 상세는 `../../../DESIGN-MIKRO-ORM.md` §2(B1-a/b/c, B3) 및 본 리뷰 반영분.
