/**
 * Adapter diagnostic codes (ADAPTER-R-001 ~ R-012).
 *
 * 변수명: 위반 의미 기술 / 값: spec 섹션 7 코드 문자열
 * 참조: docs/30_SPEC/adapter/adapter.spec.md
 */

/** R-001 — adapterSpec이 defineAdapter 호출로 수집되지 않음 */
export const ADAPTER_SPEC_NOT_COLLECTED = 'ZIPBUL_ADAPTER_001';

/** R-002 — AdapterRegistrationInput 필드 판정 불가 */
export const ADAPTER_INPUT_UNCOLLECTABLE = 'ZIPBUL_ADAPTER_002';

/** R-003 — classRef가 ZipbulAdapter 마운 아님 또는 abstract */
export const ADAPTER_CLASSREF_INVALID = 'ZIPBUL_ADAPTER_003';

/** R-004 — pipeline 토큰 형상 또는 예약 토큰 규칙 위반 */
export const ADAPTER_PIPELINE_TOKEN_INVALID = 'ZIPBUL_ADAPTER_004';

/** R-005 — MiddlewarePhase 정규화 규칙 위반 */
export const ADAPTER_PHASE_ID_INVALID = 'ZIPBUL_ADAPTER_005';

/** R-007 — pipeline 내 미들웨어 페이즈 중복 */
export const ADAPTER_PIPELINE_PHASE_ORDER_MISMATCH = 'ZIPBUL_ADAPTER_007';

/** R-008 — 미들웨어 배치 판정 불가 또는 미지원 phase id */
export const ADAPTER_MIDDLEWARE_PLACEMENT_INVALID = 'ZIPBUL_ADAPTER_008';

/** R-009 — exception filter chain 구성 판정 불가 또는 dedupe 발생 */
export const ADAPTER_EXCEPTION_FILTER_INVALID = 'ZIPBUL_ADAPTER_009';

/** R-010 — entry decorator 사용/수집 규칙 위반 */
export const ADAPTER_ENTRY_DECORATOR_INVALID = 'ZIPBUL_ADAPTER_010';

/** R-011 — handler를 HandlerId로 결정할 수 없음 */
export const ADAPTER_HANDLER_ID_UNRESOLVABLE = 'ZIPBUL_ADAPTER_011';

/** R-012 — middleware Error 이후 다음 단계 실행 관측 */
export const ADAPTER_MIDDLEWARE_ERROR_BYPASS = 'ZIPBUL_ADAPTER_012';
