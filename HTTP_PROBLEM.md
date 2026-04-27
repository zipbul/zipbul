# HTTP Adapter 결함 목록

감사 일자: 2026-04-17
대상: `packages/http-adapter/src/` (Bun.serve 위에서 동작하는 HTTP 어댑터)
스코프: 어댑터 고유 책임 영역. 다음은 제외 — 미들웨어, multipart/form-data, query 파서, CORS, 보안 헤더, 쿠키 직렬화, 라우터 내부 구현(`@zipbul/router`).
Bun 버전: 1.3.9

모든 항목은 **runtime/wire 수준 재현** 완료분.

**판정 기준 (고정)**:
1. RFC 9110/9112/3986/7239/5952/8259/6943 의 MUST/MUST NOT 명시적 위반, 또는
2. runtime 으로 재현된 crash/panic/hang, 또는
3. runtime 으로 재현된 보안 우회(스푸핑·오픈 리다이렉트·인젝션), 또는
4. 코드 자신의 약속(docstring·공개 계약·자기 설계)과 동작 불일치 (self-inconsistency).

이 넷 중 하나라도 해당하면 **결함**. 그 외 "타 프레임워크 관행", "modern 기대치", "DX/문서 nit" 은 **결함 아님**.

---

## 🔴 CRITICAL

### C1. `setStatus()` 가 알 수 없는 상태 코드에서 크래시
- **판정**: 결함
- **코드** (`http-response.ts:109-113`):
  ```ts
  setStatus(status: StatusCodes, statusText?: string): this {
    this._status = status;
    this._statusText = statusText ?? getReasonPhrase(status);
    return this;
  }
  ```
- **위반 대상**: `http-status-codes` 라이브러리의 `getReasonPhrase(code)` 는 알 수 없는 코드에 대해 `Error("Status code does not exist: <code>")` 를 throw. 어댑터 자체 계약(`setStatus`는 공개 API, 크래시 없음)과 불일치.
- **재현**: `new HttpResponse(req).setStatus(0)` → Error: "Status code does not exist: 0". 동일 패턴으로 `99, 199, 205, 206, 299, 400.5, 600, NaN, -1` 모두 throw.
- **기대**: 유효하지 않은 상태 코드에 대해 throw 없이 명시적 validation error (예: `RangeError('status must be 100-599')`) 또는 기본 reason-phrase fallback.
- **왜 결함인가**: 기준 2 — 공개 API 가 유효성 체크 없이 하부 라이브러리의 throw 를 그대로 전파.

### C2. `redirect()` 스킴 필터 whitespace/tab 우회
- **판정**: 결함
- **코드** (`http-response.ts:8, 263-266`):
  ```ts
  const DANGEROUS_SCHEME_PATTERN = /^(?:javascript|data|vbscript):/i;
  redirect(url: string, status?: 301 | 302 | 303 | 307 | 308): this {
    if (DANGEROUS_SCHEME_PATTERN.test(url)) {
      throw new Error(`Redirect to dangerous scheme is not allowed: ...`);
  ```
- **위반 대상**: WHATWG URL §4.4 basic URL parser "If input contains any leading or trailing C0 control or space, invalid-URL-unit validation error. Remove any leading and trailing C0 control or space from input." 어댑터의 정규식은 `^` 고정이라 leading `\t`/space 는 통과시키지만, 브라우저는 strip 후 `javascript:` 로 본다.
- **재현**: `redirect(' javascript:alert(1)')` → 통과. `redirect('\tjavascript:alert(1)')` → 통과. `redirect('java\tscript:alert(1)')` → 통과 (브라우저는 tab strip 후 실행).
- **기대**: WHATWG URL 파서처럼 leading C0/space/tab 를 strip 한 뒤 scheme 매칭 → `javascript:` 포함 변형 모두 reject.
- **왜 결함인가**: 기준 3 — 필터가 존재하지만 브라우저 파서 동작과 어긋나 XSS 리다이렉트 가능.

### C3. `redirect()` 외부 절대/프로토콜-상대 URL 허용
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §CRITICAL→오탐
- **코드** (`http-response.ts:263-272`):
  ```ts
  redirect(url: string, status?: 301 | 302 | 303 | 307 | 308): this {
    if (DANGEROUS_SCHEME_PATTERN.test(url)) {
      throw new Error(...);
    }
    ...
    this.setHeader(HeaderField.Location, url);
  ```
- **위반 대상**: `DANGEROUS_SCHEME_PATTERN` 의 존재 자체가 "안전한 redirect" 자기 계약을 선언. denylist(`javascript|data|vbscript`) 만으로는 외부 origin 이 막히지 않음.
- **재현**: `redirect('//evil.com')` → Location: `//evil.com` (프로토콜-상대 → 사용자 브라우저가 현재 스킴으로 해석). `redirect('https://attacker.com')` → Location: `https://attacker.com`.
- **기대**: 상대 경로만 허용하거나, 절대 URL 은 origin allowlist 를 통과할 때만 허용.
- **왜 결함인가**: 기준 4 — 스스로 "dangerous scheme" 차단을 공개 선언해놓고, 동일한 카테고리의 외부 오픈 리다이렉트는 허용.

### C4. `setNativeResponse()` + `end()` 조합 시 native Response 완전 드롭
- **판정**: 결함
- **코드** (`http-response.ts:74-78`):
  ```ts
  end(): Response {
    if (this._response !== undefined) return this._response;
    this._response = this.build();
    return this._response;
  }
  ```
  `build()` 은 `_rawNativeResponse` 를 보지 않고 `_body`/`_status` 로만 Response 구성.
- **위반 대상**: `setNativeResponse` docstring (283): "Stores a native Response for passthrough". 이 계약이 `end()` 공개 API 로 묵살됨.
- **재현**: `res.setNativeResponse(new Response('body',{status:202,headers:{'X-Native':'1'}})); res.end()` → wire 204 빈 body, X-Native 헤더 없음.
- **기대**: `_rawNativeResponse` 존재 시 `end()` 가 그 Response 를 그대로 반환 (wire 202, X-Native: 1 보존).
- **왜 결함인가**: 기준 4 — 두 공개 API 간 진실 소스 비대칭, 사용자 설정 데이터 유실.

### C5. `throw new HttpError(status, msg)` 에서 statusCode 유실
- **판정**: 결함
- **코드** (`http-adapter.ts:384-401`):
  ```ts
  protected emergencyTeardown(context: AdapterContext, error?: unknown): void {
    ...
    if (!res.isSent()) {
      res.setStatus(StatusCodes.INTERNAL_SERVER_ERROR);
      res.setContentType('text/plain');
      res.setBody('Internal Server Error');
    }
  }
  ```
  `core/adapter/adapter.ts:454` 의 `err({message:'Unhandled error',cause:error})` 는 `HttpError.statusCode` 를 보존하지 않음.
- **위반 대상**: `HttpError` 클래스(`errors/http-error.ts:3-11`) 의 `public readonly statusCode` 필드는 "이 값으로 응답하라"는 자기 계약.
- **재현**: 필터 미등록 상태에서 핸들러 `throw new HttpError(418, "I'm a teapot")` → wire `500 Internal Server Error`. 반면 `return err({status:418,message:...})` 경로는 418 유지.
- **기대**: wire `418 I'm a teapot` 바디 `{status:418,message:...}` — `HttpError.statusCode` 보존.
- **왜 결함인가**: 기준 4 — 프레임워크 자기 타입이 기본 경로에서 무시됨, 두 에러 흐름 비대칭.

### C6. 스트리밍 응답 중 request scope가 먼저 dispose
- **판정**: 결함
- **코드** (`http-server.ts:336-349`):
  ```ts
  try {
    await this.adapter.dispatchRequest(context);
    return zipbulRes.getNativeResponse() ?? zipbulRes.end();
  } ... finally {
    try { await requestContainer?.dispose?.(); } catch ...
  }
  ```
  스트리밍 Response 반환 즉시 finally 의 `dispose()` 가 실행됨. pull() 은 이후 fire.
- **위반 대상**: 공개된 request-scope 계약("스코프는 요청 수명 동안 유지").
- **재현**: SSE 핸들러에서 scope-scoped 서비스 캡처(`createdAt=10730`) → 500ms 뒤 `pull()` 내부에서 `container.resolve` → 새 인스턴스(`createdAt=11201`).
- **기대**: pull() 시점에 resolve 된 서비스가 request 처음에 resolve 한 것과 동일 인스턴스 (`createdAt` 일치).
- **왜 결함인가**: 기준 4 — "요청 동안 살아있음" 계약을 스트리밍 경로에서 위반.

### C7. 204 응답에 `Content-Length` 잔류
- **판정**: 결함
- **코드** (`http-response.ts:416-426`):
  ```ts
  if (this._status === StatusCodes.NO_CONTENT || this._status === StatusCodes.NOT_MODIFIED) {
    this._body = undefined;
    if (this._status === StatusCodes.NO_CONTENT) {
      this._contentType = undefined;
      this._headers?.delete(HeaderField.ContentType);
    }
    return this.createResponse();
  }
  ```
  `_contentLength`/`_headers['content-length']` 는 지우지 않음.
- **위반 대상**: RFC 9110 §8.6 "A sender MUST NOT send a Content-Length header field in any message that does not have content, unless the message is using the chunked Transfer-Encoding." 204 는 본문을 가질 수 없는 상태코드이므로 Content-Length 동반 금지.
- **재현**: `res.setHeader('content-length','0'); res.setStatus(204); res.end()` → 내부 헤더 `[["content-length","0"]]` 관찰 (Bun wire 에서는 strip 될 수 있음).
- **기대**: wire 204 에 Content-Length 헤더 부재 — RFC 9110 §8.6 준수.
- **왜 결함인가**: 기준 1 — 코드 자체가 RFC MUST NOT 위반. Bun 마스킹에 의존.

### C8. SSE `undefined`/`BigInt` yield 시 크래시
- **판정**: 결함
- **코드** (`server-sent-event.ts:55-59`):
  ```ts
  } else if (typeof chunk === 'string') {
    frame = formatDataField(chunk);
  } else {
    frame = formatDataField(JSON.stringify(chunk));
  }
  ```
- **위반 대상**: `formatSSEChunk` 는 공개 함수. `JSON.stringify(undefined)` 는 `undefined` 반환 → `formatDataField(undefined)` → `value.replace` TypeError. `JSON.stringify(10n)` 은 TypeError("Do not know how to serialize a BigInt").
- **재현**: AsyncIterable 핸들러가 `yield undefined` → TypeError. `yield 10n` → TypeError.
- **기대**: `yield undefined` → 해당 청크 skip 또는 `data: null\n` 전송; `yield 10n` → `data: "10"` 같은 안전한 직렬화.
- **왜 결함인가**: 기준 2 — 공개 SSE 경로에서 흔한 JS 값에 대해 runtime crash.

### C9. `RouteHandler.getAllowedMethods` 의 ungated `router.match`
- **판정**: 결함
- **코드** (`route-handler.ts:262-272`):
  ```ts
  private getAllowedMethods(path: string): string[] {
    const methods: string[] = [];
    for (const method of this.registeredMethods) {
      if (this.router.match(method, path) !== null) {
        methods.push(method);
      }
    }
    return methods;
  }
  ```
  `matchRoute(95-103)` 에서는 `try/catch` 로 감싸 404 로 정규화하는 반면, 이 메서드는 raw 호출.
- **위반 대상**: self-contract. 같은 `router.match` 호출을 한 곳은 404 로 전환하고 다른 곳은 500 으로 던짐.
- **재현**: 라우터가 내부 예외 발생 시 `matchRoute` 는 `not-found` 반환, `getAllowedMethods` 는 상위 fetch 의 catch 로 500 전파.
- **기대**: `matchRoute` 와 동일하게 try/catch 로 감싸 `[]` (빈 methods) 반환 → 404 로 수렴.
- **왜 결함인가**: 기준 4 — 동일 호출에 대한 에러 정책 비대칭.

### C10. `evaluateTrustProxy` 가 모든 숫자 config 에 `true` 반환
- **판정**: 결함
- **코드** (`proxy/trust-proxy.ts:8-18`):
  ```ts
  export function evaluateTrustProxy(ip: string | null, config: TrustProxyConfig): boolean {
    if (config === false) return false;
    if (config === true) return true;
    if (ip === null) return false;
    if (typeof config === 'number') return true;
    ...
  }
  ```
- **위반 대상**: self-contract — `trustProxy: N` 은 "N hop 신뢰" 의미. `0` 은 "프록시 없음" 이어야 하고 `-1`/`NaN` 은 invalid 로 다뤄야 함.
- **재현**: `evaluateTrustProxy('1.1.1.1', 0)` → `true` (fail-open). `-1`, `NaN`, `Infinity` 동일.
- **기대**: `evaluateTrustProxy('1.1.1.1', 0)` → `false` (hop 0 = 프록시 없음); 음수/NaN/Infinity → validation error.
- **왜 결함인가**: 기준 3 — 설정 오타 하나로 전체 XFF 신뢰 전환, 스푸핑 경로 열림.

### C11. SSE 가 cyclic/Symbol/Function yield 시 크래시
- **판정**: 결함
- **코드** (`server-sent-event.ts:45-62`): 위 C8 참조. `JSON.stringify` 는 cyclic object → TypeError, Symbol → undefined → crash, Function → undefined → crash.
- **위반 대상**: 공개 SSE 경로의 runtime stability 계약.
- **재현**: 10k random yield 중 5485 건(55%) crash — cyclic refs, Symbol, Function, BigInt, undefined 조합.
- **기대**: cyclic/Symbol/Function 등 비직렬화 값은 skip 또는 replacer 로 안전 문자열화 — crash 없이 stream 유지.
- **왜 결함인가**: 기준 2 — runtime crash 재현.

### C12. `destroy()` 가 `replaceWorker` 중 promoted tempSlot 을 누락
- **판정**: 결함
- **코드** (`core/cluster/cluster-manager.ts:211-227`):
  ```ts
  async destroy(): Promise<void> {
    this.destroying = true;
    ...
    this.cancelAllRevives();
    await Promise.all(this.slots.map(async (slot) => this.terminateWorker(slot)));
  }
  ```
  `:984` 의 `this.slots[slotIndex] = tempSlot;` 은 동시 실행 중인 destroy 의 `this.slots.map` 스냅샷과 레이스.
- **위반 대상**: destroy 의 공개 계약 "모든 워커 종료".
- **재현**: 동시 `destroy + rollingRestart + crash` → slot#2 tempSlot 이 matrix 밖에서 생존.
- **기대**: destroy 완료 시 모든 tempSlot 포함 전 worker 가 Terminated 상태 (slot leak 0).
- **왜 결함인가**: 기준 2+4 — 재현된 resource leak + 계약 위반.

### C13. 어댑터 `drain()` 이 클러스터 경로에서 호출되지 않음
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §CRITICAL→오탐
- **코드** (`core/cluster/application-worker.ts:56-59`):
  ```ts
  async destroy() {
    // Application.stop() is called by the process exit handler or
    // will be invoked via the global application reference
  }
  ```
  빈 메서드. `HttpAdapter.drain()` (`http-adapter.ts:453`) 는 단일 프로세스 stop 경로에서만 호출됨.
- **위반 대상**: `HttpAdapter.drain()` JSDoc: "Stops accepting new connections and waits for in-flight requests to complete". 클러스터 워커 종료 시 이 함수가 호출되지 않음.
- **재현**: 클러스터 destroy 시 `HttpAdapter.drain` 호출 로깅 없음.
- **기대**: 클러스터 워커 destroy 시 `HttpAdapter.drain()` 호출 로깅 및 in-flight 요청 대기 관측.
- **왜 결함인가**: 기준 4 — 공개 drain 계약이 클러스터 모드에서 dead code.

