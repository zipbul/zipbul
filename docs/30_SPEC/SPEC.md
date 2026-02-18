# SPEC (Index)

> 본 문서는 L3 SPEC이며, 특정 기능에 대한 구현 계약(Implementation Contract)만을 정의한다.
> L1 불변식 및 L2 아키텍처 경계를 전제로 하며, 충돌 시 상위 문서가 우선한다.

본 문서는 Zipbul의 L3 SPEC 문서군을 탐색하기 위한 인덱스다.

## 작성 규칙

모든 `*.spec.md` 파일은 [TEMPLATE.md](TEMPLATE.md)의 구조를 준수해야 한다.
템플릿을 따르지 않는 변경은 허용되지 않는다.

## Contract Specs

- Adapter
  - [adapter/adapter.spec.md](adapter/adapter.spec.md)
  - [adapter/registration.spec.md](adapter/registration.spec.md)
  - [adapter/entry-decorators.spec.md](adapter/entry-decorators.spec.md)
  - [adapter/middleware-phase.spec.md](adapter/middleware-phase.spec.md)
  - [adapter/pipeline-shape.spec.md](adapter/pipeline-shape.spec.md)
- App
  - [app/app.spec.md](app/app.spec.md)
- CLI
  - [cli/diagnostics.spec.md](cli/diagnostics.spec.md)
  - [cli/handler-id.spec.md](cli/handler-id.spec.md)
- Common
  - [common/common.spec.md](common/common.spec.md)
  - [common/diagnostics.spec.md](common/diagnostics.spec.md)
  - [common/declarations.spec.md](common/declarations.spec.md)
  - [common/identity.spec.md](common/identity.spec.md)
  - [common/references.spec.md](common/references.spec.md)
  - [common/result.spec.md](common/result.spec.md)
- Compiler
  - [compiler/aot-ast.spec.md](compiler/aot-ast.spec.md)
  - [compiler/config.spec.md](compiler/config.spec.md)
  - [compiler/manifest.spec.md](compiler/manifest.spec.md)
- Data
  - [data/dto.spec.md](data/dto.spec.md)
  - [data/dto-schema.spec.md](data/dto-schema.spec.md)
  - [data/dto-transform.spec.md](data/dto-transform.spec.md)
  - [data/dto-validate.spec.md](data/dto-validate.spec.md)
- DI
  - [di/di.spec.md](di/di.spec.md)
  - [di/wiring.spec.md](di/wiring.spec.md)
- Error Handling
  - [error-handling/error-handling.spec.md](error-handling/error-handling.spec.md)
  - [error-handling/exception-filter-chain.spec.md](error-handling/exception-filter-chain.spec.md)
- Execution
  - [execution/execution.spec.md](execution/execution.spec.md)
  - [execution/metadata-volatility.spec.md](execution/metadata-volatility.spec.md)
  - [execution/normal-flow.spec.md](execution/normal-flow.spec.md)
- Module System
  - [module-system/module-system.spec.md](module-system/module-system.spec.md)
  - [module-system/define-module.spec.md](module-system/define-module.spec.md)
  - [module-system/boundary.spec.md](module-system/boundary.spec.md)
  - [module-system/adapter-config.spec.md](module-system/adapter-config.spec.md)
  - [module-system/manifest.spec.md](module-system/manifest.spec.md)
- Pipeline
  - [pipeline/middleware.spec.md](pipeline/middleware.spec.md)
  - [pipeline/guards.spec.md](pipeline/guards.spec.md)
  - [pipeline/pipes.spec.md](pipeline/pipes.spec.md)
  - [pipeline/exception-filters.spec.md](pipeline/exception-filters.spec.md)
- Provider
  - [provider/provider.spec.md](provider/provider.spec.md)
  - [provider/lifecycle.spec.md](provider/lifecycle.spec.md)
  - [provider/scope.spec.md](provider/scope.spec.md)
