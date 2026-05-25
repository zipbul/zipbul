# Spike: gildash 0.28→0.30 + MikroORM/Bun.SQL 가능성

브랜치: `chore/gildash-mikroorm-spike` (base: `chore/monorepo-consolidation`)
작성: 2026-05-25. 이 문서는 두 조사의 사실관계와 근거를 산문으로 남긴다. 코드 변경은 아직 하지 않았다(조사/PoC 단계).

---

## Task 1 — gildash 버전 차이와 "최적 사용" 변경 지점

### 1.1 버전 델타 (검증됨, 순수 추가 / 파괴적 변경 없음)

현재 catalog 고정 = **0.28.0**, 최신 publish = **0.30.0**. 두 tarball의 `dist/**/*.d.ts`를 전수 diff한 결과, 의존성·exports·기존 시그니처는 동일하고 **semantic 레이어에만 기능이 추가**됐다. 0.29.0이 중간 버전으로 존재하나 표면 변화는 0.30.0 기준으로 누적 확인했다.

추가된 공개 API:
- `getEnrichedReferences(symbolName, filePath, project?)` / `getEnrichedReferencesAtPosition(filePath, position)` → `EnrichedReference[]`
- `getFileBindings(filePath)` → `FileBinding[]`
- `SemanticLayerLike`에 `findEnrichedReferences`, `getFileBindings` 메서드 추가
- 새 모듈 `semantic/reference-classifier`: `isAmbientDeclaration(decl)`, `getEnclosingScope(node)`, `classifyWriteKind(identifier)`
- 새 타입: `WriteKind`('declaration'|'assignment'|'compound-assignment'|'logical-assignment'|'update'), `ScopeKind`('function'|'module'|'block'), `EnclosingScope`
- `EnrichedReference extends SemanticReference`에 `writeKind?`, `isAmbient`, `enclosingScope` 추가
- `FileBinding` = `{ declaration: {filePath, position, name, isAmbient}, references: EnrichedReference[] }`

요약: 0.30.0은 tsc `findReferences`가 못 주는 정보 — **읽기/쓰기 종류, ambient(.d.ts/declare) 여부, 참조의 둘러싼 스코프(모듈/함수/블록)** — 를 enriched reference + file-binding으로 노출한다. 모두 **semantic 모드**가 켜져야 동작한다.

### 1.2 현재 gildash 사용 현황 (검증됨)

- 진입: `packages/framework/cli/src/common/gildash-open.ts` — `semantic:true`로 열고 실패 시 `GildashError{type:'semantic'}`에서만 `semantic:false`로 폴백, 그 외 에러는 재던짐. 호출부는 `semanticAvailable` 플래그로 분기(예: `build-artifact-writer.ts`가 `getSemanticModuleInterface` vs `getModuleInterface` 선택).
- semantic API 실사용: `module-validation-engine.ts`(`searchSymbols`/`getFullSymbol`/`getImplementations`/`isTypeAssignableTo`/`getHeritageChain`), `provider-resolver.ts`·`token-resolver.ts`(`resolveSymbol`).
- 나머지 대부분은 **syntactic**(parseSource/extractSymbols/walk/is) — 0.30 추가분과 무관.
- `getEnrichedReferences`/`getFileBindings`/`findEnrichedReferences` 사용처 = **0건** (현재 소비자 없음).

### 1.3 "최적 사용" 변경 지점 — 등급별 (근거와 함께)

**[A] 강한 후보 (검증된 실제 중복 구현)**
`packages/framework/cli/src/compiler/define-call-shape.ts`는 `defineMiddleware/defineGuard/defineExceptionFilter/defineAdapter/defineModule` 호출이 **top-level exported const 초기화 슬롯**에 있는지를 **수작업 AST 분석**으로 판정한다(`DefineCallShapeReason = 'not-top-level' | 'not-exported' | 'not-const'`, line 56·64·125, "nested inside another expression / function / class"). 이 "둘러싼 스코프가 모듈 top-level인가" 판정은 0.30의 `getEnclosingScope(node)`(`ScopeKind: module|function|block`)가 네이티브로 제공한다.
- 트레이드오프: 현재 define-call-shape는 **syntactic**으로만 동작(semantic 불필요). `getEnclosingScope`는 semantic 모드 의존. 폴백 환경에선 못 쓰므로 syntactic 경로를 유지하거나 이중화 필요. 즉 "교체"보다 "semantic 가용 시 교차검증" 수준이 안전.

