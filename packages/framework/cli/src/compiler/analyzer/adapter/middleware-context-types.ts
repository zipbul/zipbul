import type { ContextOperation } from '../parser/context-operation-extractor';

/**
 * Generic property augmentation. Every augment is a bare synchronous supply
 * function collected as a validated accessor rendering the standardized
 * generated signature `<T>(dto: Class<T>): T`.
 *
 * `path` is the chain of property names from the context binding to the
 * contributed member — protocol-agnostic. For HTTP a typical path is
 * `['request', 'getQuery']`; for other adapters it could be `['client', 'id']`.
 *
 * Translating `path[0]` into a TypeScript interface (e.g. `request` →
 * `HttpRequest`) is the caller's responsibility, driven by adapter config.
 *
 * @public
 */
export interface PropAugment {
  readonly path: readonly string[];
}

/**
 * 미들웨어 단위 type-augmentation 메타데이터 — `context.d.ts` 생성 입력.
 *
 * 단일 책임: declaration merging 을 위한 path-based 프로퍼티/메서드 augment 만 포함.
 * 런타임 producer/consumer 작업은 {@link MiddlewareProducerInfo} 가 담당.
 *
 * @public
 */
export interface MiddlewareContextAugment {
  /** 미들웨어 export 식별자 (진단·소스 주석용). */
  readonly middlewareName: string;
  /** `ctx.to(<Type>)` 의 Type — namespace → interface 매핑 키. */
  readonly contextType: string;
  /** 미들웨어 정의 파일 경로 (import 해결용). manifest 기반이면 패키지 명. */
  readonly sourceFilePath: string;
  /** 소유 패키지 명 — manifest 기반 augment 에만 존재 (진단·registry 용). */
  readonly packageName?: string;
  /** 적용되는 프로퍼티/메서드 augment. */
  readonly augments: readonly PropAugment[];
  /** named type ref / `new X(...)` augment 의 X 식별자 → 선언 파일·패키지 경로. */
  readonly classImports: ReadonlyMap<string, string>;
}

/**
 * 미들웨어 단위 producer/consumer 작업 메타데이터 — AOT 의존성 검증 입력.
 *
 * 단일 책임: `ctx.set/use/get(KEY, ...)` 형태의 컨텍스트 키 작업만 포함.
 * 타입 augmentation 은 {@link MiddlewareContextAugment} 가 담당.
 *
 * @public
 */
export interface MiddlewareProducerInfo {
  /** 미들웨어 export 식별자 — augment 와 producer 를 매칭하는 공통 키. */
  readonly middlewareName: string;
  /** 미들웨어 정의 파일 경로 (진단용). */
  readonly sourceFilePath: string;
  /** factory body 에서 추출된 ctx 작업 목록. */
  readonly contextOps: readonly ContextOperation[];
}
