# `@zipbul/mikro-orm` — 정공법 설계 (Bun.SQL MikroORM 드라이버 + zipbul DI 브리지)

근거: 공식 MikroORM v7.1.1 소스 계약 추출 + Bun.SQL 실측 + Codex 2라운드 리뷰. (SPIKE-FINDINGS.md §1–5의 실증 위에 구축)

## 0. 결론
드라이버 아키텍처(Bun.SQL 백엔드 Kysely dialect + 공식 Platform 재사용)는 타당. 단 PoC는 4개 결함이 있어 그대로 프로덕션 불가. 아래 BLOCKING을 닫으면 "MikroORM 풀 DX 유지 + 드라이버만 커스텀"이 성립.

## 1. 드라이버 계약 (공식 미러링 — 확정)
- `Bun{Pg,My,Sqlite}Driver extends AbstractSqlDriver`: `super(config, new {PostgreSql|MySql}Platform()/SqlitePlatform(), Bun{X}Connection, ['kysely'])` + `createEntityManager()`(공식 EM 재사용) + `getORMClass()`.
- `Bun{X}Connection extends AbstractSqlConnection`: **유일 추상 메서드 `createKyselyDialect()`만 구현**. 공식 Platform 재사용으로 exceptionConverter·schemaHelper·isolation/savepoint SQL·quoting을 공짜로 얻음.
- **트랜잭션 레이어링(Codex A 확정)**: MikroORM `AbstractSqlConnection`이 Kysely 고수준 API(`getClient().startTransaction().setIsolationLevel().setAccessMode().execute()` → ControlledTransaction, `.commit()/.rollback()/.savepoint()/.releaseSavepoint()/.rollbackToSavepoint()`)로 트랜잭션을 구동. 커스텀 드라이버는 **Kysely 저수준 Driver 인터페이스만** 구현(Kysely가 호출). 별도 트랜잭션 코드 작성 금지.

## 2. BLOCKING 수정 (프로덕션 게이트)

### B1-a. 에러 정규화 (최우선, 신규 발견)
- 실측: Bun.SQL pg 에러는 SQLSTATE를 **`.errno`(23505)** 에 넣고 `.code='ERR_POSTGRES_SERVER_ERROR'`. 그러나 공식 `PostgreSqlExceptionConverter`는 **`exception.code==='23505'`** 로 분기 → **그대로면 UniqueConstraint/FK/NotNull/Deadlock 전부 안 잡히고 generic 500.**
- 수정: Kysely dialect의 `executeQuery`(및 트랜잭션 제어 경로)에서 Bun 에러를 catch→정규화 후 rethrow. pg: `errno→code` 복사(`.detail/.constraint/.table/.severity` 보존). sqlite: `SQLITE_*`/errno 매핑. mysql: errno가 공식(1062 등)과 일치하는지 **검증 후** 동일 처리. → 정규화 seam이 커스텀 컨버터보다 간단·견고(Codex B).
- DML뿐 아니라 트랜잭션 제어 에러도 이 경로를 타는지 테스트.

### B1-b. 결과 매핑 (insertId/affectedRows)
- `transformRawResult`는 `rows`, `numAffectedRows ?? rows.length`, `insertId`를 읽음. `executeQuery`는 `{rows, numAffectedRows, insertId}` 반환 필수. pg=RETURNING(insertId 불필요), **mysql/sqlite=lastInsertRowid→insertId** 매핑 필수(현 PoC 누락).

### B1-c. 트랜잭션 settings
- Kysely `Driver.beginTransaction(connection, settings)`의 `settings.{isolationLevel, accessMode}`를 **반드시 적용**(PoC는 무시). savepoint/rollbackTo/release는 platform-quoted 이름 사용(raw 보간 금지).

### B3. 비파괴 onInit
- `MikroOrmBase.onInit` = `MikroORM.init`(+선택 `isConnected()` 체크)**만**. schema drop/create·seed **절대 금지**(데이터 손실). 스키마생성·마이그레이션은 명시적 CLI/dev-가드 op. (PoC의 drop+create는 시드용이었음 — 제거)

## 3. DX 설계 (NestJS 패리티)
- **DI 브리지**: 패키지가 `MikroOrmBase` 추상 제공, 사용자는 src에 얇은 `@Injectable` 서브클래스(`options()`만, env/config에서 설정). 상속 onInit이 zipbul 라이프사이클서 호출됨(실증).
- **per-request EM**: `defineMiddleware`에서 `RequestContext.create(em, next)` (가능하면 — auto-clean) 또는 `enter(em)` (next-less, Bun.serve가 요청별 fresh ALS scope라 bounded). + **request-scoped EM 프로바이더**가 `RequestContext.getEntityManager()`를 resolve → 서비스가 EM을 직접 주입(ctx.use보다 나은 DX). 요청 외 백그라운드 작업은 같은 ALS 상속 주의(Codex C).
- **Repository 주입(forFeature/@InjectRepository 대응)**: 패키지가 `defineRepositoryProviders([Entity,...])` 헬퍼 제공 → 프로바이더 레코드 배열 반환, 사용자가 자기 모듈 providers에 spread(컴파일러가 src만 스캔하므로 외부 패키지 자동등록 불가 — Codex D "correct"). 토큰 충돌 규약 + named connection 토큰 + 커스텀 repository 클래스 등록 확장 필요.