**[B] 약한 후보 (당장 소비자 없음 — 필요 생기면)**
- `getEnrichedReferences`의 read/write 구분(`writeKind`): 증분 리빌드 정밀화(dev) 등에 쓸 수 있으나, 현재 컴파일러에 read-vs-write를 필요로 하는 로직이 없다. 근거 없는 선도입은 피한다.
- `getFileBindings`: export/재export 집계용이나 이미 `getModuleInterface`가 있어 효용이 겹친다.

**[C] 서브에이전트 제안 중 기각**
- "`getImplementations` → `getEnrichedReferences(writeKind:'declaration')` 치환"은 목적이 다르다(인터페이스 구현 클래스 집합 ≠ 심볼 참조 위치 분류). 치환 부적절.
- ambient 검사 "부재"는 과장. `source-tree.ts:71`이 이미 `.d.ts`를 건너뛰고, 어댑터 빌드가 `declare module`을 다룬다. provider-level ambient 거부가 실제 요구로 확인되기 전엔 도입 근거 없음.

**결론(Task 1):** 버전 차이는 "semantic 강화(enriched refs / file bindings / write-kind / ambient / scope)"로 명확. **즉시 가치 있는 단일 지점은 define-call-shape의 스코프 판정([A])뿐이며, 그조차 semantic 의존이 생기는 트레이드오프가 있다.** 나머지는 소비자가 없어 선도입 비권장. gildash를 0.30으로 올리는 것 자체는 무해(추가-only)하므로 catalog bump는 안전하지만, 코드 변경은 [A]에 한해 검토.

---

## Task 2 — MikroORM + Bun.SQL 가능? → **가능. 엔드투엔드 실증 완료.**

### 2.1 결정적 계약 (검증됨)
- `@mikro-orm/sql` 7.1.1의 `AbstractSqlConnection`은 `abstract createKyselyDialect(overrides): MaybePromise<Dialect>` 하나만 요구. v7 SQL 레이어 전체가 **Kysely 위에 구현**됨(`@mikro-orm/sql`이 `kysely`를 직접 의존·re-export).
- 더 결정적으로, v7의 `SqliteDriver`는 **dialect-agnostic**이다. 기본 `BaseSqliteConnection.createKyselyDialect`가 *"Pass a Kysely dialect via the `driverOptions` config option ... or a custom dialect for other libraries"*라고 throw. 즉 **풀 커스텀 Driver/Connection/Platform 없이**, 설정에 `{ driver: SqliteDriver, driverOptions: <KyselyDialect> }` 만 주면 된다.

### 2.2 실증한 두 경로 (둘 다 모던 stage-3 ES 데코레이터, `experimentalDecorators:false`)

PoC 위치: `poc/mikro-bunsql/`. 환경: Bun 1.3.13, MikroORM 7.1.1, kysely 0.29.2.

**경로 1 — `bun:sqlite`(동기, better-sqlite3 호환)** : `bun-sqlite-dialect.ts`
공식 `NodeSqliteDialect`(node:sqlite 브리지)를 그대로 미러링. Kysely `SqliteDialect`의 동기 `prepare→{all,run,get}` 인터페이스에 `bun:sqlite`의 `Database.query()`를 연결. `poc.ts` 실행 결과:
```
ORM init OK. driver = SqliteDriver
schema created
inserted id = 1
queried back = { id: 1, name: "alice", email: "a@x.io" }
PoC SUCCESS
```

**경로 2 — `Bun.SQL`(문자 그대로의 비동기 통합 드라이버)** : `bun-sql-dialect.ts`
Kysely의 sqlite dialect는 동기라 Bun.SQL(async)엔 안 맞음 → **약 50줄짜리 비동기 커스텀 Kysely Dialect**(Driver+DatabaseConnection) 작성. `executeQuery`는 `await sql.unsafe(cq.sql, [...cq.parameters])`, 트랜잭션은 raw `begin/commit/rollback`. Adapter/Compiler/Introspector는 Kysely의 Sqlite용 재사용. `poc-bunsql.ts` 실행 결과:
```
[Bun.SQL] ORM init OK
[Bun.SQL] schema created
[Bun.SQL] inserted id = 1
[Bun.SQL] queried back = { id: 1, name: "dave", email: "d@x.io" }
[Bun.SQL] PoC SUCCESS
```
Bun.SQL은 `sql.unsafe(sql, params)`(`?` 플레이스홀더), `RETURNING`, `lastInsertRowid`/`affectedRows`를 제공 → Kysely `QueryResult`(rows/insertId/numAffectedRows) 매핑 가능함을 직접 확인.

