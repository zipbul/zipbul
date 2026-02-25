/**
 * Build diagnostic codes.
 *
 * 상수명: 위반 의미 기술 (SCREAMING_SNAKE_CASE) — 사람 친화적
 * 코드값: ZB_BUILD_NNN (3자리 zero-padded) — 도구 친화적
 */

/** BUILD-001 — 소스 파일 파싱 실패 */
export const BUILD_PARSE_FAILED = 'ZB_BUILD_001';

/** BUILD-002 — 빌드 최종 실패 */
export const BUILD_FAILED = 'ZB_BUILD_002';

/** BUILD-003 — 파일 레벨 순환 의존 감지 */
export const BUILD_FILE_CYCLE = 'ZB_BUILD_003';