## 4. SHOULD-FIX (프로덕션 체크리스트)
- **named connections**: `options()` contextName 지원 + `RequestContext.getEntityManager(name)` + named DI 토큰.
- **graceful shutdown**: zipbul OnDestroy에서 in-flight 요청 drain 후 `orm.close()` 순서 검증.
- **query logging**: MikroORM logger가 Bun 드라이버의 모든 쿼리(트랜잭션/savepoint 포함) 수신하는지 검증.
- **read replicas**: `AbstractSqlDriver.createReplicas`가 Bun.SQL reserve와 어떻게 매핑되는지 검증.
- **entity discovery**: Bun에서 glob 동작 차이 — 명시적 `entities:[...]` 권장, glob 쓰면 tinyglobby. 마이그레이션도 tinyglobby 필수(Bun fs.glob withFileTypes 미지원).

## 5. NICE-TO-HAVE / 한계 (명시적 계약)
- **스트리밍 미지원**: Bun.SQL 커서 없음 → `streamQuery`는 silent hang 아닌 **명시적 에러 + 문서화**.
- pg 타입파서 세밀제어(공식 `createPostgreSqlTypeParsers`/TypeOverrides) 상실 — Bun 자체 변환. 흔한 타입(Date/json/bigint/decimal) 실증됨, 엣지타입은 테스트로 커버.
- `callRoutine`/refcursor 미구현 — 필요 시 Connection에 추가.

## 6. 패키지
- 단일 `@zipbul/mikro-orm`: 3 드라이버 + MikroOrmBase + request 미들웨어 팩토리 + defineRepositoryProviders export. peerDeps `@mikro-orm/{core,sql,postgresql,mysql}`+`kysely`, deps `tinyglobby`. 비-zipbul 재사용 수요 생기면 `@zipbul/mikro-orm-bun`(드라이버만) 분리.
- **빌드 전제**: 드라이버는 반드시 실제 node_modules 패키지(워크스페이스 심링크/ src 안이면 AOT가 내부클래스 파싱→번들 실패). 앱 root tsconfig는 `experimentalDecorators:false`(Bun이 extends override 무시).

## 7. Codex 최종 우선순위
1) 에러 정규화 — BLOCKING  2) 트랜잭션 settings — SHOULD-FIX  3) named connections — SHOULD-FIX  4) per-request EM(create>enter) — SHOULD-FIX  5) shutdown/logging/replicas — SHOULD-FIX  6) repository providers — CORRECT  7) streaming 명시 — NICE-TO-HAVE
(+ 내 추가 BLOCKING: B3 비파괴 onInit, B1-b insertId 매핑)

---

## 8. 검증: zipbul은 현재 "클래스 프로바이더만" 지원 (실측, 결정적)

`defineModule({ providers: [{ provide, useValue/useFactory, inject }] })`를 최소 앱으로 실측 (워크트리):
- 빌드: 성공이나 **"0 providers"** — 명시적 레코드 미등록.
- 런타임: 컨트롤러가 useFactory로 제공한 `Greeter` 주입 → **HTTP 500**(의존성 미해결).

근본 원인: `convertModuleDefinition`(providers 배열 추출)은 **객체 리터럴 initializer**일 때만 호출됨(`ast-parser.ts:416`). `defineModule(arg)` **호출 경로**(`framework-call-detector.ts:134-143`)는 args를 raw로만 저장하고 providers를 모듈 프로바이더 집합으로 변환하지 않음. + `DefineModuleOptions`는 `{__temp?}` 스텁.

**결론(확정)**: 현 zipbul DI는 **`@Injectable` 클래스 프로바이더 + 폴더 컨벤션 + `visibleTo` 가시성**만 동작. useValue/useFactory/useExisting 레코드는 미지원.

### 8.1 설계에 미치는 영향
- ✅ **OrmService**(class `@Injectable`, `visibleTo:'all'`) — 동작(실증).
- ✅ **per-request EM** — 미들웨어 + `ctx.set/use(RequestEm)` 컨텍스트 키(프로바이더 아님) — 동작(실증).
- ❌ **`defineRepositoryProviders`(useFactory 레코드)** — **불가**. `@InjectRepository`/`forFeature` 패리티는 현재 미달성.
- ❌ **useValue 설정 프로바이더** — 불가. 설정은 OrmService 내부(env/config)에서 읽음.