### 2.3 모던 데코레이터 검증
엔티티(`entity.ts`)는 `@mikro-orm/decorators/es`의 `@Entity/@PrimaryKey/@Property` 사용, `tsconfig`는 `experimentalDecorators:false`+`emitDecoratorMetadata:false`. stage-3 사양상 메타데이터 리플렉션이 없어 **스칼라 타입을 `@Property({ type: 'string' })`처럼 명시**해야 함(코드에 반영됨). MikroORM init이 메타데이터를 정상 해석하고 ORM 라운드트립(insert→autoincrement id→findOneOrFail)이 양 경로 모두 성공.

### 2.4 Bun.SQL 지원 DB (검증됨)
Bun 1.3.13에서 직접 확인. 미지원 프로토콜 입력 시 Bun이 출력한 목록: **`postgres`, `sqlite`, `mysql`, `mariadb`**. sqlite는 쿼리 실행까지, postgres/mysql은 어댑터 인식+연결 시도 확인(가짜 프로토콜만 "Unsupported protocol"로 거부). 즉 단일 통합 API로 4종 지원.

### 2.5 경로 3 — Bun.SQL + 실제 PostgreSQL (실증 완료)
PoC: `bun-sql-pg-dialect.ts`(Postgres Kysely Adapter/Compiler/Introspector + 비동기 Bun.SQL 커넥션), `bun-pg-mikro-driver.ts`(얇은 MikroORM 드라이버: `AbstractSqlDriver` + `BasePostgreSqlPlatform`(구체 클래스, 인스턴스화 가능) + 커스텀 `AbstractSqlConnection.createKyselyDialect`가 Bun.SQL Postgres dialect 반환), `poc-pg.ts`. 대상: Docker `postgres:16-alpine` (port 55432). 결과:
```
[PG] ORM init OK, platform = BasePostgreSqlPlatform
[PG] schema created
[PG] inserted id = 1
[PG] queried back = { id: 1, name: "erin", email: "e@pg.io" }
[PG] server = PostgreSQL 16.14 on x86_64-pc-linux-musl
[PG] PoC SUCCESS
```
검증 사실:
- sqlite와 달리 `@mikro-orm/sql`엔 제너릭 PostgreSqlDriver가 없다(실 pg 드라이버는 별도 `@mikro-orm/postgresql`이 `pg` 사용). 그래도 `AbstractSqlDriver`(`super(config, new BasePostgreSqlPlatform(), Connection, ['kysely'])`) + createKyselyDialect만으로 **약 40줄 + 25줄**짜리 커스텀 Postgres 드라이버를 Bun.SQL 위에 세울 수 있었다.
- kysely 루트에서 `PostgresAdapter`/`PostgresQueryCompiler`/`PostgresIntrospector` import 가능($1 플레이스홀더 = Bun.SQL `sql.unsafe(sql, params)`와 호환).
- **중요 제약(검증됨)**: Bun.SQL Postgres는 풀 연결에서 raw `begin/commit/rollback`을 금지(`ERR_POSTGRES_UNSAFE_TRANSACTION`, "Only use sql.begin, sql.reserved or max: 1"). PoC는 `new Bun.SQL(url, { max: 1 })`로 단일 연결 고정해 통과. **프로덕션 dialect는 트랜잭션마다 `sql.reserve()`로 연결을 핀하거나 `sql.begin()` 콜백을 써야 함**(sqlite엔 없던 제약).

