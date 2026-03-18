---
"@zipbul/core": patch
---

Fix 9 cluster manager bugs, eliminate ENV dependency, add circuit breaker recovery

**Bug Fixes:**
- BUG-1,2,3: Fix native Worker thread leaks in terminateWorker, handleCrash, cancelAllRevives
- BUG-4: Fix completely broken memory monitoring (config init, slot limits, division-by-zero)
- BUG-5: Fix Crashed state stuck during destroy when circuit breaker is tripped
- BUG-6: Fix rollingRestart ignoring circuit breaker trip (recordGroupCrash return value)
- BUG-7: Remove dead code in replaceWorker (detached slot field writes)
- BUG-8: Fix timeout timer leaks in Promise.race (timeoutWithCleanup pattern)

**Architecture:**
- Remove all ENV dependency (ZIPBUL_WORKER_ID, ZIPBUL_ADAPTER_FILTER)
  - Worker ID and adapter filter now passed via init RPC + RuntimeContext
  - Application.start() reads getRuntimeContext() instead of Bun.env
- Add circuit breaker recovery timer (DESIGN-1): auto-reset + worker restart after crash window
- Add memory threshold validation in constructor (DESIGN-3)
- Add init()/bootstrap() lifecycle guards against double-call
- Default smol to false (BUN-OPT-5): opt-in only for memory-constrained environments

**Dead Code Removal:**
- Remove ipc.ts/ipc.spec.ts (superseded by rpc-proxy + rpc-expose)
- Remove pendingReplacement field (never assigned)
- Remove ClusterWorker interface (unused)

**Build:**
- Fix AOT build: replace deep import with public @zipbul/core/worker export
- Add conditional export (bun/default) for workspace and npm publish compatibility
- Fix 5 tsc errors (exactOptionalPropertyTypes compliance)
