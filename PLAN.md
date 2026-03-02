# Gildash 0.8.0 이벤트 API 적용 계획

## Context

Gildash 0.8.0이 제공하는 `onError`, `onRoleChanged` 이벤트 API를 MCP 서버에 적용한다.

현재 MCP 서버의 gildash는 **도구 호출마다 열고 닫는** 일회성 패턴이다. 이벤트 구독을 활용하려면 서버 수명 동안 유지되는 장기 인스턴스가 필요하다.

OwnerElection(파일 락)과 gildash 내부 소유권은 **스코프가 다르다**:
- OwnerElection: MCP 인스턴스 간 `index.sqlite` 쓰기 권한 경합
- Gildash 소유권: 같은 projectRoot의 모든 gildash 사용자(`zb dev`, `zb mcp` 등) 간 gildash DB 경합

따라서 **OwnerElection은 유지**하고, gildash 장기 인스턴스를 별도로 관리한다.

## 변경 사항

### 1. MCP 서버에 장기 gildash 인스턴스 도입

**파일**: `packages/cli/src/mcp/server/mcp-server.ts`

`startZipbulMcpServerStdio` 함수에서:

- OwnerElection 이후, 서버 초기화 시점에 `Gildash.open()` 한 번 호출
- gildash 생성 실패 시 `undefined`로 진행 (현재 per-call 패턴의 catch와 동일한 정책)
- `onError` 구독: gildash 내부 오류를 `console.error`로 로깅
- `onRoleChanged` 구독: gildash 역할 변경을 `console.error`로 로깅 (MCP 역할과의 불일치 감지용)
- SIGINT 핸들러에 `gildash.close()` 추가
- `ZipbulMcpContext`에 `gildash?: Gildash` 필드 추가 — 장기 인스턴스 참조 보관

### 2. `withGildashIndex`에서 per-call gildash 생성 제거

**파일**: `packages/cli/src/mcp/server/mcp-server.ts`

현재:
```typescript
const withGildashIndex = async (ctx, mode) => {
  const db = createDbFn(dbPath);
  let gildash = await openGildash({...});  // 매 호출 생성
  try { ... }
  finally { closeDbFn(db); await gildash?.close(); }  // 매 호출 종료
};
```

변경:
```typescript
const withGildashIndex = async (ctx, mode) => {
  const db = createDbFn(dbPath);
  try { return await indexProjectFn({..., ...(ctx.gildash ? { gildash: ctx.gildash } : {})}); }
  finally { closeDbFn(db); }  // gildash는 닫지 않음
};
```

- `ctx.gildash`(장기 인스턴스) 참조
- DB만 호출마다 열고 닫기
- `ZipbulMcpDeps.createGildash` 필드 제거 (withGildashIndex에서 더 이상 사용하지 않음)

### 3. 인터페이스 변경

**`ZipbulMcpContext`**:
```typescript
export interface ZipbulMcpContext {
  projectRoot: string;
  config: ResolvedZipbulConfig;
  role?: 'owner' | 'reader';
  gildash?: Gildash;  // 추가
}
```

**`StartZipbulMcpServerDeps`**:
- `createGildash` 필드 추가 (서버 초기화 시 gildash 생성 mock용)

**`ZipbulMcpDeps`**:
- `createGildash` 필드 제거 (withGildashIndex 내부 생성 삭제)

### 4. 테스트 변경

**파일**: `packages/cli/src/mcp/server/mcp-server.spec.ts`

- `withGildashIndex` 관련 테스트: gildash mock을 `ctx.gildash`로 전달하는 방식으로 변경
- 장기 gildash 초기화 테스트 추가: `createGildash` deps mock으로 onError/onRoleChanged 구독 검증
- gildash 생성 실패 시 graceful degradation 테스트 추가
- 기존 OwnerElection 관련 테스트: 변경 없음

## 수정 대상 파일

| 파일 | 작업 |
|------|------|
| `packages/cli/src/mcp/server/mcp-server.ts` | 장기 gildash 도입 + withGildashIndex 리팩터 |
| `packages/cli/src/mcp/server/mcp-server.spec.ts` | 테스트 추가/수정 |

## 변경하지 않는 것

- `OwnerElection` — MCP 전용 소유권으로서 역할 유지
- `shouldRegister` / `ownerOnly` 패턴 — OwnerElection 기반 정적 필터링 유지
- `@parcel/watcher` watch 로직 — 기존 코드 변경/설정 변경 감시 유지
- `tool-registry.ts` — 변경 없음
- `dev.command.ts` — 변경 없음 (이미 onError 적용됨)

## 검증

```bash
bun test packages/cli/src/mcp/server/mcp-server.spec.ts
bun test packages/cli/test/cli-dev.test.ts
bun test
```