### 2.6 경로 4 — reserve() 기반 풀링 + 동시 트랜잭션 (실증 완료)
`bun-sql-pg-dialect.ts`를 **reserve 기반**으로 재작성: Kysely `acquireConnection` → `await sql.reserve()`(전용 예약 연결), `releaseConnection` → `reserved.release()`, begin/commit/rollback은 예약 연결에서 실행. 풀 `max:10`. `poc-pg-concurrent.ts` 결과:
```
[PG-CONC] schema ready, pool max=10
[PG-CONC] 20/20 transactions committed
[PG-CONC] rows in db = 20
[PG-CONC] ghost rows after rollback = 0 (expect 0)
[PG-CONC] DONE
```
- `em.transactional()` 20개를 `Promise.allSettled`로 동시 실행 → 20/20 커밋, 20행 적재(각 트랜잭션이 풀에서 독립 예약 연결 확보).
- 실패 트랜잭션은 ghost 0행 → 롤백/격리 정상.
- 사전 확인: sqlite는 `reserve` 미지원("This adapter doesn't support connection reservation"), postgres/mysql만 지원. 즉 **프로덕션 Bun.SQL dialect는 DB별로 트랜잭션 전략이 다름** — sqlite는 단일연결/raw begin 가능, postgres/mysql은 reserve() 필수.

### 2.7 zipbul AOT × MikroORM @Entity 간섭 (실증 완료)
메인 repo `examples/`에 MikroORM 모던(ES) 데코레이터 엔티티(`@Entity/@PrimaryKey/@Property/@ManyToOne`) 파일을 추가하고 `zb build` 실행, 베이스라인과 비교(테스트 후 git restore로 복원):
- 베이스라인: `scanned 186 files, 52 classes / 6 modules, 10 providers`
- 엔티티 추가 후: `scanned 187 files, 53 classes / 6 modules, 10 providers`
- 결론: **AOT 스캔은 @Entity 클래스를 "클래스"로 세지만(53), 프로바이더/컨트롤러/모듈로는 등록하지 않음(10/6 불변).** 엔티티 관련 경고·에러 0건. 빌드 성공(exit 0).
- 단서: 처음 "Bundle failed"는 `@mikro-orm/decorators/es` 미설치로 번들러가 import를 못 푼 것 → 의존성 설치 후 그린.
- **유의**: examples tsconfig는 `experimentalDecorators:true`(레거시)인데도 빌드가 통과했다. 이유는 AOT 스캔이 **syntactic**(gildash/oxc가 데코레이터 모드 무관하게 파싱)이고 번들러도 구문상 통과시키기 때문. **빌드 통과 ≠ 런타임 정상.** 모던 데코레이터 엔티티가 런타임에 올바로 동작하려면 §1.4의 `experimentalDecorators:false` 전환이 여전히 전제다. 이 테스트가 증명한 것은 "AOT가 엔티티를 오등록/충돌시키지 않는다"는 것뿐.

### 2.8 AOT는 entity를 읽을 필요가 없다 (개념 확정)
NestJS/TypeORM와 동일하게 엔티티는 DI 컨테이너 구성원이 아니다. 런타임에 `MikroORM.init({ entities: [...] })`로 ORM에 넘기는 순수 런타임 아티팩트이고, zipbul AOT가 만드는 건 DI 그래프 + 컨트롤러 라우팅뿐 — 직교한다. (b)의 결과(엔티티가 클래스 수엔 잡히나 프로바이더/모듈로 등록 안 됨)는 "AOT가 엔티티를 안 건드린다"는 정상 동작의 증거. 따라서 검증 대상은 "AOT가 엔티티를 오등록/충돌시키지 않는가"였고, 그건 §2.7에서 확인됨.

### 2.9 모던 데코레이터 zipbul 앱 — 빌드 + 런타임 엔드투엔드 (실증 완료, 핵심 게이트)
"모던 데코레이터 노선"의 진짜 게이트 = **experimentalDecorators:false에서 실제 zipbul 앱이 빌드되고 부팅돼 요청에 응답하는가.** 메인 repo `examples/`(컨트롤러 /users·/posts·/billing 등 15 라우트)의 tsconfig를 `experimentalDecorators:false`로 뒤집고 검증(후 복원):
- 빌드: 성공(exit 0), `52 classes / 6 modules / 10 providers` — 레거시와 동일.
- 런타임: `bun dist/entry.js` 부팅 OK("15 routes registered (AOT)", "Listening on :5000"), DI(UsersService 16 users)·가드·tick 미들웨어 동작, **로그 에러 0**.
- 응답: `GET /users`·`/posts`·`/billing/history` 모두 **HTTP 200 + 정상 JSON**.
- **프레임워크 데코레이터를 재선언하지 않았는데도** 빌드·런타임 모두 정상. 이유: AOT 스캔은 syntactic(모드 무관), 번들러는 no-op 데코레이터를 모던 의미로 무해하게 트랜스파일, 런타임은 생성된 runtime.js(데코레이터는 no-op).