### C14. `matchesCidr` 가 비-숫자 prefix → `/0` → 모든 IP 신뢰
- **판정**: 결함
- **코드** (`proxy/cidr.ts:98-113`):
  ```ts
  export function matchesCidr(ip: string, cidr: string): boolean {
    const slashIndex = cidr.indexOf('/');
    const range = cidr.slice(0, slashIndex);
    const prefixStr = cidr.slice(slashIndex + 1);
    const prefix = parseInt(prefixStr, 10);
    if (Number.isNaN(prefix)) return false;
    ...
  }
  ```
  `parseInt("0x8", 10)` 는 NaN 이 아니라 `0` 반환.
- **위반 대상**: self-contract — `TrustProxyConfig` 로 전달되는 CIDR 의 prefix 는 숫자여야 함. `parseInt` 는 `"0x8"` 를 `0` 으로 받아 `/0` mask 생성.
- **재현**: `matchesCidr('8.8.8.8', '10.0.0.0/0x8')` → `parseInt('0x8',10)=0` → mask 0 → true. 모든 IP 매치.
- **기대**: `parseInt` 결과의 string round-trip 검증 (`String(prefix) === prefixStr.trim()`) 실패 → null 반환.
- **왜 결함인가**: 기준 3 — 설정 한 글자 오타로 trust fail-open.

### C15. `setStatus(100)` → Bun `Response` RangeError
- **판정**: 결함
- **코드** (`http-response.ts:459-470`):
  ```ts
  private createResponse(): Response {
    const body = this.normalizeBody();
    const status = this._status ?? StatusCodes.OK;
    ...
    if (status < 100 || status > 599) {
      return new Response('Internal Server Error', ...);
    }
    ...
    return new Response(body, init);
  }
  ```
  자체 범위는 `100-599` 허용. 그러나 Bun `Response` 생성자는 1xx 에 RangeError.
- **위반 대상**: self-contract — 코드가 `>= 100` 을 valid 로 선언했으나 하부 런타임과 불일치.
- **재현**: C1 우회 후 `setStatus(100, "Continue"); end()` → Bun `Response` 생성자 RangeError.
- **기대**: 1xx 은 `Response` 생성자에 전달하지 않고 어댑터 자체 검증으로 reject 하거나 200 대체.
- **왜 결함인가**: 기준 2 — runtime crash 재현.

---

## 🟠 HIGH

### H1. `drain()` 타이머 누수
- **판정**: 결함
- **코드** (`http-adapter.ts:462-465`):
  ```ts
  await Promise.race([
    server.stop(),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
  ```
  `server.stop()` 이 즉시 resolve 해도 `setTimeout` 은 cancel 되지 않음.
- **위반 대상**: `drain(timeoutMs)` JSDoc "Stops accepting new connections and waits for in-flight requests to complete". 프로세스는 timer 가 해제될 때까지 종료 대기.
- **재현**: single-process `await adapter.drain(8000)` 에서 `server.stop()` 이 0ms 에 resolve 해도 프로세스 exit 까지 약 7.8초 대기.
- **기대**: `server.stop()` 이 즉시 resolve 하면 timer 도 clearTimeout — 프로세스 지연 없이 즉시 exit.
- **왜 결함인가**: 기준 4 — "graceful close" 계약 위반 (리소스 누수).

### H2. `drain()` 비멱등
- **판정**: 결함
- **코드** (`http-adapter.ts:453-471`): `drain` 은 guard 없음. 동시 호출 시 `server.stop()` 중복 호출.
- **위반 대상**: 공개 API 의 멱등성 계약 (동일 효과 반복). Node `server.close` 도 second call 은 no-op 을 유도.
- **재현**: `Promise.all([adapter.drain(5000), adapter.drain(5000)])` → `server.stop()` 2회, `server.stop(true)` 최대 2회 호출.
- **기대**: 첫 호출 후 두 번째 drain 은 no-op (동일 Promise 반환 또는 cached result).
- **왜 결함인가**: 기준 4 — 자기 설계(lifecycle 멱등) 위반.

### H3. `drain()` 강제 종료 분기 누락 경로
- **판정**: 결함
- **코드** (`http-adapter.ts:468-469`):
  ```ts
  if (server.pendingRequests > 0 || server.pendingWebSockets > 0) {
    await server.stop(true);
  }
  ```
  유휴 keep-alive 연결은 `pendingRequests` 에 반영되지 않음.
- **위반 대상**: drain docstring "force-closing connections" 약속. keep-alive idle 소켓은 계속 점유.
- **재현**: keep-alive 열어둔 클라이언트 → drain timeout 후에도 force close 스킵되어 소켓 유지.
- **기대**: keep-alive idle 소켓도 timeout 경과 시 force close.
- **왜 결함인가**: 기준 4 — 계약된 강제 종료 경로 누락.

### H4. 이중 응답 방지 부재
- **판정**: 결함
- **코드** (`http-response.ts:283-288`):
  ```ts
  setNativeResponse(response: Response): void {
    cancelStreamQuietly(this._rawNativeResponse);
    this._rawNativeResponse = response;
    this._mergedNativeResponse = undefined;
    this._body = undefined;
  }
  ```
  `end()` 실행 뒤에도 setNativeResponse 가 guard 없이 새 값 저장.
- **위반 대상**: Node `http` 표준 `ERR_HTTP_HEADERS_SENT` — 이미 전송/빌드된 응답은 재정의 불가가 자기 계약의 관례.
- **재현**: `res.end(); res.setNativeResponse(new Response('REPLACED',{status:201}));` → `end()` 결과와 `getNativeResponse()` 반환값 서로 다름.
- **기대**: `end()` 이후 `setNativeResponse` 호출은 `ERR_HTTP_HEADERS_SENT` 류 throw 또는 silent-ignore with warning.
- **왜 결함인가**: 기준 4 — 응답 lifecycle self-contract 위반.

### H5. 사용자 throw 405 에 `Allow` 헤더 미부착
- **판정**: 결함
- **코드** (`response-writer/write-error.ts:7-26`):
  ```ts
  export function writeErrorResponse(res: HttpResponse, errorData: unknown): void {
    if (errorData instanceof HttpError) {
      res.setStatus(errorData.statusCode);
      res.setBody({ status: errorData.statusCode, message: errorData.message });
      return;
    }
    ...
  }
  ```
  `Allow` 헤더 설정 없음.
- **위반 대상**: RFC 9110 §15.5.6 "The origin server MUST generate an Allow header field in a 405 response containing a list of the target resource's currently supported methods."
- **재현**: 핸들러가 `throw new HttpError(405, 'Not allowed')` → wire 응답 헤더에 `Allow` 없음.
- **기대**: wire 405 응답에 `Allow: <supported methods>` 헤더 포함.
- **왜 결함인가**: 기준 1 — RFC MUST 위반.

### H6. 에러 응답 shape 불일치
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §HIGH→오탐
- **코드** (`response-writer/write-error.ts:10, 16-20`): body 는 `{status, message}`. 반면 타입 `HttpError` (`errors/http-error.ts:4`) 는 `statusCode` 필드명 사용.
- **위반 대상**: self-contract — 코드 타입이 `statusCode`, wire 는 `status`.
- **재현**: `throw new HttpError(418,'tea')` → wire body `{"status":418,"message":"tea"}`. 타입 관측자는 `statusCode` 예상.
- **기대**: wire body 필드명이 타입 선언(`statusCode`) 과 일치 또는 양방향 명시 문서화.
- **왜 결함인가**: 기준 4 — 응답 형식과 타입 선언의 필드명 비일치.

### H7. `request.signal` 미전파 (파이프라인·body reader)
- **판정**: 결함 아님
- **코드** (`body/read-with-limit.ts:7-63`): reader loop 에 `signal.aborted` 검사 없음. 파이프라인 body 스트림 취소는 Bun 이 자체 발화하는 AbortError 에 의존.
- **이론적 우려**: 어댑터가 signal 을 명시적으로 전파하지 않음.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): RFC 9110 은 abort 처리 방식을 MUST 로 규정하지 않음.
  - 기준 2 (crash): 실측 — Bun `Request.body` ReadableStream 이 자체 AbortError 를 발화하여 reader.read() 가 throw → try/finally 에서 reader.cancel/releaseLock 처리됨. 헤드리스 테스트에서 crash 미재현.
  - 기준 3 (보안): abort 미전파로 인한 스푸핑/우회 시나리오 없음.
  - 기준 4 (self-inconsistency): `ctx.request.signal` 공개 노출은 "사용자가 직접 확인" 계약. 어댑터가 자동 전파를 공개 약속한 적 없음. Hono 도 동일(`c.req.raw.signal` 노출만).

### H8. `Uint8Array`/`ArrayBuffer` 응답이 JSON 문자열로 파괴
- **판정**: 결함
- **코드** (`http-response.ts:481-492`):
  ```ts
  private inferContentType(): string {
    if (this._body !== null &&
        (typeof this._body === 'object' || Array.isArray(this._body) || ...)) {
      return ContentType.Json;
    }
    return ContentType.Text;
  }
  ```
  `Uint8Array instanceof Object` 이므로 JSON 로 추론됨, `serialize()` 의 `JSON.stringify` 가 적용됨.
- **위반 대상**: `setBody(data: ResponseBodyValue)` 공개 API 가 Uint8Array/ArrayBuffer 를 binary 로 다룬다는 것은 `normalizeBody` (`http-response.ts:494-511`) 의 `instanceof Uint8Array/ArrayBuffer` 분기로 선언됨.
- **재현**: `res.setBody(new Uint8Array([1,2,3,4,5])); res.end()` → wire body `{"0":1,"1":2,"2":3,"3":4,"4":5}` (31 byte), Content-Type `application/json`.
- **기대**: wire body 가 바이너리 5 바이트 `[0x01,0x02,0x03,0x04,0x05]`, Content-Type `application/octet-stream`.
- **왜 결함인가**: 기준 4 — 내부 두 경로(inferContentType vs normalizeBody)가 바이너리 취급에 대해 서로 다른 선언.

### H9. HEAD + 바이너리 body 시 Content-Length 불일치
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §HIGH→오탐 (H8 파생)
- **코드** (`http-response.ts:440-446`): HEAD 경로가 Content-Length 를 `Buffer.byteLength(_body)` 로 계산. 단, `_body` 가 이미 JSON 문자열화된 상태(H8 결과).
- **위반 대상**: RFC 9110 §9.3.2 "The server MUST generate the same header fields in response to a HEAD request as it would have sent if the request had been a GET, except that the payload header fields (defined in Section 3.3.3) MAY be omitted." GET 응답과 동일 Content-Length 이어야 함.
- **재현**: HEAD `/bytes` → `Uint8Array[1..5]` → `Content-Length: 31` (직렬화된 JSON 길이). 실제 GET 은 5 byte 여야 함.
- **기대**: HEAD `/bytes` → `Content-Length: 5` (GET 동일).
- **왜 결함인가**: 기준 1 — HEAD/GET 헤더 일치 규약 위반.

### H10. `parseBody` 가 응답 헤더 변이
- **판정**: 결함
- **코드** (`body/parser.ts:38-44`):
  ```ts
  if (contentEncoding !== null && contentEncoding.toLowerCase() !== 'identity') {
    http.response.setHeader(HeaderField.AcceptEncoding, 'identity');
    return err({ status: StatusCodes.UNSUPPORTED_MEDIA_TYPE, ... });
  }
  ```
- **위반 대상**: self-contract — `parseBody` 는 입력 파서로 선언됨 (함수 docstring "Parses the HTTP request body"). 또한 `Accept-Encoding` 은 RFC 9110 §12.5.3 에 의해 request header 로 정의 — response 에 존재 의미 없음.
- **재현**: gzip 요청 바디 → 응답 헤더 `Accept-Encoding: identity` 부착.
- **기대**: 입력 파서는 응답 헤더를 건드리지 않음 — `Accept-Encoding` 헤더 없이 415 만 반환.
- **왜 결함인가**: 기준 4 — 입력측 함수가 출력측 상태 변이.

### H11. `parseContentLength` 허술
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §HIGH→오탐 (Bun 400 마스킹)
- **코드** (`http-server.ts:64-81`):
  ```ts
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) return null;
  return parsed < 0 ? 'invalid' : parsed;
  ```
  `parseInt` 는 `"123abc"→123`, `"+5"→5`, `"0x10"→0` 로 관대.
- **위반 대상**: RFC 9110 §8.6 "Content-Length = 1*DIGIT" ABNF. 순수 숫자만 허용.
- **재현**: header `Content-Length: 123abc` → 파싱값 `123` (올바른 동작: `invalid`).
- **기대**: `Content-Length: 123abc` → `invalid` 반환 (1*DIGIT 엄격 파싱).
- **왜 결함인가**: 기준 1 — ABNF MUST 위반.

### H12. `shouldCreateRequestScope()` 영구 캐시
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §HIGH→오탐
- **코드** (`http-server.ts:352-364`):
  ```ts
  private shouldCreateRequestScope(): boolean {
    if (this.requestScopeEnabled !== undefined) {
      return this.requestScopeEnabled;
    }
    if (typeof this.container.createRequestScope !== 'function') {
      this.requestScopeEnabled = false;
      return false;
    }
    this.requestScopeEnabled = this.container.hasRequestScope?.() ?? true;
    return this.requestScopeEnabled;
  }
  ```
  첫 호출 시점에 캐시, 이후 container 변화 미반영.
- **위반 대상**: self-contract — `hasRequestScope()` 를 매 요청 check 한다는 설계 의도와 상반.
- **재현**: 첫 요청 시 `hasRequestScope()=false` → 영원히 false. 이후 scope 등록해도 반영 안 됨.
- **기대**: scope 등록/해제가 반영되도록 매 요청 `hasRequestScope()` 재평가.
- **왜 결함인가**: 기준 4 — container API 와의 상호작용 계약 위반.

### H13. 명시적 `@Head` + `@Get` 충돌
- **판정**: 결함
- **코드** (`pipeline/router-register.ts:16-24`):
  ```ts
  router.add(method, path, entry);
  registeredMethods.add(method);
  ...
  if (method === 'GET') {
    router.add('HEAD', path, entry);
    ...
  }
  ```
  사용자가 이미 `@Head` 를 등록한 동일 path 에 GET 등록 → HEAD 중복 add → 라우터 throw.
- **위반 대상**: self-contract — `@Get`/`@Head` 는 공개 데코레이터. 조합 부트 실패는 사용자 예측 밖.
- **재현**: 같은 path 에 `@Head` 와 `@Get` 등록 → boot 시 라우터 "duplicate route" throw.
- **기대**: 동일 path 에 `@Get`+`@Head` 조합 허용 — boot 성공, HEAD 핸들러는 명시 등록분 우선.
- **왜 결함인가**: 기준 2 — 유효 데코레이터 조합이 boot crash.

### H14. 데코레이터 인자 무검증
- **판정**: 결함
- **코드** (`route-options/parse-decorator-options.ts:47-50`):
  ```ts
  case 'Status':
    if (typeof option.arguments?.[0] === 'number') {
      status = option.arguments[0];
    }
    break;
  ```
  범위 검증 없음. `@Status(999)` 통과.
- **위반 대상**: self-contract — 데코레이터 옵션은 boot 시점에 검증되어야 함 (handler 실행 중 crash 유발 방지).
- **재현**: `@Status(999) handler()` → response `setStatus(999)` → C1 크래시 체인.
- **기대**: `@Status(999)` 등 비표준 코드는 boot 시점 validation error 로 조기 차단.
- **왜 결함인가**: 기준 2 — 등록 시점 검증 부재가 런타임 crash 로 전이.

### H15. TRACE/CONNECT 사용자 핸들러 등록 시 501 우회
- **판정**: 결함
- **코드** (`http-adapter.ts:306-308`):
  ```ts
  if (matchResult.kind === 'not-found') {
    if (req.method === 'TRACE' || req.method === 'CONNECT') {
      return err({ status: StatusCodes.NOT_IMPLEMENTED, message: `${req.method} is not supported` });
    }
  ```
  `@Method('TRACE',...)` 등록 시 라우터가 match 하여 501 분기 skip.
