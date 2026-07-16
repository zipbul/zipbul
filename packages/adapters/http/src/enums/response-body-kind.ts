/**
 * The response body's storage kind — the single source of truth for what
 * `HttpResponse` currently holds. Replaces the old boolean "is a native
 * response set" query: a boolean cannot express "a handler `Response` was
 * applied but carries no body" (`Stream` with `readable: null`), which the
 * `AfterHandle` skip contract depends on.
 */
export enum ResponseBodyKind {
  /** body 없음 — 미할당 또는 명시적 해제(`setBody(undefined)` ≡ discardBody). auto-204의 유일한 근거 */
  None = 'none',
  /** 프레임워크가 형태를 만드는 값. 명시적 null 포함 — 단 null은 serialize 대상이 아니라 "빈 body + 200" (§4 예외 목록) */
  Buffered = 'buffered',
  /** 프레임워크가 형태를 만들지 않는 body — 핸들러 Response·스트림·Blob */
  Stream = 'stream',
}