그렇다면 데코레이터 재선언이 실제로 필요한 범위는? → **오직 `tsc --noEmit` 타입체크 전용.** examples src를 experimentalDecorators:false로 tsc 돌린 결과 **정확히 50개 에러, 전부 데코레이터-시그니처 코드**(TS1240 property 18 / TS1270 method-return 16 / TS1241 method-arg 16), **비-데코레이터(로직) 에러 0**. 대상에는 HTTP 데코레이터(@Get/@Post/@RestController), common(@UseGuards 등) 외에 **DTO의 검증용 property 데코레이터**(charge.dto.ts, id-route-params.dto.ts 등)도 포함됨.

**결론(2.9):** 모던 데코레이터 전환의 빌드·런타임 리스크는 **없다(실증)**. 남는 작업은 **no-op 데코레이터들을 모던 시그니처로 재선언**(HTTP+common+DTO 검증 데코레이터)해 tsc를 그린으로 유지하는 것뿐 — 동작 변화 없는 기계적 타입 작업. 모던 시그니처가 tsc 통과함은 §1.4에서 확인됨.

### 2.10 "완벽" 게이트 — 스키마 생성 + 타입 변환 (실증 완료)
"DX 그대로 + driver만 완벽"을 가르는 두 DX-핵심 표면을 실제 PostgreSQL 16으로 검증. PoC: `entity-types.ts`(Date/json/bigint/boolean/decimal), `poc-pg-types.ts`.

**게이트 1 — SchemaGenerator(스키마 생성/마이그레이션):** 통과.
- 앞서 `orm.schema.createSchema()` 미동작의 원인 두 가지를 규명: (1) extension 미등록 → `extensions: [SqlSchemaGenerator]` 필요, (2) 메서드명 오류 → 실제 API는 `create()`/`drop()`/`update()`/`getCreateSchemaSQL()`(`createSchema`/`refreshDatabase` 아님).
- `orm.schema.drop()` + `orm.schema.create()`가 Bun.SQL dialect 위에서 정상 동작, 엔티티 메타데이터로부터 DDL 생성·실행. 생성 결과(information_schema 확인): `serial / varchar(255) / timestamptz / jsonb / bigint / boolean / numeric` — 표준 pg 타입.

**게이트 2 — 타입 변환(coercion) 왕복:** 전부 통과.
- Date(timestamptz): `instanceof Date` + 값 동일 ✓
- JSON(jsonb): 객체/배열 복원 + deep-equal ✓
- bigint: `'9007199254740993'`(MAX_SAFE_INTEGER 초과) 문자열 무손실 보존 ✓
- boolean: `true` ✓
- decimal: `'123.45'` 정확 ✓ — 단 `@Property({ type:'decimal', precision:10, scale:2 })`로 scale 명시해야 함. scale 미지정 시 MikroORM 기본 `numeric(10,0)`라 `123.45→123`이 되는데, 이는 **공식 드라이버와 동일한 MikroORM 기본 동작**이지 Bun.SQL 드라이버 문제가 아님(검증함).

**결론(2.10):** MikroORM의 SchemaGenerator·타입 시스템이 Bun.SQL 커스텀 dialect 위에서 **표준대로 동작** — DX 손실 없음. decimal scale 등은 평소 MikroORM에서 하던 것과 똑같이 명시하면 됨.