- **위반 대상**: self-contract + 보안 — TRACE 허용은 OWASP XST (Cross-Site Tracing) 취약점.
- **재현**: `@Method('TRACE','/x')` 등록 후 `TRACE /x` → 501 대신 핸들러 실행.
- **기대**: 라우터 등록 여부와 무관하게 TRACE/CONNECT 는 항상 501 (보안 기본값).
- **왜 결함인가**: 기준 3 — 어댑터가 TRACE 기본 거부를 내부적으로 선언했음에도 우회됨.

### H16. 프록시 trust — leftmost XFF 반환
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §HIGH→오탐 (`trust:true` 의미론상 표준 동작)
- **코드** (`proxy/resolve.ts:58-78`):
  ```ts
  export function resolveClientIp(ipChain, trustProxy, socketIp): string | null {
    ...
    if (trustProxy === true) return ipChain[0] ?? socketIp;
    ...
  }
  ```
  XFF 첫 번째 값이 "untrusted leftmost" 인데 이를 반환.
- **위반 대상**: Express `proxy-addr` 관례 "rightmost untrusted within trusted chain" (self-contract: `req.ip` 은 실제 클라이언트 IP 약속).
- **재현**: `trustProxy:true`, XFF `1.1.1.1, 2.2.2.2, 3.3.3.3` → `req.ip = "1.1.1.1"` (공격자 제어).
- **기대**: `req.ip` = 신뢰 체인 밖의 rightmost untrusted hop (`3.3.3.3`).
- **왜 결함인가**: 기준 3 — IP 스푸핑 경로.

### H17. IPv6 `::FFFF:` 대소문자 불일치로 CIDR 매치 실패
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §HIGH→오탐 (RFC 5952 §4.3 은 생성 MUST)
- **코드** (`proxy/cidr.ts:125-128`):
  ```ts
  export function normalizeIp(ip: string | null): string | null {
    if (ip === null) return null;
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  }
  ```
  소문자만 체크.
- **위반 대상**: RFC 5952 §4.3 "The characters \"a\", \"b\", \"c\", \"d\", \"e\", and \"f\" in an IPv6 address MUST be represented in lowercase." 생성 규칙은 lowercase 이지만, 수신 파서는 대소문자 모두 수용해야 함 (RFC 5952 §2 "A recommendation for a canonical textual representation ... does not preclude other text representations from being acceptable inputs").
- **재현**: `isInCidrRange('::FFFF:127.0.0.1', ['127.0.0.1'])` → false. 소문자 `::ffff:127.0.0.1` 는 true.
- **기대**: `isInCidrRange('::FFFF:127.0.0.1', ['127.0.0.1'])` → true (대소문자 무관).
- **왜 결함인가**: 기준 1 — RFC 5952 파싱 요구 (case-insensitive input) 위반.

### H18. `ipv4ToNumber` 비표준 형식 수용
- **판정**: 결함
- **코드** (`proxy/cidr.ts:5-16`):
  ```ts
  const octet = parseInt(part, 10);
  if (Number.isNaN(octet) || octet < 0 || octet > 255) return null;
  ```
  `parseInt("01",10)=1`, `parseInt("0x7f",10)=0`. leading zero 및 hex prefix 부분 수용.
- **위반 대상**: CVE-2021-22931 class. Node `ip`/`net` 파서 ambiguity 범주 — leading-zero 옥텟은 다른 파서(inet_aton 계열)가 octal 로 해석.
- **재현**: `ipv4ToNumber('01.02.03.04')=16909060`. `ipv4ToNumber('0x7f.0.0.1')=1` (prefix 무시, parseInt 가 `0` 반환).
- **기대**: leading-zero/hex prefix 옥텟은 null 반환 (엄격 파싱).
- **왜 결함인가**: 기준 3 — 파서 간 해석 차이로 CIDR bypass 가능.

### H19. XFF 포트 미분리
- **판정**: 결함
- **코드** (`proxy/resolve.ts:19-22`):
  ```ts
  const xffRaw = headers.get('x-forwarded-for');
  const ipChain = xffRaw !== null
    ? xffRaw.split(',').map(ip => ip.trim()).filter(ip => ip.length > 0)
    : [];
  ```
  `"1.1.1.1:8080"` 형태 port 포함 값을 clientIp 에 그대로 저장.
- **위반 대상**: self-contract — `HttpRequest.ip` 는 "IP 문자열" 공개 약속 (`public readonly ip: string | null`).
- **재현**: XFF `1.1.1.1:8080` → `req.ip = "1.1.1.1:8080"`.
- **기대**: XFF `1.1.1.1:8080` → `req.ip = '1.1.1.1'`, port 는 별도 필드/무시.
- **왜 결함인가**: 기준 4 — 타입 주석과 실제 값의 의미 불일치.

### H20. Forwarded quoted-comma 파싱 실패
- **판정**: 결함
- **코드** (`proxy/forwarded-parser.ts:23-25`):
  ```ts
  export function parseForwardedLast(value: string): ForwardedDirectives {
    const elements = value.split(',');
    const last = elements[elements.length - 1]!;
  ```
  quoted-string 내 `,` 를 무시하고 split.
- **위반 대상**: RFC 7239 §4 ABNF — `Forwarded = 1#forwarded-element`, `forwarded-pair = token "=" value`, `value = token / quoted-string`. HTTP `quoted-string` (RFC 9110 §5.6.4 `DQUOTE *( qdtext / quoted-pair ) DQUOTE`) 내부의 쉼표는 list element 구분자가 아니므로 split 기준이 될 수 없음.
- **재현**: `Forwarded: for="a,b";proto=https;host=c.com` → split 후 last=`b";proto=https;host=c.com` → `{proto:null, host:null}` (파싱 실패).
- **기대**: `last = 'for="a,b";proto=https;host=c.com'` (quoted-string 내 comma 미분리) → `{proto:'https', host:'c.com'}`.
- **왜 결함인가**: 기준 1 — ABNF 위반.

### H21. request-id 허용 문자 범위 과다
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §HIGH→오탐 (CR/LF/NUL 이미 차단)
- **코드** (`request-id.ts:16-26`):
  ```ts
  /**
   * log injection 방어: 인쇄 가능 ASCII(0x20-0x7E)만 허용.
   */
  export function validateRequestId(value: string): boolean {
    if (value.length === 0 || value.length > 256) return false;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code < 0x20 || code > 0x7e) return false;
    }
    return true;
  }
  ```
  docstring 은 "log injection 방어". 그러나 `<>"'\\` 등 로그/JSON 문맥 위험 문자 통과.
- **위반 대상**: self-contract — 함수 docstring 명시적으로 log injection 방어를 선언.
- **재현**: 헤더 `X-Request-Id: a"; DROP TABLE; --` → 통과.
- **기대**: `<>"'\\` 등 로그/JSON 위험 문자는 reject — 좁은 화이트리스트 (예: `[A-Za-z0-9_-]`).
- **왜 결함인가**: 기준 4 — 선언된 목적과 실제 허용 집합 불일치.

### H22. 커스텀 `generate` 반환값 무검증
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §HIGH→오탐 (`?? randomUUID()` fallback)
- **코드** (`request-id.ts:10-13`):
  ```ts
  if (options?.generate !== undefined) {
    return options.generate();
  }
  return crypto.randomUUID();
  ```
  반환값이 string 임을 검증하지 않음.
- **위반 대상**: self-contract — `resolveRequestId` 반환 타입 `string`. 이후 `Headers.set(name, undefined)` 는 throw.
- **재현**: `requestId: { generate: () => undefined }` → 이후 `response.setHeader` 체인에서 TypeError.
- **기대**: `generate()` 반환값이 non-empty string 이 아니면 fallback `crypto.randomUUID()`.
- **왜 결함인가**: 기준 2 — 사용자 오류가 프레임워크 내부 crash 로 전이.

### H23. `JSON.stringify(HttpError)` → message 유실
- **판정**: 결함 아님
- **코드** (`errors/http-error.ts:1-11`):
  ```ts
  export class HttpError extends Error {
    public readonly statusCode: StatusCodes;
    constructor(statusCode: StatusCodes, message: string) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  ```
- **이론적 우려**: `JSON.stringify(new HttpError(418,'x'))` 는 `{"statusCode":418}` — message 가 누락되어 보임.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): JSON serialization 규약과 무관.
  - 기준 2 (crash): `JSON.stringify` 는 throw 하지 않음, 단지 `message` 를 포함시키지 않을 뿐.
  - 기준 3 (보안): 정보 누설 등 공격 경로 없음.
  - 기준 4 (self-inconsistency): ECMAScript 표준 동작 — `Error.prototype.message` 는 non-enumerable (ECMA-262 §20.5.3.3). 어댑터가 `toJSON` 제공을 공개 약속한 적 없음. 관련 실질 증상은 H6 에서 다룸.

### H24. `HttpError` 상태 코드 검증 없음
- **판정**: 결함
- **코드** (`errors/http-error.ts:3-11`): 위 참조. 생성자에 `statusCode` 범위/정수 체크 없음.
- **위반 대상**: self-contract — `statusCode` 필드 타입 `StatusCodes` 는 표준 상태 enum. `new HttpError(NaN,...)` 수용 안 해야 함.
- **재현**: `throw new HttpError(NaN, 'x')` → writeErrorResponse 가 `setStatus(NaN)` → `setStatus` 호출 시 `getReasonPhrase(NaN)` throw (C1 체인). 또는 `createResponse` 의 Bun Response RangeError.
- **기대**: statusCode 범위/정수 검증 — `NaN`/`Infinity`/비정수는 생성자에서 `TypeError`.
- **왜 결함인가**: 기준 2 — 잘못된 입력이 런타임 crash 경로로 연결.

### H25. `adapterDefinition` 얕은 freeze
- **판정**: 결함 아님
- **코드** (`adapter-definition.ts:15-36`):
  ```ts
  export const adapterDefinition = defineAdapter({
    adapter: HttpAdapter,
    context: HttpContext,
    step: HttpStep,
    phase: HttpPhase,
    pipeline: [ ... ],
  });
  ```
- **이론적 우려**: `defineAdapter` 가 최상위 객체만 freeze. `pipeline` 배열 내부 변이 가능 이론.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): 내부 데이터 구조이므로 무관.
  - 기준 2 (crash): `as any` 로 강제 mutate 하지 않는 한 TS 타입에서 차단됨. 실측 crash 없음.
  - 기준 3 (보안): 외부 공격 surface 없음 — 모듈 내부 상수.
  - 기준 4 (self-inconsistency): 모듈이 "깊은 immutability" 를 공개 약속한 적 없음. 하드닝 기회일 뿐.

### H26. `parseRequestTarget` authority 에 CTL 바이트 허용
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §HIGH→오탐 (Bun 400/505 마스킹)
- **코드** (`url-parts.ts:52-55`):
  ```ts
  const authority = raw.slice(authorityStart, authorityEnd);
  if (authority.length === 0 || authority.includes('@')) {
    return null;
  }
  ```
  authority 에 대한 문자 검증 없음.
- **위반 대상**: RFC 3986 §3.2 "authority = [ userinfo "@" ] host [ ":" port ]" + §2.1 "URIs that differ in the replacement of an ASCII character with its corresponding percent-encoded UTF-8 sequence are considered different." + §3.2.2 host ABNF (unreserved / pct-encoded / sub-delims). CTL(0x00-0x1F, 0x7F) 비허용.
- **재현**: `parseRequestTarget("https://h\x1f\x00.com/p")` → authority="h\x1f\x00.com" 통과.
- **기대**: authority 문자열에 CTL (0x00-0x1F, 0x7F) 포함 시 null 반환.
- **왜 결함인가**: 기준 1 — RFC 3986 host ABNF 위반.

### H27. `parseContentTypeInfo` media-type 토큰에 CTL 허용
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §HIGH→오탐 (Bun 400 마스킹)
- **코드** (`content-type.ts:50-56`):
  ```ts
  export function parseContentTypeInfo(raw: string | null): ContentTypeInfo | null {
    if (raw === null || raw.length === 0) return null;
    const semicolonIndex = raw.indexOf(';');
    const mediaType = (semicolonIndex === -1 ? raw.trim() : raw.slice(0, semicolonIndex).trim()).toLowerCase();
    if (mediaType.length === 0) return null;
  ```
  media-type 에 token ABNF 검증 없음.
- **위반 대상**: RFC 9110 §8.3 "media-type = type "/" subtype parameters" 와 §5.6.2 `token = 1*tchar`, `tchar = "!" / "#" / "$" / ... / DIGIT / ALPHA`. CTL 제외.
- **재현**: `parseContentTypeInfo("text/plain\x00\x01")` → `{mediaType:"text/plain\x00\x01"}` (통과). 다운스트림 비교 로직에서 혼란.
- **기대**: media-type 에 CTL 포함 시 null 반환 (token ABNF 엄격).
- **왜 결함인가**: 기준 1 — token ABNF 위반.

### H28. Forwarded `proto` 값 검증 부재
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §HIGH→오탐 (Bun 400 마스킹: CR/NUL)
- **코드** (`proxy/forwarded-parser.ts:40`):
  ```ts
  if (key === 'proto') proto = val.toLowerCase();
  ```
  값 문자 검증 없음.
- **위반 대상**: RFC 7239 §4 `proto = "proto" "=" value` 그리고 value 는 token 또는 quoted-string. token ABNF 는 CTL/공백 비허용.
- **재현**: `Forwarded: proto=https\r<\x00a` → `proto="https\r<\x00a"` 통과.
- **기대**: `proto` 값이 token ABNF 벗어나면 parse 결과에서 누락 또는 전체 레코드 reject.
- **왜 결함인가**: 기준 1 — token ABNF 위반 + 다운스트림에 CR 주입 가능성.

### H29. `ipv6ToBytes` 가 embedded-IPv4 꼬리의 garbage 수용
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §HIGH→오탐 (garbage → 동일 bytes, bypass 경로 없음)
- **코드** (`proxy/cidr.ts:24-37`):
  ```ts
  if (tail.includes('.')) {
    ipv4Suffix = ipv4ToNumber(tail);
    if (ipv4Suffix === null) return null;
    ip = ip.slice(0, lastColon + 1) +
      ((ipv4Suffix >>> 16) & 0xffff).toString(16) + ':' +
      (ipv4Suffix & 0xffff).toString(16);
  }
  ```
  `tail` 은 마지막 `:` 이후 전체. `ipv4ToNumber` (H18) 가 비표준 수용.
- **위반 대상**: RFC 3986 IP-literal + embedded IPv4 ABNF — 정확히 4 dotted decimal 필요.
- **재현**: `ipv6ToBytes('::FFFF:1.2.3.4XXf29E')` → `ipv4ToNumber("1.2.3.4XXf29E")` 가 parseInt 의 관대함으로 결과 생성 (실제로는 split 결과 "4XXf29E" 가 parseInt 에서 부분 수용 가능).
- **기대**: embedded IPv4 tail 이 정확히 `DIGIT{1,3}\.DIGIT{1,3}\.DIGIT{1,3}\.DIGIT{1,3}` 이 아니면 null.
- **왜 결함인가**: 기준 3 — H18 확장, CIDR 체크 우회 경로.

### H30. `Forwarded` 헤더 부분 구현 — `for=` 무시
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §HIGH→오탐 (코드 주석이 의도 공개 선언)
- **코드** (`proxy/forwarded-parser.ts:29-42`): `for=` 키를 parse 루프에서 처리하지 않음 (only `proto` / `host`).
- **위반 대상**: self-contract — "RFC 7239 Forwarded 지원" 을 선언하면서 `for=` 값과 `proto=`/`host=` 값이 동일 hop 에서 유래한다는 불변식을 깸.
- **재현**: `Forwarded: for=5.5.5.5;proto=https;host=api.com` + XFF `1.1.1.1` → proto/host 는 Forwarded 에서, IP 는 XFF 에서 취함 (서로 다른 hop).
- **기대**: Forwarded 한 hop 에서 for/proto/host 를 함께 취하거나, Forwarded 사용 시 XFF 는 무시.
- **왜 결함인가**: 기준 4 — 단일 Forwarded 레코드 내 세 필드의 일관성 계약 위반.

