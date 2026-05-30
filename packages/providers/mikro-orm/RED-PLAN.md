# `@zipbul/mikro-orm` — TDD RED 구현 계획

목적: RED 우선(실패 테스트 먼저)으로 3-레이어 테스트를 작성한다. 근거: TCK/테스팅 인프라 전수조사 + unit-test 규칙(Bun bun:test) + ARCHITECTURE.md. (검토용 — Codex 심층 리뷰 대상)

## 0. 결론 / 레이어 결정
**3 레이어 모두 한다.** 각 레이어가 다른 실패 모드를 잡는다:
- **UNIT** (`src/**/*.spec.ts`, 콜로케이트): 순수/격리 가능한 로직. 외부 I/O·전역 상태만 목. 14 SUT.
- **INTEGRATION** (`test/integration/**/*.test.ts`): 실제 MikroORM 인스턴스 — dialect 라운드트립·에러정규화→예외·트랜잭션/savepoint·스키마/마이그레이터·타입변환·context/registry ALS.
- **E2E** (`test/e2e/**/*.e2e.test.ts`): TCK로 부팅한 실제 zipbul HTTP 앱 — `inject(UserRepository)` over HTTP·동시요청 fork 격리·에러→HTTP 매핑.

실행: `bun test` (per-package; bunfig `coverageThreshold=0.95` 상속). 통합/e2e는 docker DB 필요(아래 §5).

## 1. 도구 (전수조사 결과)
- **bun:test** + 루트/패키지 `bunfig.toml`(coverage 0.95, reporter dots). 유닛 규칙: 한 behavior=한 test, 외부I/O·비결정성·전역상태만 목, EP/BVA/exception.
- **`@zipbul/tck`**: `Tck.createApplication({ register: (app)=>... })` → `TestApplication`(`.close()`), `Tck.silenceLogger()/restoreLogger()`. **앱 부트 하니스일 뿐** — 어설션·DB·ALS 헬퍼 없음(§4 업그레이드).
- **`@zipbul/testing`**: `Test.create(module,{attach,override})`, `createHttpClient`(verb), DI 오버라이드, `mockContext/mockRequest/mockResponse`. (단 AOT 컴파일 필요 — 통합엔 TCK 경로가 가벼움.)
- e2e 부트 패턴: cors `test/e2e/helpers.ts`처럼 `Tck.createApplication`로 HttpAdapter(port:0) 띄우고 `fetch(127.0.0.1:${port})`.

## 2. UNIT RED 맵 (14 SUT, 콜로케이트 `*.spec.ts`)
규칙: 목 = ReservedConnection/BunSqlClient(외부 I/O), MikroORM.init·RequestContext(외부/ALS), ConnectionRegistry·EntityManagerResolver·RequestContextRunner(전역 static). real = 에러객체 POJO·상수·같은모듈 클래스·CompiledQuery 값·Proxy/Reflect. 어설션 = 반환/관찰가능 상태(SQL 문자열이 곧 behavior인 곳만 toHaveBeenCalled).