### 2.11 잔여 미검증 전수 확인 (실 PG16 + MySQL 8.4)
- **introspection 기반 schema diff + `update()`** → 통과. v1 스키마 생성 후 v2(컬럼 추가) 엔티티로 `getUpdateSchemaSQL()`이 기존 DB를 introspect→diff(`alter table "widget" add "price" int null`) 생성, `update()`가 적용. (`poc-pg-update.ts`)
- **Migrator(파일 기반 마이그레이션 `@mikro-orm/migrations`)** → 통과. `create()`(파일 생성)→`getPending()`→`up()`(적용)→`mikro_orm_migrations` 부킹 테이블 + executed 1건. (`poc-pg-migrator.ts`) **단 두 전제 발견**: (1) Bun의 `fs.glob`가 `options.withFileTypes` 미지원 → MikroORM 마이그레이션 discover가 깨짐 → **`tinyglobby` 설치 필요**(MikroORM이 자동 감지, 문서화된 해법). (2) 마이그레이션은 savepoint를 쓰므로 **드라이버가 `savepoint`/`rollbackToSavepoint`/`releaseSavepoint` 구현 필수**(Kysely Driver 선택 메서드, raw `savepoint`/`release`/`rollback to` SQL로 구현).
- **MySQL/MariaDB 런타임** → 통과. MySqlPlatform + Mysql Kysely(Adapter/Compiler/Introspector) + Bun.SQL mysql 연결로 실 MySQL 8.4.9에 init·스키마생성·insert·트랜잭션·findAll 라운드트립. (`bun-sql-mysql-dialect.ts`, `bun-mysql-mikro-driver.ts`, `poc-mysql.ts`)
- **스트리밍** → **불가(한계).** Bun.SQL 1.3.13의 쿼리 객체엔 async-iterator/`.cursor`/`.stream`이 없음(`.values()`/`.raw()`/`.simple()`만). 따라서 Kysely `streamQuery`/MikroORM `qb.stream()`을 Bun.SQL로 네이티브 구현 불가 — 버퍼링 fallback이거나 미지원으로 둬야 함. 공식 pg 드라이버는 `pg-cursor`로 스트리밍하나 Bun.SQL엔 대응물 없음.

### 2.12 "정공법" 드라이버/패키지 설계 (공식 @mikro-orm/postgresql 템플릿 기준)
공식 드라이버 패키지(`@mikro-orm/postgresql`) 해부 결과 — 정확한 구조:
- `XConnection extends AbstractSqlConnection` → `createKyselyDialect(overrides): Dialect` 구현. (공식은 kysely 내장 `PostgresDialect`에 `new pg.Pool(...)`을 넘김. 우리는 Bun.SQL 백엔드 커스텀 Kysely Dialect를 반환.)
- `XDriver extends AbstractSqlDriver` → `super(config, new XPlatform(), XConnection, ['kysely', <native>])` + `createEntityManager()` + `getORMClass()`.
- `XPlatform` → **재사용**: `BasePostgreSqlPlatform`(pg) / `MySqlPlatform`(mysql) / `SqlitePlatform`(sqlite) 그대로 상속. 새로 만들 필요 거의 없음.
- `XMikroORM extends SqlMikroORM` + `defineXConfig = defineConfig({ driver: XDriver, ... })` + `index.ts`가 `@mikro-orm/sql` 재export.

**만들 드라이버**: DB 패밀리별 3종 — `BunPostgreSqlDriver`, `BunMySqlDriver`, `BunSqliteDriver`. 공통 자산은 "Bun.SQL 백엔드 Kysely Dialect" 하나(executeQuery=`sql.unsafe`, 트랜잭션 begin/commit/rollback + savepoint 3종, pg/mysql은 `sql.reserve()`로 연결 핀, sqlite는 동기 better-sqlite3 브리지). Dialect의 Adapter/Compiler/Introspector만 DB별로 kysely 것 교체.

**패키지**: 단일 패키지(가칭 `@zipbul/mikro-orm-bun`). exports = 3 드라이버 + defineConfig 3종. peerDeps = `@mikro-orm/core`·`@mikro-orm/sql`·해당 platform 패키지(`@mikro-orm/postgresql`/`mysql`)·`kysely`. deps = `tinyglobby`(마이그레이션 Bun glob 회피). 엔티티는 모던 ES 데코레이터(`@mikro-orm/decorators/es`) 사용 — 앱은 `experimentalDecorators:false`.

### 2.13 최종 미검증 (정확히 남은 것)
- **스트리밍**: Bun.SQL 커서 부재로 미지원 (위 2.11).
- MariaDB 별도 미테스트(MySQL과 동일 어댑터라 동작 추정이나 미실증).
- pg `pg-cursor` 의존 기능(refcursor 라우틴 등 공식 Connection의 callRoutine 경로) 미구현/미검증.
- 실제 `@zipbul` DB 프로바이더 패키지로의 통합(EntityManager/Repository inject)은 미조립 — 구성요소는 전부 실증됨.
- 실 MikroORM 엔티티를 **DI로 쓰는 서비스가 EntityManager/Repository를 inject**하는 풀 통합(DB 프로바이더 패키지)을 zipbul 런타임에서 엔드투엔드로는 미조립 — 단 구성요소(모던 데코레이터 zipbul 런타임 §2.9 + MikroORM/Bun.SQL 라운드트립 §2.2·2.5·2.6)는 각각 실증됨.
- (참고) 워크트리 루트 `bun install`이 로컬 @zipbul 워크스페이스 링크 실패 → 빌드/런타임 검증은 메인 repo에서 수행. 워크트리 링크 이슈는 별도 원인 규명 필요.