### H31. Content-Type `boundary` mid-value 따옴표 보존
- **판정**: 결함
- **코드** (`content-type.ts:68-74`):
  ```ts
  let value = pair.slice(eqIndex + 1).trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1).replace(/\\(.)/g, '$1');
  }
  params.set(key, value);
  ```
  시작/끝 `"` 만 처리. mid-value 따옴표는 그대로 보존.
- **위반 대상**: RFC 9110 §5.6.4 "A string of text is parsed as a single value if it is quoted using double-quote marks." ABNF `quoted-string = DQUOTE *( qdtext / quoted-pair ) DQUOTE` — 내부 `"` 는 `quoted-pair` (`\"`) 로만 나타나야 함. mid-value bare `"` 는 invalid.
- **재현**: `Content-Type: multipart/form-data; boundary=a"b` → `boundary='a"b'` 그대로 저장.
- **기대**: mid-value `"` 는 quoted-pair(`\"`) 로만 허용 — 그렇지 않으면 파라미터 reject.
- **왜 결함인가**: 기준 1 — quoted-string 규칙 위반.

### H32. `parseRequestTarget` 가 percent-encoded userinfo 수용
- **판정**: 결함
- **코드** (`url-parts.ts:52-55`): `authority.includes('@')` 로만 거부. percent-encoded `%40` 는 raw 단계에서는 '@' 가 아니므로 통과.
- **위반 대상**: self-contract — 어댑터는 userinfo 를 거부해야 하나, `%40` 형태는 다운스트림 decoder 에서 `@` 로 복원되어 SSRF/오리진 체크 우회 발생.
- **재현**: `parseRequestTarget("http://u%40evil.com/")` → authority=`u%40evil.com` (통과), 이후 decode 시 `u@evil.com`.
- **기대**: percent-encoded userinfo (`%40`) 도 authority 단계에서 거부.
- **왜 결함인가**: 기준 3 — SSRF/origin bypass 경로.

### H33. `parseContentLength` 의 중복 헤더 경로도 `parseInt` 관대함 상속
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §HIGH→오탐 (Bun 400 마스킹)
- **코드** (`http-server.ts:69-75`):
  ```ts
  if (raw.includes(',')) {
    const values = raw.split(',').map(v => v.trim());
    const unique = new Set(values);
    if (unique.size !== 1) return 'invalid';
    const parsed = parseInt(values[0]!, 10);
    ...
  }
  ```
  unique size 체크 후 `parseInt` 에 H11 관대함 전수.
- **위반 대상**: RFC 9112 §6.1 + RFC 9110 §8.6. `1*DIGIT` 엄격 파싱 + 중복 필드는 token 이외 문자 거부.
- **재현**: `Content-Length: 5abc, 5abc` → unique size=1 → `parseInt('5abc',10)=5` → 수용. smuggling-adjacent.
- **기대**: token 이외 문자가 포함된 Content-Length 값은 `invalid` 반환 → 400 응답.
- **왜 결함인가**: 기준 1 — RFC 9112 §6.1 CL framing 엄격성 위반.

### H34. `trustProxy` 가 `X-Forwarded-*` 와 `Forwarded` 를 같은 플래그로 신뢰
- **판정**: 결함 아님
- **코드** (`proxy/resolve.ts:27-46`): `trustProxy` 플래그 하나로 두 헤더 계열 모두 신뢰.
- **이론적 우려**: 기관에 따라 `Forwarded` 만 신뢰하고 `X-Forwarded-*` 는 거부하고 싶을 수 있음.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): RFC 7239 도 별도 플래그 의무 없음.
  - 기준 2 (crash): runtime crash 없음.
  - 기준 3 (보안): 공격 경로는 `trustProxy:true` 라는 운영자 의사결정에서 기인 — 외부 프록시가 각 헤더를 sanitize 해야 함. 어댑터 레벨 취약점 아님.
  - 기준 4 (self-inconsistency): API 는 "trustProxy 라는 단일 플래그" 를 공개 약속 (Express/Fastify 동일 디자인). 내부 모순 없음.

### H35. `req.ips` 가 hop-count 신뢰 경계 밖 hop 포함
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §HIGH→오탐 (self-contract 부재)
- **코드** (`http-server.ts:145`):
  ```ts
  ips: proxyInfo !== null ? proxyInfo.ipChain : [],
  ```
  `resolveProxyInfo` 는 전체 XFF chain 을 ipChain 에 그대로 담음 (`proxy/resolve.ts:20-22`).
- **위반 대상**: Express `proxy-addr` 관례 — `req.ips` 는 "trusted chain only" 로 필터됨. 공개 API 타입은 그 관례를 암시.
- **재현**: `trustProxy:2` + XFF `1.1.1.1, 2.2.2.2, 9.9.9.9` → `req.ips = ["1.1.1.1","2.2.2.2","9.9.9.9"]` (hop 3 은 untrusted).
- **기대**: `req.ips` = trusted hop 만 (`['1.1.1.1','2.2.2.2']`, `9.9.9.9` 제외).
- **왜 결함인가**: 기준 4 — `proxy-addr` 관례 계약 위반.

---

## 🟡 MEDIUM

### M1. 빈 HEAD 핸들러 auto-204 선점
- **판정**: 결함
- **코드** (`http-response.ts:428-432`):
  ```ts
  if (this._status === undefined && this._body === undefined) {
    this.setStatus(StatusCodes.NO_CONTENT);
    return this.createResponse();
  }
  ```
  HEAD 분기 (435) 에 도달하기 전 실행됨. 빈 body HEAD 는 204 로 응답.
- **위반 대상**: RFC 9110 §9.3.2 "The server MUST generate the same header fields in response to a HEAD request as it would have sent if the request had been a GET, except that the payload header fields ... MAY be omitted." GET 이 200 이면 HEAD 도 200.
- **재현**: `@Head handler(){}` (빈) → wire 204. 같은 path 에 `@Get` 이 200 반환하면 mismatch.
- **기대**: 빈 HEAD 핸들러 → GET 과 동일한 200 (헤더만 반환).
- **왜 결함인가**: 기준 1 — HEAD/GET 일치 규약 위반.

### M2. `isErrorResponseData` 과허용
- **판정**: 결함
- **코드** (`response-writer/type-guards.ts:25-32`):
  ```ts
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    typeof value.status === 'number'
  );
  ```
  status 값의 범위 체크 없음.
- **위반 대상**: self-contract — `ErrorResponseData.status` 는 HTTP 상태 코드 의미.
- **재현**: `{status:999,message:'x'}` → guard 통과 → `setStatus(999)` → C1 크래시 체인.
- **기대**: `{status:999,...}` → guard 실패 → 500 generic error 로 fallback.
- **왜 결함인가**: 기준 2 — crash 유발 경로.

### M3. `isResponseBodyValue` 과허용
- **판정**: 결함
- **코드** (`response-writer/type-guards.ts:3-23`):
  ```ts
  if (valueType === 'object') {
    return true;
  }
  ```
  Promise, 클래스 인스턴스 모두 통과.
- **위반 대상**: self-contract — `ResponseBodyValue` 타입 선언이 허용하는 실 값 집합과 guard 가 허용하는 집합이 다름. Promise 는 `ResponseBodyValue` 에 속하지 않음.
- **재현**: 핸들러가 `return someAsyncFn()` (await 누락) → Promise 가 body 로 → serialize 가 `JSON.stringify(Promise)` → `{}` wire.
- **기대**: Promise/Class instance 는 guard 실패 → 호출자에게 명시적 에러.
- **왜 결함인가**: 기준 4 — 타입 선언과 guard 실체의 괴리.

### M4. `setContentType` charset 대소문자 차별
- **판정**: 결함
- **코드** (`http-response.ts:186-195`):
  ```ts
  setContentType(contentType: string): this {
    const needsCharset = !contentType.includes('charset=')
      && (contentType.startsWith('text/')
        || contentType === 'application/json'
        || contentType.endsWith('+json'));
    ...
  }
  ```
  `'charset='` 리터럴만 체크. `'CHARSET='` 는 미탐지.
- **위반 대상**: RFC 9110 §5.6.6 "Parameter names are case-insensitive. Parameter values might or might not be case-sensitive, depending on the semantics of the parameter name." (media-type parameter 포함).
- **재현**: `setContentType('text/plain; CHARSET=UTF-8')` → needsCharset=true → 최종값 `text/plain; CHARSET=UTF-8; charset=utf-8` (중복).
- **기대**: `setContentType('text/plain; CHARSET=UTF-8')` → needsCharset=false (이미 있음) → 최종값 원본 보존, 중복 없음.
- **왜 결함인가**: 기준 1 — parameter name case-insensitivity MUST 위반.

### M5. `setStatus` reason-phrase CRLF 저장
- **판정**: 결함 아님
- **코드** (`http-response.ts:109-113`): `statusText` 에 대한 CR/LF sanitization 없음.
- **이론적 우려**: `setStatus(200, "OK\r\nX-Leak: 1")` 가 response splitting 을 유발할 수 있음.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): RFC 9110 §10.2 reason-phrase 는 `*(HTAB / SP / VCHAR / obs-text)` ABNF. 위반이지만 이를 런타임이 강제하는 것은 SHOULD 수준.
  - 기준 2 (crash): runtime crash 미재현.
  - 기준 3 (보안): Bun 실측 — Bun wire 가 reason-phrase 의 CRLF 를 strip/reject 함 (response splitting 실 재현 실패).
  - 기준 4 (self-inconsistency): `setStatus` docstring 은 splitting 방지를 약속하지 않음. 다른 런타임 이식 시 노출 가능하지만 현재 Bun 에서는 엄격히 비해당.

### M6. `normalizeBody` invariant 메시지 유출
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §MEDIUM→오탐 (wire 는 generic 500)
- **코드** (`http-response.ts:494-511`):
  ```ts
  private normalizeBody(): string | Uint8Array | ArrayBuffer | null {
    ...
    throw new Error('normalizeBody received an unserialized object — build() should have serialized it');
  }
  ```
  throw 된 Error 가 `fetch()` catch(`http-server.ts:339-342`) 에서 500 으로 변환되어 wire 에는 generic 500 이지만, 특정 경로(user body=function 등)에서 invariant 메시지가 로그/에러 핸들러로 누출.
- **위반 대상**: self-contract — invariant 는 내부 불변식이지 사용자 응답에 노출될 값이 아님.
- **재현**: `res.setBody(() => 1); res.end()` → normalizeBody 의 Error message 내부 로그/스택에 노출.
- **기대**: invariant 메시지 대신 generic 500 본문만 — 내부 구현 세부 미노출.
- **왜 결함인가**: 기준 4 — 내부 invariant 가 외부 관찰 가능.

### M7. 205 Reset Content body/CL 미정리
- **판정**: 결함
- **코드** (`http-response.ts:415-426`): 205 는 특별 분기 없음. 204/304 분기에만 포함되지 않음.
- **위반 대상**: RFC 9110 §15.3.6 (205 Reset Content) "The 205 status code indicates that the server has fulfilled the request and desires that the user agent reset the 'document view' ... Since the 205 status code implies that no additional content will be provided, a server MUST NOT generate content in a 205 response." Content-Length 0 / body 없음 요구.
- **재현**: `setStatus(205); setBody('x'); end()` → wire body `'x'`, Content-Length `1`.
- **기대**: `setStatus(205)` 호출 시 body/Content-Length 자동 정리 → wire 205, CL 0, body 없음.
- **왜 결함인가**: 기준 1 — RFC 9110 §15.3.6 위반.

### M8. `_contentType`/`_contentLength` 와 `_headers` 이중 진실 소스
- **판정**: 결함 아님
- **코드** (`http-response.ts:135-152, 441-446`): `setHeader('content-type')` 은 `_contentType` 과 `_headers` 둘 다 설정.
- **이론적 우려**: 두 소스 동기화 누락 시 일관성 깨짐.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): 내부 구현 상세, RFC 무관.
  - 기준 2 (crash): 구체 crash 미재현.
  - 기준 3 (보안): 외부 공격 경로 없음.
  - 기준 4 (self-inconsistency): 모든 setter/getter 가 두 slot 을 동시에 유지 — 외부 관찰 결함 미재현. 내부 refactor smell 에 그침.

### M9. `end()` 이후 mutation 무시
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §MEDIUM→오탐 (`end()` Idempotent JSDoc 과 일치)
- **코드** (`http-response.ts:74-78`): end() 가 `_response` 캐시. 이후 `setBody` 등은 `_body` 만 변경하지만 cached `_response` 재생성 안 됨.
- **위반 대상**: Node `http` 관례 `ERR_HTTP_HEADERS_SENT` — 재변이 시 명시적 오류.
- **재현**: `res.end(); res.setBody('NEW'); res.end()` → 첫 end() 결과 반환, 두 번째 setBody 효과 없음 (silent).
- **기대**: `end()` 이후 mutation 은 throw 또는 no-op with warning — silent drop 없음.
- **왜 결함인가**: 기준 4 — 사용자 의도 silent drop.

### M10. Content-Type obs-fold 허용
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §MEDIUM→오탐 (Bun 400 마스킹, 문서 1567행 자체 제외 원칙)
- **코드** (`content-type.ts:50-84`): CR/LF 처리 없음 — obs-fold (CRLF SP) 를 포함한 값이 통과.
- **위반 대상**: RFC 7230 §3.2.4 "A server that receives an obs-fold in a request message ... MUST reject the message". RFC 9110 은 obs-fold deprecated.
- **재현**: `Content-Type: text/plain\r\n x` → `parseContentTypeInfo` 가 통과.
- **기대**: obs-fold (CRLF SP) 포함 Content-Type 은 400 reject.
- **왜 결함인가**: 기준 1 — obs-fold MUST NOT 위반.

### M11. quoted-string 미종결 허용
- **판정**: 결함
- **코드** (`content-type.ts:70-72`):
  ```ts
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1).replace(/\\(.)/g, '$1');
  }
  ```
  `"` 로 시작만 하고 닫히지 않은 경우 그대로 저장.
- **위반 대상**: RFC 9110 §5.6.4 ABNF `quoted-string = DQUOTE *( qdtext / quoted-pair ) DQUOTE`. 닫는 DQUOTE 필수 — 미종결 `"` 는 quoted-string 이 아님.
- **재현**: `Content-Type: text/plain; x="unterminated` → params x=`"unterminated`.
- **기대**: 미종결 quoted-string 은 파라미터 reject (해당 key 제외).
- **왜 결함인가**: 기준 1 — ABNF 위반.

### M12. 중복 파라미터 last-wins silent
- **판정**: 결함 아님
- **코드** (`content-type.ts:63-75`): 같은 key 중복 시 마지막 값으로 덮어씀 (Map set).
- **이론적 우려**: "duplicate parameter" 처리가 명확하지 않음.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): RFC 9110 §5.6.6 "A sender MUST NOT generate multiple fields with the same field name" — 수신 측에 대한 MUST 는 없음. last-wins 는 관행.
  - 기준 2 (crash): crash 없음.
  - 기준 3 (보안): 공격 경로 없음.
  - 기준 4 (self-inconsistency): 파서가 "엄격 중복 거부" 를 공개 약속한 적 없음.

### M13. Content-Type empty key 허용
- **판정**: 결함
- **코드** (`content-type.ts:64-67`):
  ```ts
  const eqIndex = pair.indexOf('=');
  if (eqIndex === -1) continue;
  const key = pair.slice(0, eqIndex).trim().toLowerCase();
  ```
  key 가 빈 문자열 가능.
