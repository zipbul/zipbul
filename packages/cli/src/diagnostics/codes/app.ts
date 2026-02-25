/**
 * App diagnostic codes.
 *
 * 상수명: 위반 의미 기술 (SCREAMING_SNAKE_CASE) — 사람 친화적
 * 코드값: ZB_APP_NNN (3자리 zero-padded) — 도구 친화적
 */

/** APP-002 — createApplication 호출 수집 실패 */
export const APP_ENTRY_NOT_FOUND = 'ZB_APP_002';

/** APP-018 — 복수 createApplication 호출 감지 */
export const APP_MULTIPLE_ENTRIES = 'ZB_APP_018';