| spec 파일 | SUT | 핵심 케이스(요약) |
|---|---|---|
| `dialect/bun-sql-connection.spec.ts` | `BunSqlConnection` executeQuery/streamQuery/release | EP: rows/numAffectedRows(BigInt)/insertId 매핑; BVA: affectedRows=0·lastInsertRowid=0 키 포함; EP-inv: undefined/비배열→rows=[]; exception: normalize된 에러 그대로 rethrow(toBe sentinel), streamQuery→StreamingUnsupportedError; param 새 배열로 전달 |
| `dialect/bun-sql-transaction.spec.ts` | `BunSqlTransactionController` | EP: isolation→`set transaction isolation level X`+`begin`; accessMode; 둘다 순서; EP-inv: {}→`begin`만; BVA: undefined→skip; commit/rollback/savepoint/rollbackTo/release SQL |
| `dialect/bun-sql-kysely-driver.spec.ts` | `BunSqlKyselyDriver` | exception: init 전 acquire→throw 'used before init()'; EP: init→createClient(url,poolMax); acquire→reserve()+instanceof BunSqlConnection; destroy→close(); BVA: client undefined일 때 destroy no-throw; tx 위임 관찰 |
| `dialect/bun-sql-dialect.spec.ts` | `BunSqlDialect` | EP: create* 델리게이션(sentinel toBe), introspector(db) 인자 패스스루; createClient 주입 시 init서 호출; BVA: poolMax 생략→DEFAULT_POOL_MAX; fallback Bun.SQL 스텁 |
| `dialect/errors.spec.ts` | `StreamingUnsupportedError` | instanceof Error, name, message |
| `driver/postgres/postgres.error-normalizer.spec.ts` | `PostgresErrorNormalizer.normalize` | EP: errno+code ERR_*→code=String(errno); 이미 SQLSTATE→무변경; detail/constraint/table 보존+동일참조; BVA: 'ERR_' 경계 vs 'ERRX'; exception: frozen 에러 no-throw |
| `driver/mysql/mysql.error-normalizer.spec.ts` | `MySqlErrorNormalizer.normalize` | EP: 항등 반환(현 스텁) — ※ 통합서 errno 1062 정렬 검증 후 RED 확장 |
| `driver/sqlite/sqlite.error-normalizer.spec.ts` | `SqliteErrorNormalizer.normalize` | EP: 항등(현 스텁) — ※ SQLITE_* 매핑 구현 시 RED 확장 |
| `connection/connection-registry.spec.ts` | `ConnectionRegistry` static | exception: 미등록 get→ConnectionNotRegisteredError; EP: set/get/has/delete/overwrite; BVA: 미등록 delete no-op. **afterEach 전역 Map 리셋** |
| `connection/errors.spec.ts` | `ConnectionNotRegisteredError` | instanceof, name, message에 이름 보간 |
| `context/entity-manager-resolver.spec.ts` | `EntityManagerResolver.resolve` | EP: scoped fork 있으면 그것; 없으면 registry.em; BVA: null도 ?? 폴백; exception: registry throw 전파 |
| `context/request-context-runner.spec.ts` | `RequestContextRunner.enter` | EP: registry.em으로 RequestContext.enter(side-effect가 behavior→toHaveBeenCalledWith em); exception: registry throw |
| `orm/mikro-orm.service.spec.ts` | `MikroOrmService`(in-file 서브클래스) | EP: onInit→MikroORM.init+registry.set('default'/named); **비파괴: schema API 절대 호출 안 함**; onDestroy→registry.delete+orm.close; BVA: onInit 전 onDestroy no-throw; em getter/enter 위임; exception: init reject→registry.set 안 됨 |
| `repository/base-repository.spec.ts` | `BaseRepository` Proxy | EP: 사용자 메서드 우선; entity 접근; 위임 메서드 repo 바인딩; non-func 패스스루; default/named connection으로 resolve; BVA: 접근마다 resolve 재호출(no-cache=요청격리 불변); exception: resolve throw 전파 |

**유닛 제외(통합/e2e로)**: 배럴 index들, type-only(interfaces/types), 단일 상수(constants), `driver/<db>/kysely-parts.ts`(kysely 실클래스 instanceof=통합), `*.connection.ts`/`*.driver.ts`(AbstractSql* 베이스+실 Configuration 필요=통합).

## 3. INTEGRATION RED (`test/integration/**/*.test.ts`, 실 MikroORM)
하니스: `MikroORM.init({ driver: BunPostgreSqlDriver, clientUrl, entities, extensions:[SqlSchemaGenerator] })` 직접(또는 TCK §4-A). 격리: 케이스마다 schema refresh 또는 §4-C withRollback.

| 타깃 | DB | RED 내용 |
|---|---|---|
| dialect 라운드트립 | docker **pg** (reserve 필요) | EM/QB로 select/insert/update/delete → rows·numAffectedRows·insertId(lastInsertRowid) 매핑; `BunSqlConnection` 직접 구성해 result-shape; streamQuery→StreamingUnsupportedError |
| 에러정규화→예외 | docker **pg + mysql** | UNIQUE 중복 insert→`instanceof UniqueConstraintViolationException`; NotNull/FK/Check도; pg(23505)·mysql(1062) 동일 파라메트릭 |
| 트랜잭션+savepoint | docker **pg** | `em.transactional` 중첩→SAVEPOINT/ROLLBACK TO; 내부 롤백 격리; read-only txn서 write 실패(isolation/accessMode SQL); **~20 동시 txn 전부 커밋·distinct**(reserve 풀) |
| 스키마생성+마이그레이터 | schema=**sqlite :memory** / migrator=docker **pg** | `getCreateSchemaSQL()` DDL 스냅샷; 실 Migrator(tinyglobby+savepoint) up()/down(); 온디스크 glob 발견 검증 |
| 타입변환 | docker **pg(+mysql)** | timestamp/jsonb/bigint/numeric 엔티티 persist→**fresh fork** 재조회: Date·json·bigint(무손실)·decimal(정확) 라운드트립 |
| context/registry ALS | **sqlite :memory**(DB무관) | 실 MikroORM registry 등록→`RequestContextRunner.enter`를 인터리브 async 2개서→각 컨텍스트 fork EM, 밖은 global. registry 리셋 |