### 8.2 repository 주입 DX — 현실적 대안 (클래스 프로바이더만으로)
1. **EM/서비스 주입 후 `em.getRepository(Entity)`** — 가장 단순, 확실. (권장 기본)
2. **엔티티별 `@Injectable` 리포지토리 래퍼 클래스**(사용자 작성): `@Injectable() class UserRepo { private orm = inject(OrmService); find(){ return this.orm.em.getRepository(User).findAll() } }` — 약간 장황하나 클래스 프로바이더라 동작.
3. zipbul이 `defineModule({providers})` 레코드 경로를 구현하면 그때 `defineRepositoryProviders`로 `@InjectRepository`급 DX 가능 — **프레임워크 측 선결 과제**.

### 8.3 패키지 계획 수정
- `@zipbul/mikro-orm`는 `MikroOrmBase`(클래스) + 드라이버 + request 미들웨어 팩토리만 우선 제공. `defineRepositoryProviders`는 **프레임워크가 provider 레코드를 지원하기 전까지 보류**(또는 클래스 래퍼 생성 헬퍼로 대체).
- 즉 "NestJS DX 패리티"의 상한은 **현재 zipbul DI 능력(클래스 프로바이더)** 이 결정. forRoot/forFeature/@InjectRepository 완전 패리티는 zipbul 코어의 provider-record 지원이 전제.

---

---

## 9. 최종 DX — 단일 `inject` (실증 완료) — `poc/zipbul-mikro-orm-dx/`

DX 일관성 위해 **새 주입 함수 0개**. 사용자는 zipbul 기존 `inject(Database)` 하나만 쓰고, 거기서 `.repo(Entity)`·`.em`을 꺼낸다. `.em`/`.repo()`는 호출마다 `RequestContext`를 읽어 요청별 fork로 자동 해석. injectRepository/injectEntityManager/레지스트리/프록시 전부 폐기. 패키지 ~52줄.

### 9.1 사용자 코드 (전부)
```ts
// entity — 모던 ES 데코레이터, 단일 import
import { Entity, PrimaryKey, Property } from '@zipbul/mikro-orm';
@Entity() export class User { @PrimaryKey({type:'number',autoincrement:true}) id!:number; @Property({type:'string'}) email!:string; }

// database/orm.service.ts — 유일한 글루: @Injectable 서브클래스
@Injectable({ scope:'singleton', visibleTo:'all' })
export class Database extends MikroOrm({ driver: BunPostgreSqlDriver, clientUrl: env.DB_URL, entities:[User] }) {}

// database/db-context.middleware.ts — 한 줄(기존 inject 사용)
export const dbContext = defineMiddleware([HttpAdapter], () => { const db = inject(Database); return () => db.enter(); });

// users/users.service.ts — inject 하나, 끝
@Injectable()
export class UsersService {
  private readonly db = inject(Database);              // ← zipbul 기존 inject, 단 하나
  list() { return this.db.repo(User).findAll(); }      // 요청별 fork repo
  async create(email) { const u=this.db.repo(User).create({email}); await this.db.em.persistAndFlush(u); }
}
// controller: @UseMiddlewares('BeforeHandle',[dbContext])
```

### 9.2 패키지(`@zipbul/mikro-orm`, ~52줄)
- `BunPostgreSqlDriver`(+My/Sqlite 동형) — AbstractSqlDriver + 공식 PostgreSqlPlatform 재사용, 에러정규화(errno→code)·insertId·tx settings 포함.
- ES 데코레이터 재export.
- `MikroOrm(options)` 믹스인 = 사용자가 @Injectable로 상속하는 **유일한 클래스**: `onInit`=init만(비파괴), `onDestroy`=close, **`get em`**(RequestContext 우선, 없으면 global), **`repo(E)`**(현재 em의 repository), **`enter()`**(미들웨어용 RequestContext.enter).

### 9.3 실증 (실 PostgreSQL, 워크트리)
빌드 `3 modules, 2 providers`(Database+UsersService, 클래스만). `GET /users` 200 — `inject(Database).repo(User).findAll()` 실 PG. 5 동시요청 → `db.em.id` = 5,6,7,8,9 **전부 distinct**(요청별 fork 격리). **zipbul 기존 inject 하나로** NestJS @InjectRepository+RequestContext 상응 DX 달성.

### 9.4 정리
- 주입 = `inject(Database)` 하나(프레임워크 표준과 동일). repo/em은 서비스 메서드.
- 글루 = `Database` 서브클래스 1개 + `dbContext` 1줄. 그 외 학습할 신규 개념 없음.
- named connection: `MikroOrm({connection:'replica'})` + 별도 @Injectable 클래스 → `inject(Replica)`. (설계 반영, 미실증)