---

## 3. 추가 정밀조사 (DB버전·DI통합·패키징·DX·기능)

### 3.1 DB 버전 — 최신으로 재검증
구버전(pg16/mysql8)을 쓴 건 기본 태그 습관일 뿐 이유 없음. **최신 재검증**: PostgreSQL **18.4** (타입변환 + Migrator 통과), MySQL **9.7.0** (라운드트립 + 트랜잭션 통과). 결과 동일.

### 3.2 DI 통합 — "프로바이더만"으론 부족, 특정 메커니즘 필요 (컴파일러 전수조사)
zipbul 컴파일러를 전수조사한 결과(file:line 근거 확보):
- **외부 npm 패키지는 자동 결선 불가.** 컴파일러는 사용자 `sourceDir`만 스캔(`module-graph.ts:70-72`). 즉 `@mikro-orm` 드라이버 패키지가 forRoot를 export해도 컴파일러가 자동 인식 못 함 → **사용자가 자기 src에 모듈/프로바이더 글루를 직접 작성해야 함.** (NestJS가 `imports:[MikroOrmModule.forRoot()]`만으로 되는 것과 가장 큰 DX 차이.)
- **async 팩토리 불가.** 생성된 팩토리는 전부 동기(`(c)=>...`). `await MikroORM.init()`은 팩토리에 못 넣음 → **서비스 클래스의 `onInit()` 라이프사이클 훅**에서 init, `onDestroy()`에서 close. (`lifecycle-runner.ts:39`, `application.ts:265`에서 adapter.start 전에 실행.)
- **동적 모듈/forRoot는 지원되나 호출이 사용자 소스에 있어야 함.** 컴파일러는 `ZIPBUL_CALL` 마커(`Class.method()` 형태)를 사용자 모듈의 dynamicImports에서 감지 → `loadDynamicModule`로 런타임 등록(`injector-generator.ts:526`, `container.ts:199`). forRoot가 반환하는 providers도 동기 팩토리.
- **per-request EntityManager**: 자동 훅 없음. 두 경로 — (a) `scope:'request'` 프로바이더로 `em.fork()`, request scope dispose 시 자동 `onDestroy`(`request-scope-container.ts:90`, http-server.ts가 요청당 createRequestScope+dispose 호출), (b) **`defineMiddleware`의 `provides`/`ctx.set(contextKey, forkedEm)`** 로 컨텍스트 주입.
- **defineAdapter는 무관**(프로토콜 파이프라인 전용). **defineMiddleware는 per-request EM 컨텍스트 메커니즘으로 유효.**
- 결론: **프로바이더만으론 안 됨.** 필요한 것 = 사용자 src의 모듈 글루 + `onInit` 비동기 init 서비스 + (request-scope 프로바이더 또는 미들웨어) per-request EM. 컴파일러 변경 없이 기존 인프라로 가능하나, **자동 결선이 아니라 사용자가 글루를 써야 함**(또는 zipbul 측 브리지 패키지 제공). ※ 이 풀 결선은 코드 분석으로 확인했고 실제 zipbul 앱 PoC 조립은 미실행(다음 단계).

### 3.3 패키지 — 두 레이어, "mikro-orm-bun"은 가칭(미확정)
"mikro-orm-bun"은 내가 임의로 붙인 이름. 정확히는 **두 레이어**가 필요:
1. **MikroORM 드라이버(zipbul 무관)** — Bun.SQL 백엔드. 비공식이라 `@mikro-orm/*` 스코프 불가 → 커뮤니티 관례상 `mikro-orm-bun-sql` 류. 공식은 DB별 별도 패키지(`@mikro-orm/postgresql`·`mysql`·`sqlite`)지만, **Bun.SQL이 4종을 통합**하므로 한 패키지에서 DB별 드라이버 export(`BunPostgreSqlDriver`/`BunMySqlDriver`/`BunSqliteDriver`)가 자연스러움(공식과 갈리는 지점).
2. **zipbul DI 브리지** — NestJS의 `@mikro-orm/nestjs` 대응물(`@zipbul/...`). 모듈 글루 헬퍼 + request-context 미들웨어 + repository 주입 편의.

