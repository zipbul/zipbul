/**
 * Adapter diagnostic codes (ZB_ADAPTER_001 ~ 012).
 *
 * 상수명: 위반 의미 기술 (SCREAMING_SNAKE_CASE) — 사람 친화적
 * 코드값: ZB_ADAPTER_NNN (3자리 zero-padded) — 도구 친화적
 */

/** ADAPTER-001 — adapterSpec이 defineAdapter 호출로 수집되지 않음 */
export const ADAPTER_SPEC_NOT_COLLECTED = 'ZB_ADAPTER_001';

/** ADAPTER-002 — AdapterRegistrationInput 필드 판정 불가 */
export const ADAPTER_INPUT_UNCOLLECTABLE = 'ZB_ADAPTER_002';

/** ADAPTER-003 — classRef가 ZipbulAdapter 마운 아님 또는 abstract */
export const ADAPTER_CLASSREF_INVALID = 'ZB_ADAPTER_003';

/** ADAPTER-004 — pipeline 토큰 형상 또는 예약 토큰 규칙 위반 */
export const ADAPTER_PIPELINE_TOKEN_INVALID = 'ZB_ADAPTER_004';

/** ADAPTER-005 — MiddlewarePhase 정규화 규칙 위반 */
export const ADAPTER_PHASE_ID_INVALID = 'ZB_ADAPTER_005';

/** ADAPTER-007 — pipeline 내 미들웨어 페이즈 중복 */
export const ADAPTER_PIPELINE_PHASE_ORDER_MISMATCH = 'ZB_ADAPTER_007';

/** ADAPTER-008 — 미들웨어 배치 판정 불가 또는 미지원 phase id */
export const ADAPTER_MIDDLEWARE_PLACEMENT_INVALID = 'ZB_ADAPTER_008';

/** ADAPTER-009 — exception filter chain 구성 판정 불가 또는 dedupe 발생 */
export const ADAPTER_EXCEPTION_FILTER_INVALID = 'ZB_ADAPTER_009';

/** ADAPTER-010 — entry decorator 사용/수집 규칙 위반 */
export const ADAPTER_ENTRY_DECORATOR_INVALID = 'ZB_ADAPTER_010';

/** ADAPTER-011 — handler를 HandlerId로 결정할 수 없음 */
export const ADAPTER_HANDLER_ID_UNRESOLVABLE = 'ZB_ADAPTER_011';

/** ADAPTER-012 — middleware Error 이후 다음 단계 실행 관측 */
export const ADAPTER_MIDDLEWARE_ERROR_BYPASS = 'ZB_ADAPTER_012';
