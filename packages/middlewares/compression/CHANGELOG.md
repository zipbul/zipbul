# @zipbul/compression

## 0.0.1

### Patch Changes

- Throw on invalid options at boot instead of returning a Result. Invalid middleware options are a programmer error that fails identically on every boot, so the factory now throws — aligning compression with cors, cookie, and query-parser.

  BREAKING CHANGE: `compressionMiddleware(opts)` now returns `MiddlewareDefinition` directly and throws `CompressionError` (an `Error` subclass carrying a `reason: CompressionErrorReason` field) when option validation fails, instead of returning `Result<MiddlewareDefinition, CompressionErrorData>`. Call sites that unwrapped the Result (`isErr(result)` / `result.factory()`) should call the factory directly and, if desired, catch `CompressionError`.
