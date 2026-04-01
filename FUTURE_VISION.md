# Future Vision — 외부 의존 대기

---

## Bun.build() Manual Chunks

Bun.build() API에 `manualChunks` 또는 chunk 경계 제어 옵션이 추가되면 착수.

### Bun 이슈

[oven-sh/bun#26504](https://github.com/oven-sh/bun/issues/26504) — "add manual chunks" (2026-01-27, open, 메인테이너 응답 없음)

### 구현 계획

AOT 컴파일러가 gildash `getImportGraph()`로 DI 모듈 경계를 분석하고, `manualChunks` 옵션에 모듈별 chunk 그룹핑을 전달:

```typescript
const importGraph = await ledger.getImportGraph();
const moduleChunks = computeModuleChunks(graph.modules, importGraph);

await Bun.build({
  entrypoints: [entryPointFile, runtimeFile, workerFile, runtimeMasterFile],
  outdir: outDir,
  splitting: true,
  manualChunks: moduleChunks,
});
```

### 사용자 영향

대규모 앱에서 DI 모듈 경계에 맞춘 chunk splitting → lazy module loading 시 불필요한 코드 로딩 감소, cold start 최적화.

### 경쟁 도구 현황

- Rollup: `output.manualChunks` 지원
- Rolldown: `output.manualChunks` 지원
- esbuild: 미지원
- Bun: 미지원 (이슈 open)

---

## Bun.serve HTTP 파서 에러 커스텀 응답

Bun.serve에 Node.js `http.Server.clientError` 이벤트에 상응하는 `clientErrorHandler` 옵션이 추가되면 착수.

### 문제

Bun HTTP 파서가 프레임워크 도달 전에 거부하는 요청(400, 413, 431, 505, silent close)은 상태 코드 + `Connection: close` + 빈 body로 응답한다. 프레임워크 에러 파이프라인(ExceptionFilter, 로깅)을 경유하지 않으며, 응답 형식이 프레임워크 도메인 에러(JSON body)와 불일치한다.

### Bun 파서 거부 목록 (Bun 1.3.9 검증)

| 응답 | 트리거 |
|------|--------|
| **Silent close** (0 bytes) | 소문자/혼합 케이스 메서드, 불완전 요청 |
| **400 Bad Request** | 음수/비숫자 CL, Host 누락, 헤더 null byte, 빈/특수문자 메서드, TE+CL 충돌, 잘못된 TE, malformed request line, obs-fold, CL 오버플로 |
| **413 Request Entity Too Large** | Content-Length > maxRequestBodySize |
| **431 Request Header Fields Too Large** | URL > ~16,350자, 헤더값 > ~16,340바이트, 헤더 수 > ~198개 |
| **505 HTTP Version Not Supported** | HTTP/1.0,1.1 외 버전, URL null byte, LF-only 줄끝 |

### fetch에 도달하지만 프레임워크가 방어하는 케이스

| 케이스 | 방어 |
|--------|------|
| 중복 Content-Length (`"5, 3"`) | `parseContentLength`에서 콤마 감지 → 프로토콜 에러 400 |
| URL 백슬래시 정규화 (`\` → `/`) | 필요 시 path traversal 방어 |

### Bun 이슈

- [oven-sh/bun#6556](https://github.com/oven-sh/bun/issues/6556) — 커스텀 HTTP 메서드 silent close 문제 (open)
- [oven-sh/bun#15475](https://github.com/oven-sh/bun/issues/15475) — error 핸들러에 request 헤더 접근 요청. Jarred가 경량 객체 전달 검토 중 (open)

### 타 프레임워크 현황

| 런타임 | 프레임워크 | 파서 에러 커스텀 응답 |
|--------|-----------|---------------------|
| Node.js | Express | `server.on('clientError')` — 소켓에 직접 HTTP 응답 write |
| Node.js | Fastify | `clientErrorHandler` 옵션 — 로깅 + 커스텀 JSON 응답 |
| Bun | Elysia | 미해결 |
| Bun | Hono | 미해결 |
| Bun | Zipbul | 미해결 — Bun 지원 시 즉시 통합 |

### 구현 계획 (Bun 지원 시)

`HttpServerOptions.clientErrorHandler`로 파서 에러 핸들러 주입:

```typescript
interface HttpServerOptions {
  clientErrorHandler?: (error: ClientError) => Response;
}
```

기본 구현: 프레임워크 에러 형식(JSON body)으로 응답 + 로깅 파이프라인 경유.

### 검토한 우회 방법과 폐기 근거

| 방법 | RPS (Bun.serve 대비) | 폐기 근거 |
|------|---------------------|----------|
| TCP 프록시 (Bun.listen → Bun.serve) | ~2,000 (2%) | 매 요청 새 TCP 연결. 성능 치명적 |
| UDS 프록시 (Bun.listen → Unix socket) | ~9,000 (10%) | 여전히 연결 오버헤드 |
| node:http 호환 레이어 | ~50,000 (58%) | clientError 이벤트 발생하지만 socket.write() 미동작 (Bun 호환 불완전) |
| Raw TCP + 직접 HTTP 파싱 (keepalive) | ~92,000 (109%) | 성능 우수하지만 HTTP/1.1 파서 직접 구현 필요 (chunked, pipelining, TCP fragmentation) |
| Manual fetch (Bun.listen + new Request) | ~67,000 (79%) | 성능 양호하지만 HTTP 파싱 직접 구현 필요 |

실제 프로덕션에서 HTTP 파싱 오버헤드는 전체 레이턴시의 1~2%. 비즈니스 로직 + DB가 병목이므로 서버 순수 성능 차이는 무의미. 그러나 HTTP/1.1 파서 직접 구현의 복잡도와 보안 리스크를 감수할 가치가 없다.