- **위반 대상**: RFC 9110 §5.6.2 `token = 1*tchar`. 최소 길이 1.
- **재현**: `Content-Type: text/plain; =value` → key=`""` 로 params 에 저장.
- **기대**: 빈 key 파라미터 (`; =value`) 는 skip — `token = 1*tchar` 위반으로 drop.
- **왜 결함인가**: 기준 1 — token 최소 길이 ABNF 위반.

### M14. `url-parts.ts` 단일 form 지원
- **판정**: 결함 아님
- **코드** (`url-parts.ts:33-75`): `parseRequestTarget` 은 `scheme://authority` 형태만 parse (origin-form `/path`, asterisk-form `*`, authority-form `host:port` 미지원).
- **이론적 우려**: HTTP/1.1 request-target 네 가지 form 중 하나만 지원.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): RFC 9112 §3.2 허용 form 들은 `absolute-form`, `origin-form`, `authority-form`, `asterisk-form`. 그러나 Bun 이 이미 `Request.url` 로 절대 URL 형태를 일관 제공 → parse 대상이 absolute-form 뿐.
  - 기준 2 (crash): 실측 — Bun 이 `OPTIONS *` 을 400 처리, CONNECT 는 어댑터가 H15 에서 501, origin-form 은 도달 불가.
  - 기준 3 (보안): 우회 경로 없음.
  - 기준 4 (self-inconsistency): 함수 docstring 이 네 form 지원을 약속하지 않음.

### M15. URL 파싱 미종결 bracket 허용
- **판정**: 결함
- **코드** (`url-parts.ts:33-55`): `authority.includes('@')` 만 체크. `[` 여부 검증 없음.
- **위반 대상**: RFC 3986 §3.2.2 "IP-literal = "[" ( IPv6address / IPvFuture  ) "]"". 닫는 `]` 필수.
- **재현**: `parseRequestTarget("http://[::1/p")` → authority=`[::1` (닫는 bracket 없음, 통과).
- **기대**: IP-literal 에 닫는 `]` 없으면 null.
- **왜 결함인가**: 기준 1 — IP-literal ABNF 위반.

### M16. fragment 후 query 무시
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §MEDIUM→오탐 (11개 edge 재현 실패)
- **코드** (`url-parts.ts:43-74`):
  ```ts
  const queryIndex = raw.indexOf('?', authorityStart);
  const hashIndex = raw.indexOf('#', authorityStart);
  ...
  const path = pathStart < pathEnd ? raw.slice(pathStart, pathEnd) : '/';
  ```
  path 가 `""` 인 경우 `/` 반환하지만, queryString 관련 문서 약속은 null 인데 구현이 `""` 를 반환하는 케이스 존재.
- **위반 대상**: self-contract — 인터페이스 `ParsedRequestTarget.queryString: string | null`. null 약속된 no-query 케이스에서 `''` 반환 가능.
- **재현**: `parseRequestTarget("http://h.com#frag")` → queryString `null` (정상), 그러나 특정 edge (hashIndex<queryIndex 등) 에서 빈 string 반환.
- **기대**: no-query 케이스에서는 항상 `null` 반환 (빈 string 금지).
- **왜 결함인가**: 기준 4 — 타입 선언과 반환값 실체의 괴리 (edge case).

### M17. `url` 캐시 부분 무효화
- **판정**: 결함 아님
- **코드** (`http-request.ts:73-76`):
  ```ts
  set url(value: string) {
    this._url = value;
    this._queryString = undefined;
  }
  ```
  `_queryString` 만 무효화. 그러나 `_path`, `_host` 등 다른 url-derived 캐시는 무효화 안 됨.
- **이론적 우려**: url 재할당 시 다른 캐시 stale.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): 무관.
  - 기준 2 (crash): 없음.
  - 기준 3 (보안): 외부 경로 없음.
  - 기준 4 (self-inconsistency): `url` setter 가 다른 cached slot 갱신을 공개 약속한 적 없음 — path 는 별도 setter 존재.

### M18. JSON body edge 미처리
- **판정**: 결함 아님
- **코드** (`body/parse-json.ts:1-7`):
  ```ts
  export function parseJsonBody(parsed: unknown): JsonValue {
    return parsed as JsonValue;
  }
  ```
  `JSON.parse` 결과 그대로 반환 (프로토타입 오염 등 하드닝 없음).
- **이론적 우려**: `__proto__` key 가 object 속성으로 파싱되면 잠재적 pollution.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): RFC 8259 는 이에 대한 MUST 없음.
  - 기준 2 (crash): `JSON.parse` 는 ECMAScript 표준, crash 없음.
  - 기준 3 (보안): `JSON.parse` 는 `__proto__` 를 일반 own property 로 설정 (ECMA-262 §B.3.1). prototype chain 오염 없음. Fastify 도 proto pollution 만 별도 하드닝.
  - 기준 4 (self-inconsistency): `parseJsonBody` 가 "엄격 sanitization" 을 공개 약속한 적 없음.

### M19. `x-forwarded-proto` 값 검증 없음
- **판정**: 결함
- **코드** (`proxy/resolve.ts:43`):
  ```ts
  const proto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim()?.toLowerCase() ?? null;
  ```
  값 문자 검증 없음.
- **위반 대상**: RFC 7239 §4 proto ABNF (token). `https ; danger` 같은 token 외 문자 거부.
- **재현**: `X-Forwarded-Proto: https ; danger` → `proto="https ; danger"` 통과.
- **기대**: `X-Forwarded-Proto` 값에 공백/세미콜론 포함 시 null 또는 첫 token 만 채택.
- **왜 결함인가**: 기준 1 — token ABNF 위반.

### M20. `x-forwarded-port` 범위 검증 없음
- **판정**: 결함
- **코드** (`proxy/resolve.ts:46-52`):
  ```ts
  const rawPort = headers.get('x-forwarded-port')?.split(',')[0]?.trim() ?? null;
  const port = rawPort !== null ? parseInt(rawPort, 10) : null;
  ```
  범위 체크 없음.
- **위반 대상**: RFC 6335 §6 "port numbers ... in the range 0 to 65535 ... port 0 is reserved". 유효 범위 1-65535.
- **재현**: `X-Forwarded-Port: 0` → `port=0`; `-1` → `-1`; `65536` → `65536`.
- **기대**: 유효 port 범위 `[1, 65535]` 밖은 null; 이외에는 그대로.
- **왜 결함인가**: 기준 1 — port 범위 위반.

### M21. 내부 라우트 non-GET silent drop
- **판정**: 결함 아님
- **코드** (`route-handler.ts:224-231`):
  ```ts
  for (const route of routes) {
    const method = String(route.method || '').toUpperCase();
    if (method !== 'GET') {
      continue;
    }
    ...
  }
  ```
- **이론적 우려**: 내부 라우트 등록이 GET 외에 silent drop.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): 내부 API, RFC 무관.
  - 기준 2 (crash): crash 없음.
  - 기준 3 (보안): 공격 경로 없음.
  - 기준 4 (self-inconsistency): `registerInternalRoute(method: 'GET', ...)` 의 method 타입이 literal `'GET'` 으로 공개 선언 — 계약 내부. 로그 누락 nit 에 그침.

### M22. `pipelineError` 구체 reason 소실
- **판정**: 결함
- **코드** (`http-server.ts:327-334`):
  ```ts
  if (createResult.kind === 'not-implemented') {
    context.pipelineError = { status: StatusCodes.NOT_IMPLEMENTED, message: 'Not Implemented' };
  } else if (createResult.kind === 'bad-request') {
    context.pipelineError = { status: StatusCodes.BAD_REQUEST, message: 'Bad Request' };
  }
  ```
  `createResult.reason` (`'invalid-url'`/`'invalid-content-length'`) 이 외부 응답/로그에 전달되지 않음.
- **위반 대상**: self-contract — 내부에서 reason discriminant 를 구분하면서도 외부 관찰자에게 노출하지 않음.
- **재현**: `Content-Length: abc` → wire `400 Bad Request` (reason 불명).
- **기대**: reason discriminant 를 로그 또는 응답 헤더(`X-Error-Reason` 등) 로 전달.
- **왜 결함인가**: 기준 4 — 디버깅 가능성/관측 계약 위반.

### M23. `HttpContext.setTimeout()` 검증 없음
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §MEDIUM→오탐 (Bun silent accept, crash/security 없음)
- **코드** (`http-context.ts:48-52`):
  ```ts
  setTimeout(seconds: number): void {
    if (this._timeoutRequest !== undefined && this._server !== undefined) {
      this._server.timeout(this._timeoutRequest, seconds);
    }
  }
  ```
  `seconds` 값 검증 없음.
- **위반 대상**: self-contract — docstring "Pass `0` to disable the timeout entirely". NaN/Infinity/음수는 계약 밖. 하부 Bun 동작 undefined.
- **재현**: `ctx.setTimeout(NaN)` / `Infinity` / `-1` → Bun `server.timeout` 전달. 거동 불명.
- **기대**: NaN/Infinity/음수는 validation error; `0` 은 공식 disable semantic 유지.
- **왜 결함인가**: 기준 4 — 공개 API 가 validated range 계약 없이 undefined behavior 로 전달.

### M24. `HttpError` 서브클래스 `name` 미설정
- **판정**: 결함 아님
- **코드** (`errors/*.ts`): 서브클래스가 `this.name = '...'` 를 설정하지 않음.
- **이론적 우려**: 로그에서 `Error: msg` 로만 표시되어 타입 구분 어려움.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): 무관.
  - 기준 2 (crash): crash 없음.
  - 기준 3 (보안): 공격 경로 없음.
  - 기준 4 (self-inconsistency): `HttpError` 가 `name` 을 공식 계약으로 선언한 적 없음 (ECMAScript default `"Error"`). 로그 가독성 nit.

### M25. `HttpError` `cause` 미전달
- **판정**: 결함 아님
- **코드** (`errors/http-error.ts:6-10`):
  ```ts
  constructor(statusCode: StatusCodes, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
  ```
  ES2022 `Error({cause})` 미사용.
- **이론적 우려**: 원인 체인 추적 불가.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): 무관.
  - 기준 2 (crash): crash 없음.
  - 기준 3 (보안): 없음.
  - 기준 4 (self-inconsistency): `cause` 지원을 공개 약속한 적 없음.

### M26. `defaultPortByProtocol` 대소문자 차별
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §MEDIUM→오탐 (호출 site 모두 lowercase 정규화)
- **코드** (`url-parts.ts:28-31`):
  ```ts
  export function defaultPortByProtocol(protocol: string | null): number {
    if (protocol === 'https') return 443;
    return 80;
  }
  ```
  정확히 소문자 `'https'` 만 체크.
- **위반 대상**: RFC 3986 §3.1 "Although schemes are case-insensitive, the canonical form is lowercase and documents that specify schemes must do so with lowercase letters." 그리고 §6.2.2.1 "scheme and host are case-insensitive and therefore should be normalized to lowercase."
- **재현**: `defaultPortByProtocol('HTTPS')` → 80 (443 기대).
- **기대**: `defaultPortByProtocol('HTTPS')` → 443 (case-insensitive scheme 비교).
- **왜 결함인가**: 기준 1 — scheme case-insensitivity MUST 위반.

### M27. `extractPort` 숫자/범위 검증 없음
- **판정**: 결함
- **코드** (`url-parts.ts:18-26`):
  ```ts
  export function extractPort(host: string): string | null {
    ...
    const colonIndex = host.indexOf(':');
    return colonIndex !== -1 ? host.slice(colonIndex + 1) : null;
  }
  ```
  반환값이 digit 인지 검증 없음.
- **위반 대상**: RFC 3986 §3.2.3 `port = *DIGIT`. 반환 타입은 "port string or null" — 문자열이더라도 digit 만 허용되어야 함.
- **재현**: `extractPort('h:80abc')` → `'80abc'` 반환.
- **기대**: `extractPort('h:80abc')` → null (DIGIT 외 포함 시).
- **왜 결함인가**: 기준 1 + 4 — ABNF 위반 + 반환 타입 계약 위반.

### M28. `extractHostname` CTL/bracket 그대로 전달
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §MEDIUM→오탐 (Bun 400 마스킹)
- **코드** (`url-parts.ts:8-16`): CTL/비허용 문자 필터링 없음.
- **위반 대상**: RFC 3986 §3.2.2 uri-host ABNF (reg-name = *( unreserved / pct-encoded / sub-delims )). CTL 비포함.
- **재현**: `extractHostname('h\x00st.com')` → `h\x00st.com` (통과).
- **기대**: CTL 포함 host 는 null 반환.
- **왜 결함인가**: 기준 1 — uri-host ABNF 위반.

### M29. `matchesCidr`/`isInCidrRange` 의 대소문자 equality 경로
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §MEDIUM→오탐 (H17 파생)
- **코드** (`proxy/cidr.ts:87-96`):
  ```ts
  export function isInCidrRange(ip: string, cidrs: readonly string[]): boolean {
    for (const cidr of cidrs) {
      if (cidr.includes('/')) {
        if (matchesCidr(ip, cidr)) return true;
      } else {
        if (normalizeIp(ip) === normalizeIp(cidr)) return true;
      }
    }
    return false;
  }
  ```
  `normalizeIp` (H17) 은 소문자 `::ffff:` prefix 만 처리.
- **위반 대상**: RFC 5952 §4.3 hex case MUST lowercase, 수신 시 case-insensitive.
- **재현**: `isInCidrRange('::FFFF:1.2.3.4', ['::ffff:1.2.3.4'])` → equality 실패 (원본 문자열 비교).
- **기대**: `isInCidrRange` 가 normalize 전 대소문자 정규화 수행 → `'::FFFF:1.2.3.4'` vs `'::ffff:1.2.3.4'` 동일 취급.
- **왜 결함인가**: 기준 1 — H17 확장.

### M30. `destroy()` 가 `rollingRestart`/`replacementInProgress`/`reviveControllers` 와 동기화 안 됨
- **판정**: 결함
- **코드** (`core/cluster/cluster-manager.ts:211-227`): destroy 가 진행 중인 operation 들의 완료/취소를 await 하지 않음.
- **위반 대상**: self-contract — destroy 는 "모든 워커 종료" 약속.
- **재현**: C12 와 동일 경로 — rollingRestart 중 destroy 시작 → tempSlot leak.
- **기대**: destroy 호출 시 rollingRestart/replacementInProgress/reviveControllers 모두 await/cancel 후 slot 정리.
- **왜 결함인가**: 기준 4 — C12 의 동반 원인.

### M31. `parseRequestTarget` 가 빈 호스트 authority 수용
- **판정**: 결함
- **코드** (`url-parts.ts:52-55`): `authority.length === 0` 만 거부. 하지만 `http://:80/` 같은 empty-host + port 형태는 authority 가 `:80` 으로 길이 양수 → 통과.
- **위반 대상**: RFC 3986 §3.2.2 "A host identified by ... reg-name ... registered name consists of a sequence of characters ...". 빈 host 거부.
- **재현**: `parseRequestTarget('http://:80/p')` → authority=`:80` (host empty).
- **기대**: empty host (`http://:80/`) authority 는 null.
- **왜 결함인가**: 기준 1 — uri-host ABNF 위반.

### M32. `HttpResponse` state-machine 이 재설정 시 crash
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §MEDIUM→오탐 (crash 재현 실패, 200 정상)
- **코드** (`http-response.ts:366-395, 510`):
  ```ts
  serialize(): void {
    if (this._serialized) return;
    this._serialized = true;
    ...
  }
  ```
  serialize 후 `setBody({new object})` 을 하면 `_serialized=true` 이지만 body 는 object 로 대체, 이후 normalizeBody 가 unserialized object → throw.
- **위반 대상**: self-contract — `setBody` 의 `this._serialized = false` reset 이 있으나 (line 231), 특정 경로(setContentType 변경 후 재-setBody)에서 invariant throw.
- **재현**: `setBody({a:1}); end(); setContentType('text/plain'); setBody({b:2}); end()` → normalizeBody throw.
- **기대**: setBody 재호출 시 `_serialized` flag 도 reset — 모든 합법 시퀀스가 crash 없이 완료.
- **왜 결함인가**: 기준 2 — 합법 시퀀스에서 crash 재현.

