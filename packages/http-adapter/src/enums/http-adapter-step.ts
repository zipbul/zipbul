/**
 * HTTP adapter-specific pipeline steps.
 *
 * Protocol-specific execution points. The AOT compiler always retains
 * these (core does not manage their lifecycle).
 */
export enum HttpAdapterStep {
  /** HTTP router matching — resolves path + method to a handler. */
  ResolveRoute = 'ResolveRoute',
  /** HTTP request body parsing based on Content-Type. */
  ParseBody = 'ParseBody',
  /** Converts pipeline Result into HTTP response (success or error). */
  WriteResponse = 'WriteResponse',
  /** Serializes buffered response body (JSON.stringify + Content-Type inference). */
  Serialize = 'Serialize',
}
