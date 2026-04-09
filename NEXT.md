# 다음 작업

## 1. Validation Wireup

`ctx.request.getBody(Dto)` / `getParams(Dto)`가 현재 placeholder (`this.body as T`).
AOT가 핸들러의 DTO 호출을 추출하고, 런타임 validation 단계에서 실제 검증 후 결과를 반환하도록 연결.

- AOT: 핸들러 body에서 `getBody(CreateUserDto)` 호출 → `CreateUserDto` 추출 → handler index에 validation 메타데이터 포함
- 런타임: adapter의 validation 스텝이 메타데이터를 읽고 deserialize 실행 → `HttpRequest` 내부 슬롯에 저장
- `getBody(Dto)`가 내부 슬롯에서 검증된 인스턴스 반환

## 2. Validated 타입 시스템 제거

`CompiledValidationEntry`, `Validated<T>` 타입이 common/core/cli에 잔존.
validation wireup 완료 후 새 모델로 교체하고 기존 타입 삭제.

관련 파일:
- `packages/common/src/types.ts` — `Validated`
- `packages/common/src/adapter/compiled-handler.ts` — `CompiledValidationEntry`
- `packages/core/src/adapter/adapter.ts` — `runValidations()`
- `packages/cli/src/compiler/analyzer/interfaces.ts` — `validations` 필드

## 3. Examples DTO 정비

`PostCommentInput`이 interface라서 `ctx.request.getBody(PostCommentInput)` 불가.
DTO는 class여야 런타임 인자로 전달 가능. examples 전체의 interface DTO → class DTO 전환.

## 4. Examples 빌드 경고 7개

`zb build` 시 "with 7 warnings" 표시되지만 경고 내용이 콘솔에 출력되지 않음.
경고 리포팅 경로 확인 및 내용 파악 필요.

## 5. Handler Context Usage 검증 (빌드 타임)

핸들러가 미등록 미들웨어 augment를 사용하면 빌드 에러 발생시키는 기능.
`handler-context-usage-extractor.ts`는 구현 완료. 매칭 로직 + 빌드 에러 발생 연결 필요.

## 6. tsconfig.json `.zipbul/` include

생성된 `context.d.ts`를 IDE가 인식하려면 사용자 프로젝트의 `tsconfig.json`에
`.zipbul/**/*.d.ts` include 필요. `zb dev` 첫 실행 시 자동 패치 또는 문서화.