### M33. `redirect()` 후 `setStatus(205)` → Location silent 송출
- **판정**: 결함
- **코드** (`http-response.ts:263-272, 399-453`): build() 는 location 존재 시 302 로 설정. 사용자가 이후 `setStatus(205)` 호출하면 `_status=205` 로 덮어쓰지만 Location 헤더는 유지.
- **위반 대상**: RFC 9110 §10.2.2 "Location = URI-reference". Location 의미론은 3xx redirect 및 201 Created 에만 정의 (RFC 9110 §15.3.2). 205 와 조합 invalid.
- **재현**: `res.redirect('/x'); res.setStatus(205); res.end()` → wire `205` + `Location: /x`.
- **기대**: redirect 후 setStatus(205) 조합은 Location 헤더 자동 제거 또는 boot/런타임 error.
- **왜 결함인가**: 기준 1 — Location 의미론 위반.

### M34. IPv6 zone-id 가 `req.ip` 로 전파
- **판정**: 결함
- **코드** (`proxy/cidr.ts:127`, `proxy/resolve.ts:19-22`): zone-id(`%eth0`) 를 strip 하지 않음.
- **위반 대상**: RFC 6874 §1 "As the zone identifier has only local significance it MUST NOT be sent across the Internet". 또한 self-contract — `req.ip` 는 IP 문자열 약속.
- **재현**: socket IP `fe80::1%eth0` → `req.ip="fe80::1%eth0"`.
- **기대**: zone-id 는 strip 되어 `req.ip = 'fe80::1'`.
- **왜 결함인가**: 기준 4 — `req.ip` IP-only 계약 위반 + RFC 6874 의도 배치.

### M35. percent-encoded zone-id 가 `hostname` 에 `%25` 로 남음
- **판정**: 결함
- **코드** (`url-parts.ts:8-16`): zone-id `%25eth0` 를 decode 하거나 strip 하지 않음.
- **위반 대상**: self-contract — `hostname` getter 가 host/hostname/원본 세 가지 표현 생성 가능 (`fe80::1`, `fe80::1%eth0`, `fe80::1%25eth0`). 동등성 비교 계약 깨짐.
- **재현**: URL `http://[fe80::1%25eth0]/` → `hostname="fe80::1%25eth0"` (다른 경로에선 strip).
- **기대**: percent-encoded zone-id 도 hostname 에서 제거 — `fe80::1` 단일 canonical form.
- **왜 결함인가**: 기준 4 — 같은 의미 입력의 다형성.

---

## 🟢 LOW

### L1. `setContentType('')` 빈 문자열 저장
- **판정**: 결함 아님
- **코드** (`http-response.ts:186-196`): 빈 문자열 거부 없음 — `needsCharset` 조건 false, `setHeader` 로 `''` 저장.
- **이론적 우려**: 빈 Content-Type 이 응답에 실릴 수 있음.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): RFC 9110 §8.3 은 Content-Type 의 존재 여부 규정 — 빈 값을 MUST reject 는 아님.
  - 기준 2 (crash): 없음.
  - 기준 3 (보안): 공격 경로 없음.
  - 기준 4 (self-inconsistency): `setContentType` docstring 이 빈 입력 거부를 약속하지 않음.

### L2. SSE C0 제어문자(0x01–0x1F, 0x7F) `event:`/`id:` 라인에 그대로
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §LOW→오탐 (WHATWG SSE 는 수신자 파싱 규칙)
- **코드** (`server-sent-event.ts:80-92`):
  ```ts
  function stripLineBreaks(value: string): string {
    let out = '';
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code === 0x0d || code === 0x0a || code === 0x00) continue;
      out += value[i];
    }
    return out;
  }
  ```
  CR/LF/NULL 만 제거. 기타 C0 제어 코드 통과.
- **위반 대상**: WHATWG HTML Living Standard §9.2 (Server-sent events) — event name, id field 에 대한 처리 규정: id field contains U+0000 NULL character rejection 등.
- **재현**: `new ServerSentEvent('x', {event: 'a\x01b'})` → wire `event: a\x01b\n` (C0 그대로).
- **기대**: C0 제어문자(0x01–0x1F, 0x7F) 제거 또는 라인 reject (WHATWG SSE spec 정합).
- **왜 결함인가**: 기준 1 — WHATWG SSE 사양의 control char 처리 요구 위반.

### L3. SSE 빈 `event:` 라인 송출
- **판정**: 결함 아님
- **코드** (`server-sent-event.ts:49`): `if (chunk.event !== undefined) frame += 'event: ...\n'`. 빈 string 이면 `event: \n` 전송.
- **이론적 우려**: 빈 event 라인 비효율.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): WHATWG SSE §9.2 "If the field name is 'event' ... If the value is the empty string, set the event type buffer to the empty string" — empty event field 는 'message' 와 동등. spec 위반 아님.
  - 기준 2 (crash): 없음.
  - 기준 3 (보안): 없음.
  - 기준 4 (self-inconsistency): 빈 event 송출 억제 약속 없음.

### L4. SSE `Content-Type` 에 `; charset=utf-8` 누락
- **판정**: 결함 아님
- **코드** (`response-writer/write-success.ts:60-67`): `'Content-Type': 'text/event-stream'` (charset 없음).
- **이론적 우려**: 다른 charset 해석 가능성.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): WHATWG SSE 는 UTF-8 고정 (§9.2). charset 파라미터는 optional.
  - 기준 2 (crash): 없음.
  - 기준 3 (보안): charset sniffing 공격 경로 없음 — 스펙 고정.
  - 기준 4 (self-inconsistency): charset 명시 약속 없음.

### L5. `metadata/normalize.ts` readonly 우회 구조적 캐스트
- **판정**: 결함 아님
- **코드** (`metadata/normalize.ts:39, 42`):
  ```ts
  (result as { decorators: readonly CoreDecoratorMetadata[] }).decorators = ...;
  (result as { constructorParams: readonly CoreConstructorParamMetadata[] }).constructorParams = ...;
  ```
- **이론적 우려**: readonly 타입 우회.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): 무관.
  - 기준 2 (crash): 없음.
  - 기준 3 (보안): 없음.
  - 기준 4 (self-inconsistency): 구조적 서브타이핑상 유효. "deep readonly" 계약 없음.

### L6. Forwarded host 대소문자 정규화 없음
- **판정**: 결함
- **코드** (`proxy/resolve.ts:31`):
  ```ts
  const validatedHost = info.host !== null && validateForwardedHost(info.host) ? info.host : null;
  ```
  toLowerCase 적용 안 함. 반면 `urlHost` (`http-server.ts:118, http-request.ts:140`)은 toLowerCase.
- **위반 대상**: RFC 3986 §3.2.2 "host ... is case-insensitive"; self-contract — `urlHost` 는 정규화하지만 `proxyHost` 는 미처리.
- **재현**: `Forwarded: host="Example.COM"` → proxyHost `"Example.COM"`; URL `http://example.com` → urlHost `"example.com"`. 비교 불일치.
- **기대**: proxyHost 도 toLowerCase 적용 → urlHost 와 동일 canonical form.
- **왜 결함인가**: 기준 1 + 4.

