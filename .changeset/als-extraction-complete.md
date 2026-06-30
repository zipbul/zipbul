---
"@zipbul/request-context": minor
"@zipbul/logger": minor
---

Complete the AsyncLocalStorage extraction into `@zipbul/request-context`.

- `@zipbul/logger` now uses `@zipbul/request-context` (declared as a
  **peerDependency** so the whole tree resolves to a single ALS instance) for
  request correlation, instead of an embedded `AsyncLocalStorage`. Producers
  (request boundary) and consumers (logger) now share one store.
- Removed logger's internal `async-storage` module and its public
  `RequestContext` re-export — import `RequestContext` from
  `@zipbul/request-context` directly. The context reader is `get()` (logger's
  removed copy called it `getContext()`).
- `RequestContext` is now a plain object instead of a static-only class
  (no never-instantiated constructor); the public methods `run`, `get`,
  `getRequestId` are unchanged.
