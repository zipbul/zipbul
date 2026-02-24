import type { ZipbulAdapter } from '../interfaces';

/**
 * Adapter contract data placeholder.
 * Concrete shape is TBD per spec (ContractData = unknown).
 */
export type AdapterContractData = unknown;

/** The required export name for adapter spec facade. */
export type AdapterSpecExportName = 'adapterSpec';

/** 어댑터 정의 미들웨어 페이즈 식별자. */
export type MiddlewarePhase = string;

/** Reference to the adapter class. May be abstract for type constraints. */
export type ClassRef = abstract new (...args: any[]) => ZipbulAdapter;

/** 파이프라인 예약 토큰. 프레임워크가 소유하는 실행 단위. */
export enum ReservedPipeline {
  Guards = 'Guards',
  Pipes = 'Pipes',
  Handler = 'Handler',
}

/** 파이프라인 선언 배열. 미들웨어 페이즈와 예약 토큰의 순서 있는 시퀀스. */
export type AdapterPipelines = (MiddlewarePhase | ReservedPipeline)[];

/**
 * Adapter dependency declaration.
 * 'standalone' = no dependency on other adapters.
 * string[] = list of adapter names this adapter depends on.
 */
export type AdapterDependsOn = 'standalone' | string[];

/** Reference to a decorator function. */
export type DecoratorRef = (...args: any[]) => any;

/** Adapter-specific entry decorators provided to user code. */
export type AdapterEntryDecorators = {
  controller: DecoratorRef;
  handler: DecoratorRef[];
};

/** Input shape for defineAdapter(). AOT-collectable at build time. */
export type AdapterRegistrationInput = {
  name: string;
  classRef: ClassRef;
  pipeline: AdapterPipelines;
  decorators: AdapterEntryDecorators;
  dependsOn?: AdapterDependsOn;
};