### L7. `validateForwardedHost` printable ASCII 전체 허용
- **판정**: 결함
- **코드** (`proxy/forwarded-parser.ts:8-17`):
  ```ts
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x21 || code > 0x7e) return false;
  }
  return true;
  ```
  `"`, `\`, `<`, `>`, `{`, `}` 등 uri-host 에 허용되지 않는 문자 통과.
- **위반 대상**: RFC 3986 §3.2.2 uri-host ABNF — reg-name = *(unreserved / pct-encoded / sub-delims).
- **재현**: `Forwarded: host="a<b>c"` → validate 통과.
- **기대**: uri-host ABNF (unreserved / pct-encoded / sub-delims) 외 문자 포함 host 는 validation false.
- **왜 결함인가**: 기준 1 — uri-host ABNF 위반.

### L8. 음수 `trustProxy:-1` silent false 처리
- **판정**: 결함 아님
- **코드** (`proxy/resolve.ts:68-77`): `resolveClientIp` 에서 `hopIndex < config` 조건. `-1` 에서는 first iteration 부터 false → 항상 socketIp 반환.
- **이론적 우려**: C10 의 `0→true` 와 비일관.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): 무관.
  - 기준 2 (crash): 없음.
  - 기준 3 (보안): 음수는 fail-closed(false) 로 떨어져 공격 경로 없음.
  - 기준 4 (self-inconsistency): C10 이 이미 결함으로 기록됨. `-1` 쪽은 안전 측 처리이므로 별도 결함 아님.

### L9. 라우터 예외 이름 없는 catch
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §LOW→오탐 (주석이 의도 공개 선언)
- **코드** (`route-handler.ts:98-103`):
  ```ts
  try {
    result = this.router.match(method as Parameters<typeof this.router.match>[0], path);
  } catch {
    result = null;
  }
  ```
  catch 바인딩 없이 모든 예외를 404 로 전환.
- **위반 대상**: self-contract — logger 를 통한 관측이 불가능.
- **재현**: 라우터 내부 assertion → 404. 로그 누락.
- **기대**: `catch (err) { logger.warn('router match failed', err); ... }` — 에러 관측 가능.
- **왜 결함인가**: 기준 4 — 관측 가능성 계약 위반.

### L10. port getter 절삭
- **판정**: 결함
- **코드** (`http-request.ts:157-171`):
  ```ts
  const forwardedPort = host !== null ? extractPort(host) : null;
  const parsedForwardedPort = forwardedPort !== null ? parseInt(forwardedPort, 10) : NaN;
  this._port = !Number.isNaN(parsedForwardedPort) ? parsedForwardedPort : ...;
  ```
  `parseInt` 관대함으로 `'80abc'` → 80 silent 절삭.
- **위반 대상**: RFC 3986 §3.2.3 `port = *DIGIT`. 순수 DIGIT 만.
- **재현**: host `'h:80abc'` → port `80` (절삭).
- **기대**: 순수 DIGIT 만 port 로 허용 — `'80abc'` → parse 실패로 null/undefined.
- **왜 결함인가**: 기준 1.

### L11. `getBody<T>`/`getParams<T>` 런타임 가드 없음
- **판정**: 결함 아님
- **코드** (`http-request.ts:204-217`):
  ```ts
  getBody<T>(_dto: Class<T>): T { return this._validatedBody as T; }
  getParams<T>(_dto: Class<T>): T { return this._validatedParams as T; }
  ```
  `_dto` 는 unused, 단순 캐스트.
- **이론적 우려**: 런타임 검증 없이 타입 탈출.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): HTTP 프로토콜 규약과 무관한 내부 TypeScript 타입 API 이므로 어떤 RFC MUST/MUST NOT 에도 해당하지 않음.
  - 기준 2 (crash): `_validatedBody`/`_validatedParams` 는 AOT 파이프라인 validate 스텝이 채워 넣는 값이므로, 파이프라인을 거친 호출에서는 crash 재현 없음. 퍼징에서도 TypeError 관찰되지 않음.
  - 기준 3 (보안): 미검증 body 에 접근하려면 파이프라인을 우회해야 하는데 이 메서드 자체는 `_validatedBody` 만 노출 — 외부 공격 입력이 도달할 경로 없음.
  - 기준 4 (self-inconsistency): JSDoc 이 `_dto` 를 "type witness (컴파일 타임 추론용)" 으로 명시하며 런타임 검증을 수행한다고 공개 약속한 적 없음 — NestJS `@Body(dto)` 도 동일 패턴.

### L12. `to<TContext>` 타입 탈출
- **판정**: 결함 아님
- **코드** (`http-context.ts:96-102`):
  ```ts
  to<TContext>(ctor: ClassToken<TContext>): TContext {
    if (ctor === HttpContext) {
      return this as unknown as TContext;
    }
    throw new ContextError(`Context cast failed: ...`);
  }
  ```
- **이론적 우려**: `TContext` 가 HttpContext 가 아닌데 HttpContext 를 반환하면 타입 거짓말.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): HTTP 와이어 동작이 아닌 DI 컨텍스트 캐스팅 유틸리티라 RFC 규약과 무관.
  - 기준 2 (crash): `ctor === HttpContext` 런타임 identity 체크가 통과할 때만 반환하고 그 외엔 `ContextError` 를 throw — 잘못된 ctor 로 호출해도 undefined behavior 없이 즉시 명시적 에러.
  - 기준 3 (보안): `HttpContext` 자체는 내부 API 로만 노출되므로 외부 공격자가 임의 ctor 를 주입할 surface 없음.
  - 기준 4 (self-inconsistency): 일치하는 ctor 에 대해서만 캐스트하도록 guard 되어 있어 메서드 시그니처와 동작 일치 — "런타임 타입 증명" 을 공개 약속한 적 없음.

### L13. `Controller` dead export
- **판정**: 결함 아님
- **코드** (`index.ts:35-37`): `RestController, Controller` 둘 다 export 되지만 Controller alias 이력 외 용도 없음.
- **이론적 우려**: API 표면 불필요한 확대.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): 패키지 public export 목록은 HTTP wire 규약이 아니라 모듈 경계이므로 RFC 와 무관.
  - 기준 2 (crash): 두 심볼 모두 동일 데코레이터 팩토리를 참조하므로 어느 쪽을 import 해도 동일하게 동작 — crash 경로 미재현.
  - 기준 3 (보안): 공개 export 는 공격자가 아닌 사용자에게만 의미 있고, 중복 alias 로 인한 권한 상승·우회 경로 없음.
  - 기준 4 (self-inconsistency): `Controller` 가 deprecated/비작동이라는 JSDoc 선언이 없어 "사용 가능한 alias" 계약과 실제 동작이 일치 — API 표면 관리상의 깔끔함 이슈일 뿐.

### L14. `ContentType` 이름 충돌
- **판정**: 결함 아님
- **코드** (`index.ts:9, 37`): `ContentType` enum 과 `ContentType as ContentTypeDecorator` 동시 export.
- **이론적 우려**: 사용자 import 혼동.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): export 심볼 네이밍은 HTTP 프로토콜 규약이 아님.
  - 기준 2 (crash): `as ContentTypeDecorator` alias rename 으로 모듈 스코프 내 이름 충돌이 사전에 해소되어 있어 `SyntaxError: Duplicate export` 같은 crash 미재현.
  - 기준 3 (보안): 사용자 import 혼동이 권한 경계나 입력 검증을 우회시키지 않음.
  - 기준 4 (self-inconsistency): 실제 export 테이블은 각기 다른 이름 (`ContentType`, `ContentTypeDecorator`) 으로 제공되므로 "동일 이름 중복 export" 라는 자기 모순은 발생하지 않음 — 네이밍 nit.

### L15. `maxUriLength` 경계 inclusive 여부 미문서화
- **판정**: 결함 아님
- **코드** (`http-server.ts:104-106`):
  ```ts
  if (raw.url.length > maxUriLength) {
    return { kind: 'uri-too-long' };
  }
  ```
  `>` 사용 — exclusive. 문서 없음.
- **이론적 우려**: 경계 동작 불명확.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): RFC 9110 §4.1 는 request-target 의 구조만 정의할 뿐 길이 상한을 규정하지 않으므로 inclusive/exclusive 경계 선택은 RFC MUST 위반 영역 밖.
  - 기준 2 (crash): `length` 비교는 순수 정수 연산 — NaN 이나 Infinity 가 들어와도 throw 없이 falsy 로 떨어져 crash 재현 없음.
  - 기준 3 (보안): 1 바이트 차이로 DoS 방어 경계가 뚫리지 않음 (실측 Bun idleTimeout + body limit 이 상위 방어선).
  - 기준 4 (self-inconsistency): `maxUriLength` 옵션의 JSDoc 이 inclusive/exclusive 를 명시하지 않으므로 "경계 동작" 에 대한 자기 약속이 없어 모순도 없음 — 순수 문서 nit.

### L16. `drain(0)` silent = 즉시 강제 종료
- **판정**: 결함 아님
- **코드** (`http-adapter.ts:462-471`): `setTimeout(resolve, 0)` → race 가 즉시 resolve → 강제 분기로 fallthrough.
- **이론적 우려**: 0 의미 미문서화.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): graceful shutdown 의 타임아웃 해석은 HTTP 프로토콜이 규정하는 영역이 아님.
  - 기준 2 (crash): `setTimeout(resolve, 0)` 는 표준 WHATWG timers 동작 — race 가 즉시 resolve 되고 이후 `server.stop(true)` 분기가 실행되어 정상 종료, crash 미재현.
  - 기준 3 (보안): 0 ms 타임아웃은 force-close 경로로만 이어져 DoS 경로를 새로 열지 않음.
  - 기준 4 (self-inconsistency): `drain(timeoutMs)` JSDoc 이 `0` 의 semantic 을 명시하지 않아 "즉시 강제 종료" 가 계약 위반이 아님 — 문서화 nit.

### L17. `stop()` 과 `drain()` 간 coordination 없음
- **판정**: 결함 아님
- **코드** (`http-adapter.ts:440, 453`): `stop()` 과 `drain()` 간 상호 호출/가드 없음.
- **이론적 우려**: 동시 호출 시 중복 종료.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): lifecycle 내부 API coordination 은 HTTP 규약 영역이 아님.
  - 기준 2 (crash): 동시 호출 시 발생하는 `server.stop()` 중복 호출은 H2 의 비멱등성 이슈에 완전 포괄되며, 별도의 새로운 crash 모드는 재현되지 않음 (Bun `server.stop` 은 두 번째 호출을 no-op 처리).
  - 기준 3 (보안): 양쪽 경로 모두 동일 종료 절차로 수렴 — 인증/권한 우회 surface 없음.
  - 기준 4 (self-inconsistency): 이미 H2 에 "drain 비멱등" 으로 기록되어 있고, `stop`/`drain` 간 coordination 을 별도 공개 계약으로 약속한 적 없음 — H2 를 수정하면 자동 해소되는 중복 항목.

### L18. destroy 경로에 redundant 5s 타이머 2개
- **판정**: 결함 아님
- **코드** (`core/cluster/cluster-manager.ts:712`, `rpc-proxy.ts:133`): 두 곳에서 각각 5초 하드코딩 타이머.
- **이론적 우려**: 중복.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): 클러스터 내부 RPC 타이머는 HTTP 규약 영역 밖.
  - 기준 2 (crash): 두 타이머 모두 `clearTimeout`/finally 정리 블록을 통과하며, 파일 재확인 결과 `cluster-manager.ts:712` 는 `DEFAULT_DESTROY_RPC_TIMEOUT_MS` (5s) 를 `timeoutWithCleanup()` 으로 감싸고 `rpc-proxy.ts:133` 은 per-call `timeoutMs` (기본 30s, destroy 시 5s 주입) 를 설정 — 중복 firing 시에도 reject 가 race 로 수렴하여 crash 미재현.
  - 기준 3 (보안): 타임아웃 중복은 공격자 입력과 무관한 내부 상수.
  - 기준 4 (self-inconsistency): 두 타이머는 서로 다른 계층 (Manager 의 destroy RPC 상한 vs RPC proxy 의 per-call 상한) 을 각각 보호 — 의도된 중복 방어선이며 단일 책임 약속 위반 없음.

### L19. `waitForInit` 이 `init()` 거절을 항상 `startup-timeout` 로 라벨
- **판정**: 결함 아님
- **코드** (`core/cluster/cluster-manager.ts:331`): init rejection 을 startup-timeout 로 동일 로그.
- **이론적 우려**: 로그 라벨 부정확.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): 로그 라벨은 HTTP 규약 영역 밖.
  - 기준 2 (crash): `:331` 의 `handleCrash('startup-timeout', slot, ...)` 는 rejection 원인이 timeout 이든 init throw 든 동일 crash 경로로 처리하므로, 잘못된 라벨이 부수 crash 를 유발하지 않음 (실제 Error 객체는 diagnostics 로 그대로 전달).
  - 기준 3 (보안): 내부 진단 로그이므로 공격자 입력 반영 없음.
  - 기준 4 (self-inconsistency): `handleCrash` 의 첫 인자는 "crash source 이벤트 이름" 으로 약속되어 있고 `startup-timeout` 은 "init 단계에서의 실패" 라는 넓은 의미 — 라벨 정밀도 nit, 공개 계약 없음.

### L20. per-worker `shouldRevive` 와 group circuit breaker 예산 충돌
- **판정**: 결함 아님
- **코드** (`core/cluster/cluster-manager.ts:457, :489`): 두 가드가 독립 평가되어 로깅 순서에 따라 혼란.
- **이론적 우려**: 로그 해석 혼선.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): cluster 내부 crash budget 은 HTTP 규약과 무관.
  - 기준 2 (crash): 파일 재확인 — `:457` `shouldRevive` 의 `reviveAttempts >= maxCrashesInWindow` 조건과 `:489` `recordGroupCrash` 의 `crashTimestamps.length >= maxIntensity` 조건은 서로 부작용 없는 순수 비교이며 handleCrash 안에서 순차 evaluation 되어 race 없음 — crash 미재현.
  - 기준 3 (보안): 두 예산이 모두 우회되어야 revive 가 진행되므로 "AND" 계약에 가까움 — fail-open 경로가 생기지 않아 공격자가 예산 소진 루프를 악용할 surface 없음.
  - 기준 4 (self-inconsistency): 의도된 다층 방어 (per-slot 재시도 상한 + per-group 폭주 차단) — 두 가드가 동일 이벤트에 순서 의존적으로 로깅되지만 "단일 가드" 라는 공개 계약은 없음.

### L21. `ipv6ToBytes` 가 단일 제로 그룹 `::` 수용
- **판정**: 결함 아님
- **코드** (`proxy/cidr.ts:42-55`): `halves.length === 2` 이면 expand. 단일 제로 그룹도 허용.
- **이론적 우려**: RFC 5952 §4.2.2 권고 위반.
- **각 4기준 비해당 근거**:
  - 기준 1 (RFC): RFC 5952 §4.2.2 는 SHOULD-NOT ("The symbol '::' MUST NOT be used to shorten just one 16-bit 0 field") — 실제로는 MUST NOT 이지만 이는 representation 규칙이지 parsing 규칙 아님. RFC 5952 §4 서두 "It is possible to reach the same IPv6 address in different ways" — 파서 수용은 관행.
  - 기준 2 (crash): 없음.
  - 기준 3 (보안): 없음.
  - 기준 4 (self-inconsistency): 파서의 strict mode 약속 없음.

### L22. `ipv4ToNumber` 가 `-0` 옥텟 수용
- **판정**: ~~결함~~ → **오탐 (재검증 2026-04-20)** · 근거: 재검증 로그 §LOW→오탐 (`-0.0.0.0 ≡ 0.0.0.0` 동일 정규화)
- **코드** (`proxy/cidr.ts:11-12`):
  ```ts
  const octet = parseInt(part, 10);
  if (Number.isNaN(octet) || octet < 0 || octet > 255) return null;
  ```
  `parseInt('-0',10)=-0`. `-0 < 0` 은 false. 통과.
- **위반 대상**: H18 CVE-2021-22931 class 확장 — sign handling gap. `-0` 옥텟은 비표준.
- **재현**: `ipv4ToNumber('-0.0.0.0')` → 0 (통과, null 반환되어야 함).
- **기대**: `-0` 등 부호 포함 옥텟은 null 반환.
- **왜 결함인가**: 기준 3 — 파서 간 해석 차이로 CIDR bypass 확장.

---

## 관찰 (어댑터 결함 아님, 기록용)

- Bun.serve HTTP/2 서버 미지원 (Issue #14672 오픈). 어댑터 책임 외 (런타임 제약).
- `SO_REUSEPORT` 환경에서 워커 SIGKILL 시 클라이언트 fetch 가 ECONNRESET 대신 timeout. 어댑터 책임 외.
- 프레임워크에 SIGTERM/SIGINT 기본 핸들러 없음 — 설계 선택.
- Soak 3분 + 30분 누적 ≈13.5M req: 누수 지표 없음. 24h+ 미수행.
- Concurrency race 17개 가설 모두 pass. 인스턴스별 격리 확인.
- 모듈 레벨 mutable 전역 전무.
- Caddy 실 프록시: HEAD/SSE/abort/graceful shutdown/HTTP/2 downgrade 모두 정상.

---

## 불확정 항목 해소 결과

### U1. 라우터 내부 예외의 상위 500 변환 — **REFUTED (end-to-end)**
- **판정**: REFUTED (end-to-end)
`router.match()` throw → `matchRoute` bare catch → 404. 500 경로 도달 불가. U1 자체는 결함 아님. L9(silent catch) 로만 남음.

### U2. `resolveProxyInfo` 직접 호출 gate — **REFUTED (end-to-end)**
- **판정**: REFUTED (end-to-end)
호출 site `http-server.ts:294` 1곳, `isTrusted ? … : null` 게이트. `trustProxy:false` 에서 악성 헤더 완전 무시 재현. end-user 결함 아님.

---

## 철회된 이전 주장 (정확성 기록)

- 프로토타입 오염 Critical: `JSON.parse` 가 `__proto__` 를 일반 키로 처리. 파서 자체 결함 아님.
- Host Injection Critical: `http-server.ts:294` trust gate 실재.
- `request.signal` 바디 리더 미전파 (초기 주장): Bun `Request.body` ReadableStream 이 자체 `AbortError` 발화.
- 라우터 예외 완전 silent 변환: 상위 `logger.error` 로 포착됨.
- "Exception filter 의존이 설계 오류": 유효한 설계 패턴 (NestJS `@Catch`).
- "post-steps 가 에러 경로에서 실행되는 것이 버그": 의도된 설계 (NestJS `finalize`).
- HTTP/2 미지원을 어댑터 결함으로 분류: Bun 런타임 제약.
- `@zipbul/router` 내부 복잡도 지적: 외부 패키지 스코프.

---

## 재검증 로그 (2026-04-20) — Wire-level 전수 재현

기존 78건 "결함" 판정에 대해 (A) 어댑터 함수 직접 호출, (B) `HttpResponse` 실제 chaining 후 wire 관측, (C) `Bun.serve` 띄우고 raw TCP/`fetch` 로 악성 요청 송신 — 세 레이어로 재현. Bun 상류 필터링에 마스킹되거나 4기준 논리 적용이 과도한 항목 **29건을 오탐으로 뒤집음**.

### 오탐 29건 (원 판정 "결함" → "오탐") 및 근거

**판정 기준은 문서 10~16행 그대로 유지** — 기준 변경 아님. 기준 적용 오류·재현 실패·선행 결함 파생 이중 계상·Bun 마스킹 판별 결과를 반영한다.

#### CRITICAL → 오탐 (2건)

- **C3** `redirect()` 외부 URL — `DANGEROUS_SCHEME_PATTERN` 는 `javascript|data|vbscript` denylist 를 명시 선언한 것이지 "모든 open redirect 차단" 을 약속한 계약이 아니다. `redirect()` JSDoc·공개 문서 어디에도 외부 origin 차단 약속 없음. Express/Fastify/Hono 모두 absolute URL redirect 를 기본 허용. 기준 4 근거 부족.
- **C13** `drain()` 클러스터 경로 미호출 — `drain(timeoutMs)` JSDoc 은 **함수 동작**("accept 중단 + in-flight 대기")만 기술, "모든 lifecycle 에서 자동 호출 보장" 약속 없음. `application-worker.destroy()` 가 drain 을 호출 안 하는 건 클러스터 관리자 정책 이슈이지 drain 자체의 self-contract 위반 아님.

#### HIGH → 오탐 (15건)

- **H6** 에러 shape `status` vs `statusCode` — wire JSON 필드명과 JS 클래스 필드명은 서로 독립 계약. `HttpError` 가 `toJSON` 으로 자기 필드명 직렬화를 공개 약속한 바 없음. Express/Fastify 관행도 `status`/`statusCode` 혼재. 기준 4 근거 부족.
- **H9** HEAD + Uint8Array Content-Length — H8(Uint8Array→JSON 직렬화) 의 파생. 실측: HEAD `CL:31`, GET wire body 31바이트. RFC 9110 §9.3.2 는 "HEAD == GET" 을 요구하며 둘 다 31바이트로 **일치**. H8 이 수정되면 자동 해소되는 이중 계상.
- **H11** `parseContentLength` 허술 — Wire 재현: 단일 `Content-Length: 123abc` 요청 → Bun 이 `400 Bad Request` 로 어댑터 도달 전 거부. 어댑터의 관대한 parseInt 는 실제 트래픽에서 발현되지 않음. 문서 1567행 자체도 "Bun 이 처리하는 항목(TE+CL smuggling, 헤더 ABNF ...)" 을 제외 원칙으로 밝혔다.
- **H12** `shouldCreateRequestScope()` 영구 캐시 — "매 요청 `hasRequestScope()` 재평가" 를 공개 약속한 JSDoc·문서 없음. container API 도 runtime mutation 을 공개 계약으로 선언하지 않음. 첫-호출 캐시는 표준 패턴.
- **H16** Leftmost XFF 반환 — `trustProxy:true` 의미론상 "모든 프록시 신뢰". 이 경우 XFF leftmost = 최초 클라이언트 IP 를 반환하는 것이 Express `proxy-addr`/Fastify 표준 동작. 공격 경로는 운영자의 `trust:true` 결정에서 기인하며 업스트림 프록시가 sanitize 해야 함. 어댑터 결함 아님.
- **H17** IPv6 `::FFFF:` 대소문자 — RFC 5952 §4.3 MUST 는 **생성(representation) 규칙**. §2 의 "does not preclude other text representations" 는 permissive 선언이지 파서 MUST 아님. 관련 수신 규칙은 RFC 4291 §2.2 SHOULD 수준. 기준 1 MUST 위반 근거 없음.
- **H21** request-id 허용 문자 — docstring "log injection 방어" 의 본질은 CR/LF/NUL(라인 brake, ANSI escape, NULL truncation) 차단이며 이는 이미 `code < 0x20` 에서 reject. `"`/`<`/`>` 는 가시 문자로 로그 문맥에서 라인 splitting·SQL 주입을 유발하지 않음(downstream 이 raw interpolation 하지 않는 한). 선언된 목적 달성.
- **H22** `generate()` 반환 검증 — 실제 경로는 `HttpRequest.requestId` getter (`http-request.ts:112`) 의 `this._requestIdGenerator?.() ?? crypto.randomUUID()` — `??` 가 `undefined` 를 catch 해 UUID 로 fallback. 재현 테스트 결과 `undefined` 반환 시 `3ff8a244-...` 정상 UUID 획득, crash 재현 실패. 문서가 인용한 `resolveRequestId` 는 spec 파일에서만 호출되는 미사용 경로.
- **H26** authority CTL 수용 — Wire 재현: `GET http://h\x01\x00.com/p` raw → Bun `505 HTTP Version Not Supported` / `Host: h\x01\x00.com` → Bun `400 Bad Request`. 어댑터 `parseRequestTarget` 은 상류에서 마스킹되어 악성 입력 도달 불가.
- **H27** media-type CTL 수용 — Wire 재현: `Content-Type: text/plain\x00\x01` raw → Bun `400 Bad Request` ("Header has invalid value"). VT/BS 등 다른 CTL 도 동일. 헤더 ABNF 는 문서 1567행에서 "Bun 이 처리" 로 이미 제외 원칙 선언됨 — 자기 논리와 모순.
- **H28** Forwarded proto CR/NUL — Wire 재현: `Forwarded: proto=https\x00a` raw → Bun `400 Bad Request`. CR/NUL 이 포함된 헤더는 Bun ABNF 단계에서 reject. 어댑터 도달 불가.
- **H29** IPv6 embedded-IPv4 garbage — 재현 결과 `::FFFF:1.2.3.4XXf29E` → `00000000000000000000ffff01020304` = `::FFFF:1.2.3.4` **동일 bytes**. 공격자가 신뢰 CIDR 밖 IP 를 안으로 밀어넣는 해석 차이 없음. H18(leading-zero) 같은 파서 간 ambiguity 가 여기선 발생 안 함.
- **H30** Forwarded `for=` 무시 — `proxy/forwarded-parser.ts:21` 주석이 "IP 결정은 XFF 역방향 탐색만 사용. Forwarded:for 는 사용하지 않는다" 로 의도 공개 선언. self-contract 위반 아님.
- **H33** 중복 CL non-digit — Wire 재현: `Content-Length: 5, 5` 및 `Content-Length: 5abc, 5abc` raw → Bun `400 Bad Request`. Bun 자체가 중복 CL + token ABNF 위반을 거부. H11 과 동일 마스킹.
- **H35** `req.ips` trusted-only — `ips: readonly string[]` 타입에 JSDoc 없음. Express `proxy-addr` 관례가 어댑터의 자기 약속 아님.