## 4. E2E RED (`test/e2e/**/*.e2e.test.ts`, TCK 부트 HTTP 앱)
하니스: `Tck.createApplication({ register })` — register에서 `@Injectable Database extends MikroOrmService`(driver=BunPostgreSqlDriver) + `dbContext` 미들웨어(OnRequest) + `@Injectable UserRepository extends BaseRepository<User>` + 컨트롤러(`inject(UserRepository)`). start 전 schema refresh. afterAll: close + registry 리셋. `Tck.silenceLogger()`.

| 플로우 | DB | RED 내용 |
|---|---|---|
| inject(UserRepository) over HTTP | docker **pg** | POST→GET 라운드트립; 한 요청이 만든 row 다음 요청서 read |
| per-request fork 격리(동시성) | docker **pg** | request-tagged write+yield 라우트; ~20 동시 fetch→각자 자기 데이터만, EM-id 헤더 전부 distinct(§6 재증명) |
| 에러→HTTP | docker **pg** | 같은 unique email 2회 POST→2번째가 예외필터로 매핑된 HTTP(409/400) |

## 5. DB 프로비저닝
2 레인: (A) **bun:sqlite :memory** — DB무관(ALS/registry/스키마SQL)만, 인프라 0, 기본 `bun test` 레인. ⚠️ Bun.SQL sqlite는 `reserve()` 미지원(`sqlite.connection.ts` 플레이스홀더) → 풀/savepoint/에러정규화 검증 불가. (B) **docker postgres(+mysql)** — reserve/동시성/에러코드/타입은 실 DB 필수. compose/CI-service가 컨테이너 소유, 테스트는 env 커넥션스트링 사용(`DB_URL_PG`/`DB_URL_MYSQL`), docker 없으면 통합/e2e skip(유닛은 항상 실행).

## 6. TCK 업그레이드 (점진적 — 필요한 것만, 과추상 금지)
TCK가 "프레임워크 개발자용 공용 테스팅 툴"이므로 **여러 provider가 재사용할 lifecycle만** 승격. 1회성 connect는 로컬 헬퍼 유지.
1. **`Tck.createDatabase({url,driver,entities,refresh?})`** → `{orm,em,refresh(),close()}`. `select 1` backoff로 readiness 폴링(CI 서비스컨테이너 레이스 방지), close=orm.close(true). driver-agnostic. docker 오케스트레이션은 TCK 밖.
2. **`Tck.assertConcurrentIsolation({app,port,n,request(i),capture(res)})`** → n 동시 fetch, capture 값 pairwise distinct 어설션. (core의 request-scope 테스트와 공유 패턴, mikro-orm 비종속.)
3. **`Tck.withRollback(orm, async em=>{...})`** → txn 시작·body·finally 롤백. **opt-in**(savepoint/commit/concurrency 스위트엔 부적합 — 그건 createDatabase+refresh). 얇은 헬퍼, 베이스클래스 아님.
→ 이 3개는 작성하다 실제로 필요해질 때 추가. 우선 로컬 헬퍼로 시작해 중복이 보이면 TCK로 승격.

## 7. RED 실행 순서 & "RED 완료" 정의
1. **유닛 14 spec 먼저 전부 작성**(§2). 스캐폴드에 이미 검증 로직이 있는 부분(pg normalizer·tx controller·registry·resolver·service·base-repo)은 GREEN일 수 있음 — 그래도 계약을 고정. **스텁/미구현(mysql/sqlite normalizer 정렬, sqlite no-reserve)·스캐폴드 결함은 RED**가 되어 구현 워크리스트가 됨.
2. 통합 spec 작성(§3) — docker 없으면 skip-guard. dialect 라운드트립·에러정규화부터.
3. e2e spec 작성(§4).
4. **RED 완료 = 모든 spec 작성됨 + 실행해 RED/GREEN 분류됨**. RED 집합 = 다음 구현(GREEN) 페이즈의 작업 목록. 커버리지 0.95 게이트는 GREEN 페이즈 종료 기준.

## 8. 미해결/리뷰 포인트
- 스캐폴드 일부가 이미 GREEN인데 "RED 우선" 원칙과 어떻게 화해할지(§7-1 방식: 계약 고정 + 미구현만 RED)가 맞는지 — Codex 리뷰.
- mysql/sqlite normalizer가 현재 항등 스텁: 유닛은 "항등"을 RED로 박고 통합서 errno/code 실제 정렬을 RED로 둘지.
- sqlite no-reserve: 유닛/통합서 어디까지 RED로 표현할지(현재 비기능 플레이스홀더).
- TCK 업그레이드 3건을 지금 넣을지 vs 로컬 헬퍼로 시작 후 승격할지.