### 3.4 NestJS DX 대조 — "거의 비슷"하나 동일하진 않음
`@mikro-orm/nestjs` 제공: `MikroOrmModule.forRoot/forRootAsync`, `forFeature([Entity])`, `@InjectRepository`, `@CreateRequestContext`/`@EnsureRequestContext`, 요청당 EM 포크 미들웨어, `MikroORM`+`EntityManager` 주입.
zipbul로 재현 가능성: forRoot/forFeature는 사용자 모듈 글루로 흉내 가능(자동 import는 아님). `@InjectRepository`/`@CreateRequestContext`는 **직접 대응 데코레이터가 없음** → zipbul 브리지가 request-scope/미들웨어로 에뮬레이트 필요. **결론: 매우 근접 가능하나 1:1 아님**(특히 자동 forRoot import와 데코레이터 기반 request-context).

### 3.5 mikro-orm postgres와 동일 DX? — ORM API는 동일, 단 3가지 제외
EM·QueryBuilder·관계·UoW·Identity Map·SchemaGenerator·Migrator·타입은 **그대로**(전부 @mikro-orm/sql 재사용). 제외/차이:
- **스트리밍 불가** (Bun.SQL 커서 없음; 공식은 pg-cursor)
- **타입 파서 제어 상실** — 공식 pg 드라이버는 `createPostgreSqlTypeParsers`+pg `TypeOverrides`로 OID별 JS 변환을 명시 제어. Bun.SQL은 자체 변환 → 흔한 타입(Date/json/bigint/decimal)은 검증됐으나 엣지 타입은 Bun 동작에 의존(MikroORM의 세밀 제어 못 씀).
- **callRoutine/refcursor**(저장프로시저 OUT/refcursor) 미구현.

### 3.6 직접 만들 것 vs 그대로 쓸 것 (확정)
**그대로 재사용(만들 필요 없음):** `@mikro-orm/sql` 전체(SqlEntityManager·QueryBuilder·UnitOfWork·Identity Map·SqlSchemaGenerator·SchemaComparator·SchemaHelper), 플랫폼(`BasePostgreSqlPlatform`/`MySqlPlatform`/`SqlitePlatform`), ExceptionConverter, `@mikro-orm/migrations`(Migrator), kysely의 DB별 Adapter/QueryCompiler/Introspector, `@mikro-orm/decorators/es`(모던 데코레이터), `definePostgreSqlConfig`류·MikroORM 서브클래스 패턴.
**직접 만들 것:** (a) Bun.SQL 백엔드 **Kysely Dialect**(executeQuery=`sql.unsafe`, begin/commit/rollback, **savepoint 3종**, pg/mysql은 `sql.reserve()`로 연결 핀, sqlite는 동기 better-sqlite3 브리지), (b) DB별 얇은 `Connection.createKyselyDialect` + `Driver`(super에 기존 Platform 재사용), (c) **zipbul DI 브리지**(모듈 글루 + request-context 미들웨어), (d) `tinyglobby` 의존(Bun glob 회피).
**못 얻는 것:** 스트리밍, pg 타입파서 세밀제어, refcursor 라우틴.

### 3.7 공식 드라이버 전체 기능 파악 (AbstractSqlConnection 추상 멤버 = createKyselyDialect 1개뿐)
`AbstractSqlConnection`의 추상 메서드는 **`createKyselyDialect` 단 하나**. execute/begin/commit/rollback/transactional/getClient/checkConnection/createKysely는 베이스 제공(즉 dialect만 주면 트랜잭션·실행 무료). 공식 `PostgreSqlConnection`이 베이스 위에 **추가**하는 것: createKyselyDialect(pg.Pool+kysely PostgresDialect), `callRoutine`(저장프로시저/refcursor), `mapOptions`(TypeOverrides+OID 타입파서, onCreateConnection), pg-cursor 스트리밍. 그 외 PostgreSqlPlatform(BasePostgreSqlPlatform 확장)·PostgreSqlEntityManager(pg 헬퍼)·definePostgreSqlConfig·PostgreSqlMikroORM·raw(). → 우리가 신경 쓸 표면은 createKyselyDialect + (선택)callRoutine/타입파서이며 나머지는 상속으로 해결.
