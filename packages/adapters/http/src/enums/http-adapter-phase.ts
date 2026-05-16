/**
 * HTTP adapter pipeline phases.
 *
 * Each phase is a middleware execution point in the HTTP request lifecycle.
 *
 * Pipeline order:
 * ```
 * OnRequest → [resolveRoute] → BeforeParse → [parseBody] → BeforeValidate → [runValidations + guards]
 *   → BeforeHandle → [handler] → AfterHandle → [serialize] → BeforeResponse → [build + send] → AfterResponse
 * ```
 */
export enum HttpAdapterPhase {
  OnRequest = 'OnRequest',
  BeforeParse = 'BeforeParse',
  BeforeValidate = 'BeforeValidate',
  BeforeHandle = 'BeforeHandle',
  AfterHandle = 'AfterHandle',
  BeforeResponse = 'BeforeResponse',
  AfterResponse = 'AfterResponse',
}
