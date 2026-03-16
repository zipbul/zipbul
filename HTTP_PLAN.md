# HTTP Adapter + Core + AOT 잔여 이슈

## E2E 미검증

| 항목 | 이유 |
|------|------|
| 클러스터 모드 (`workers: 2+`) | 실제 multi-process 환경 필요 |
| Request scope 격리 | request-scoped provider 사용 예제 없음 |
| `@Middlewares` phase-aware route-level | 예제에 사용 사례 없음 |

## 미구현

| 항목 | 상세 |
|------|------|
| 글로벌 exception filter 사용자 API | `addExceptionFilterEntries`는 내부 API. 사용자 facing `addExceptionFilters` 미구현. 모듈 레벨 `defineModule({ adapters: [...] })` 경로는 존재 |

## 알려진 제한

| 항목 | 상세 |
|------|------|
| `isMiddlewareDefinition` ≡ `isGuardDefinition` | 구조적으로 동일 (`{ handler: fn }`). 런타임 구별 불가. 컴파일러 키 매핑이 유일한 보장 |
| Bun `mock.module` 오염 | 전체 스위트 combined 실행 시 5건 fail. 파일별 격리 시 전부 pass. Bun 테스트 러너 한계 |

## 설계 결정 기록

| 결정 | 근거 |
|------|------|
| `runInInjectionContext` 유지 | 프로퍼티 이니셜라이저의 `inject()` 호출은 사용자 원본 소스에 존재하며, 소스 재작성 없이는 런타임에 실행될 수밖에 없다. 성능 영향 무시 가능 (AsyncLocalStorage O(1), <1μs) |
| scopedKeys 클래스 참조 직접 매핑 유지 | `app.get(UsersService)` 같은 사용자 API가 클래스 참조를 전달한다. 이름 문자열 폴백만 제거 |
| scopedKeys 이름 문자열 엔트리 제거 | 동명 클래스 시 last-write-wins 충돌. 클래스 참조 엔트리만으로 충분 |
| route-handler resolve 실패 시 throw | 미등록 pipeline 구성요소는 설정 오류. 조용히 탈락보다 부팅 실패가 올바름 |
| `RequestScopeContainer.set()` throw | request scope에서 루트 컨테이너 변경은 cross-request 오염. 명시적 거부 |
| route-level filter 스코프 키 문자열 생성 | AOT가 빌드 타임에 모듈 소속을 알고 있으므로 런타임 `resolveToken()` 경유 불필요 |