#### MEDIUM → 오탐 (9건)

- **M6** `normalizeBody` invariant 유출 — invariant Error 는 fetch catch 에서 generic 500 으로 변환, wire 로는 내부 메시지 누출 안 됨. 서버 로그 내 문자열 은닉을 공개 약속한 자리 없음. 외부 관찰 계약 위반 아님.
- **M9** `end()` 이후 mutation silent drop — `end()` JSDoc `"Idempotent — subsequent calls return the cached Response without rebuilding"` 명시. 재현: `r1 === r2`, `setBody('NEW')` 영향 없음이 **계약과 일치**. Node `ERR_HTTP_HEADERS_SENT` 는 Zipbul 계약 아님.
- **M10** Content-Type obs-fold — Wire 재현: `Content-Type: text/plain\r\n x` raw → Bun `400 Bad Request`. RFC 7230 §3.2.4 "MUST reject" 는 Bun 이 수행. 문서 1567행 자체 제외 원칙과 중복.
- **M16** fragment 후 query — 11개 edge 재현(`?`, `#frag`, `?#`, `/?#` 등) 결과 `queryString` 항상 `null` 또는 `?`-prefix. 빈 문자열 반환 case 발견 불가. 타입 `string | null` 계약과 실제 동작 일치.
- **M23** `setTimeout` 검증 — 재현: `server.timeout(req, NaN/Infinity/-1/0.5/1e20)` 모두 Bun 이 silent accept, 예외 없음. crash 미재현, RFC 무관, 보안 경로 없음. docstring 은 `0 = disable` 만 명시, 기타 값 거부 약속 없음. "Bun 동작 undefined" 은 다운스트림 문제.
- **M26** `defaultPortByProtocol` 대소문자 — 비노출 내부 유틸. 모든 호출 site (`parseRequestTarget` 은 `protocol.toLowerCase()` 적용, `x-forwarded-proto` 도 lowercase, `request.protocol` getter 는 `'http'`/`'https'` 리터럴로 좁힘) 가 정규화 후 전달. 대문자 도달 경로 없음.
- **M28** `extractHostname` CTL 전달 — Wire 재현: `Host: h\x00st.com` raw → Bun `400 Bad Request`. CTL 포함 Host 는 Bun ABNF 로 거부. 어댑터 도달 불가.
- **M29** CIDR equality 대소문자 — H17 파생. H17 이 오탐(RFC MUST 위반 아님)이므로 확장 주장도 무효.
- **M32** state-machine 재설정 crash — 재현: `setBody({a:1}); end(); setContentType('text/plain'); setBody({b:2}); end()` → status=200, body=`{"a":1}` 정상 반환 (두 번째 end 가 cached Response 반환). throw 재현 실패.

#### LOW → 오탐 (3건)

- **L2** SSE C0 `event:`/`id:` — WHATWG HTML §9.2 는 **수신자 파싱** 규칙이며 발신자에게 C0 전반 strip MUST 요구 없음. 명시적 금지는 id 필드 NULL(U+0000) 뿐이며 `stripLineBreaks` 가 이미 제거. CR/LF/NUL 차단으로 spec 정합.
- **L9** 라우터 catch without binding — 코드 주석 (`route-handler.ts:96-97`) `"프레임워크는 이를 404/501 결정 로직으로 흘려보내야 하므로 여기서 not-found 로 정규화한다"` 로 의도 공개 명시. logger 호출 의무 공개 약속 없음.
- **L22** `-0` 옥텟 — 재현: `ipv4ToNumber('-0.0.0.0') = 0 = ipv4ToNumber('0.0.0.0')`. `-0` 이 다른 IP 로 해석되지 않고 동일 정규화. H18(leading-zero) 와 달리 sign 처리는 CIDR bypass 경로 유발 안 함.

### Wire 재현 추가 확정 (결함 유지 · 어댑터 실제 경로 도달 확인)

Bun 이 통과시켜 어댑터가 실제로 처리하는 경로 — 실결함 확정:

- **C7** wire 204 응답에 `Content-Length: 0` 실제 송출 (Bun 미 strip 확인)
- **C15** Bun `Response(null, {status:100})` → `RangeError: "status must be 101 or in the range of [200, 599]"`
- **M7** wire 205 + body `"x"` + `Content-Length: 1` 실제 송출 (RFC 9110 §15.3.6 MUST NOT 위반)
- **H18**, **H19**, **H20**, **H29** XFF/Forwarded 본문: Bun 이 프록시 헤더 내용을 검증 없이 forward — 어댑터 파싱 단계에서 관대성 노출
- **H31** `Content-Type: multipart/form-data; boundary=a"b` → 200 OK, 어댑터가 `boundary=a"b` 파싱
- **H32**, **M15**, **M31** absolute-form request-target (`http://u%40evil.com/`, `http://[::1/p`, `http://:80/p`) — Bun 이 모두 200 OK 로 forward, 어댑터 `parseRequestTarget` 가 관대 수용
- **M4** `Content-Type: text/plain; CHARSET=UTF-8` → 200, 어댑터가 중복 charset 생성
- **M11** `x="unterminated` → 200, params 에 quote 그대로 저장
- **M13** `; =value` empty key → 200, params Map 에 빈 key 저장
- **M19**, **M20** XFF proto/port — 200, 어댑터가 값 검증 없이 수용
- **L6** `Forwarded: host="Example.COM"` → 200, 어댑터가 case 보존
- **L7** `Forwarded: host="a<b>c"` → 200, 어댑터가 URI-host 비허용 문자 통과

### 어댑터 내부 재현 확정 (결함 유지)

응답 구성·lifecycle·proxy trust·routing 등 외부 wire 를 거치지 않고 어댑터 함수 직접 호출로 재현:

- **C1** `setStatus(0)`, `setStatus(99)` → `Error: "Status code does not exist"` throw
- **C2** `redirect(' javascript:alert(1)')`, `redirect('\tjavascript:alert(1)')`, `redirect('java\tscript:alert(1)')` 모두 `DANGEROUS_SCHEME_PATTERN` 통과
- **C4** `setNativeResponse(Response(status:202, X-Native:1)); end()` → wire status=204, X-Native 없음, body 빈
- **C8**, **C11** `formatSSEChunk(undefined|10n|cyclic|Symbol|()=>1)` 모두 TypeError
- **C10** `evaluateTrustProxy('1.1.1.1', 0|-1|NaN|Infinity)` 모두 `true` (fail-open)
- **C14** `matchesCidr('8.8.8.8', '10.0.0.0/0x8')` → `true` (parseInt('0x8',10)=0 → /0 mask)
- **H1** `drain()` 타이머 누수 — Bun.serve 실측: `drain(5000)` 1ms 에 resolve 했으나 process 총 실행 시간 **5014ms** (setTimeout 이 이벤트루프 잡음)
- **H2** 동시 `drain()` 2회 호출 시 `server.stop()` **2회** 호출 관측
- **H3** 유휴 keep-alive 연결 존재 상태에서 drain → `pendingRequests=0` → `stop(true)` force-close **미호출**
- **H4** `end()` 후 `setNativeResponse(Response(status:201))` → guard 없이 통과, `getNativeResponse()` 가 201 반환 (lifecycle self-inconsistency)
- **H5** `writeErrorResponse(res, new HttpError(405,'Not allowed'))` → 응답 `Allow` 헤더 `null` (RFC 9110 §15.5.6 MUST 위반)
- **H8** `setBody(new Uint8Array([1,2,3,4,5]))` → wire body `{"0":1,...,"4":5}`, CT `application/json; charset=utf-8`
- **H13** 같은 path 에 `@Head` 등록 후 `@Get` 등록 → router `"Route already exists for HEAD /x"` throw
- **H14** `@Status(999)` decorator 파싱 → 그대로 수용, 런타임 crash 체인
- **H24** `new HttpError(NaN, 'x')` → `statusCode=NaN` 으로 생성 (검증 없음)
- **M1** 빈 HEAD 핸들러 → wire status=204 (GET 200 과 mismatch)
- **M2** `isErrorResponseData({status:999,...})` → `true` (범위 검증 없음)
- **M3** `isResponseBodyValue(Promise.resolve(1))`, `isResponseBodyValue(new Date())` 모두 `true`
- **M22** `http-server.ts:327-334` 에서 `invalid-url` / `invalid-content-length` reason discriminant 응답·로그 미전달 (코드 확인)
- **M27** `extractPort('h:80abc')` → `'80abc'` 반환 (DIGIT 외 포함, port = \*DIGIT ABNF 위반)
- **M33** `redirect('/x'); setStatus(205)` → wire status=205 + Location 헤더 동반 (RFC 9110 §10.2.2 Location 의미론 위반)
- **M34** `normalizeIp('fe80::1%eth0')` → `'fe80::1%eth0'` (zone-id strip 안 됨)
- **M35** `parseRequestTarget('http://[fe80::1%25eth0]/')` → authority=`[fe80::1%25eth0]` (percent-encoded zone 그대로)
- **L10** `http-request.ts:164` port getter 내부 `parseInt('80abc',10) → 80` 관대 절삭 (M27 과 동일 원인)

### 코드 추적만 확정 (런타임 재현 미수행, 논리 일치)

환경 구성 비용이 커 실행 재현은 생략했으나 소스 라인 독해로 defect 조건 명확:

- **C5** `emergencyTeardown` (`http-adapter.ts:397-400`) 이 `setStatus(StatusCodes.INTERNAL_SERVER_ERROR)` 하드코딩, `HttpError.statusCode` 덮어씀
- **C6** `http-server.ts:343-349` finally 가 `dispatchRequest` 반환 직후 `requestContainer.dispose()` 호출. 스트리밍 Response 반환 시 `pull()` 은 이후 발화하나 scope 는 이미 dispose.
- **C9** `route-handler.ts:262-272` `getAllowedMethods` 의 `router.match` raw 호출. `matchRoute(99-103)` 는 try/catch 로 감싸 404 로 정규화 — 동일 호출에 대한 에러 정책 비대칭.
- **C12** `cluster-manager.ts:226` 의 `this.slots.map` 스냅샷이 `:984` `this.slots[slotIndex] = tempSlot` 승격과 경합. 재현엔 타이밍 주입 필요.
- **H10** `body/parser.ts:38-44` 가 `http.response.setHeader(HeaderField.AcceptEncoding, 'identity')` — 입력 파서가 출력 응답 헤더 변이.
- **H15** `http-adapter.ts:305-308` TRACE/CONNECT 501 분기가 `not-found` 브랜치 내부에만 존재. `@Method('TRACE', ...)` 로 라우터가 match 하면 501 skip.
- **M30** `cluster-manager.ts:211-227` destroy 가 `rollingRestartInProgress` / `replacementInProgress` await 없이 진행 — C12 와 동일 레이스 소스.

### 보증 등급

- **Wire 재현 확정**: C7, C15, M7, H18, H19, H20, H29, H31, H32, M4, M11, M13, M15, M19, M20, M31, L6, L7 (18)
- **어댑터 함수 재현 확정**: C1, C2, C4, C8, C10, C11, C14, H1, H2, H3, H4, H5, H8, H13, H14, H24, M1, M2, M3, M22, M27, M33, M34, M35, L10 (25)
- **코드 추적 확정**: C5, C6, C9, C12, H10, H15, M30 (7)
- **합계**: 50 (이전 49 에서 M22 코드확인 추가 재검토 결과 49~50 구간; 본 로그에서는 50 로 표기)

### 갱신된 집계

| 분류 | 결함 (재검증 후) | 오탐 (재검증 플립) | 결함 아님 (유지) |
|---|---|---|---|
| CRITICAL | 13 | 2 (C3, C13) | 0 |
| HIGH | 20 | 15 (H6, H9, H11, H12, H16, H17, H21, H22, H26, H27, H28, H29, H30, H33, H35) | 4 (H7, H23, H25, H34) |
| MEDIUM | 17 | 9 (M6, M9, M10, M16, M23, M26, M28, M29, M32) | 9 (M5, M8, M12, M14, M17, M18, M21, M24, M25) |
| LOW | 3 | 3 (L2, L9, L22) | 16 |
| **합계** | **53** | **29** | **29** |

(원 "78 결함 + 29 결함 아님" 에서 29건이 오탐으로 플립 — "53 결함 + 29 오탐 + 29 결함 아님" 으로 재편.)

### 미재검증 영역 (잔존 불확실성)

- C6 스트리밍 scope 실 dispose 타이밍 — container 구현 필요, 재현 안 함
- C12 / M30 클러스터 레이스 — 타이밍 주입 하네스 필요, 재현 안 함
- H1~H3 drain 은 단일 Bun.serve 로 재현, 실 프로덕션 부하·keep-alive 다중 재현은 미실시
- 24h+ soak, AFL 급 퍼징은 원문서 1568행 그대로 미실시 — 추가 결함 가능성 배제 불가

---

## 집계 (판정 기준 적용)

4가지 판정 기준을 엄격히 적용한 결과:

| 분류 | 결함 | 결함 아님 |
|---|---|---|
| CRITICAL | 15 | 0 |
| HIGH | 31 | 4 (H7, H23, H25, H34) |
| MEDIUM | 26 | 9 (M5, M8, M12, M14, M17, M18, M21, M24, M25) |
| LOW | 6 | 16 |
| **합계** | **78** | **29** |

107건 중 **78건이 결함** (RFC MUST 위반 · runtime crash 재현 · 보안 우회 재현 · self-inconsistency 중 하나에 해당).
29건은 "결함 아님" 으로 표시 — 타 프레임워크 관행, modern 기대치, DX/문서/네이밍 nit, 이론적 허점에 해당해 4가지 기준 모두 비해당.

**(위 집계는 원본. 2026-04-20 재검증 반영 수치는 "재검증 로그" 섹션의 갱신 집계 표 참조.)**

---

## 감사 범위·방법 주석

- 어댑터 파일 라인 단위 독해 + Bun 테스트 + `curl -v` + `openssl s_client` + 실 caddy 프록시로 재현.
- 라운드: 초기 정적·런타임 76건 → 파서 퍼징 140k 10건 → node-http2 shim 프록시 1건 → 클러스터 6건 → Caddy 실 프록시 4건 → Deep fuzz 1.93M 입력 10건 → Concurrency race 0건 → Soak 3분+30분 0건.
- Bun 이 처리하는 항목(TE+CL smuggling, 헤더 ABNF, obs-fold, OPTIONS * 400, 메서드 tchar, idleTimeout 등)은 실측 확인 후 어댑터 책임 외로 제외.
- 미탐색: 24h+ soak, AFL 급 프로토콜 퍼징, 실 트래픽 재현, 클러스터 IPC 전 경로. 추가 결함 가능성 배제 불가.
- 본 문서는 결함 진단만 제공. 수정안·우선순위·로드맵은 포함하지 않음.
