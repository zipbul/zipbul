# PROBLEM.md — 어댑터 미들웨어 와이어링 설계 문제

## 현재 `bridgeMiddlewares`가 하는 일

```
모듈 정의 → AOT → DI 컨테이너(HTTP_PRE_HANDLE 토큰) → RequestHandler가 컨테이너에서 꺼냄 → adapter.addMiddlewares()
```

미들웨어 정의를 **DI 컨테이너를 경유시키는 것** 자체가 잘못이다. 미들웨어는 DI provider가 아니라 **어댑터 설정**이다.

## 실사례: CORS

```typescript
defineModule({
  adapters: {
    http: {
      middlewares: {
        preHandle: [cors({ origin: '*' })],
      }
    }
  }
})
```

CORS는 결과에 따라:
- **통과** → 다음 미들웨어/핸들러 진행
- **조기 반환** → preflight OPTIONS 204
- **거부** → 403

이 실행 제어는 `Adapter.runMiddlewares()`가 이미 처리한다 — `handler()` 반환값으로 continue/abort. 이 부분은 프로토콜 무관하고 각 어댑터가 재구현할 필요 없다.

## 진짜 문제: 와이어링 경로

미들웨어가 선언에서 실행까지 가는 경로가 불필요하게 복잡하다.

**현재 (잘못된 경로):**
```
모듈 정의 → AOT → adapterConfig (미사용) + DI 토큰
                                              ↓
                                   RequestHandler.bridgeMiddlewares()
                                              ↓
                                     adapter.addMiddlewares()
```

**올바른 경로:**
```
모듈 정의 → AOT → adapterConfig → 부트 시 adapter에 직접 전달
```

`ZipbulApplication.start()`가 이미 어댑터 인스턴스와 RuntimeContext 양쪽에 접근 가능하다. 여기서 `adapter.addMiddlewares()`를 직접 호출하면:

- `bridgeMiddlewares()` 제거
- `wireAdapterMiddlewares` 함수 제거
- `middlewareWired` 플래그 제거
- DI 미들웨어 토큰(`HTTP_PRE_HANDLE` 등) 제거
- RuntimeContext에 함수 담을 필요 없음

**미들웨어 실행**은 `Adapter` 베이스 클래스에서 공통 처리 (각 어댑터가 재구현 X). **미들웨어 와이어링**은 앱 부트스트랩에서 한 번. 이게 전부다.
