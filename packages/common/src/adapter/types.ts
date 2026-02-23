import type { ZipbulAdapter } from '../interfaces';

/**
 * Adapter contract data placeholder.
 * Concrete shape is TBD per spec (ContractData = unknown).
 */
export type AdapterContractData = unknown;

/** The required export name for adapter spec facade. */
export type AdapterSpecExportName = 'adapterSpec';

/** Identifier for a middleware phase, normalized to a non-empty string without ":". */
export type MiddlewarePhaseId = string;

/** Reference to the adapter class. May be abstract for type constraints. */
export type ClassRef = abstract new (...args: any[]) => ZipbulAdapter;

/** A token in the adapter pipeline. Reserved tokens: 'Guards', 'Pipes', 'Handler'. */
export type PipelineToken = MiddlewarePhaseId | 'Guards' | 'Pipes' | 'Handler';

/** Ordered sequence of pipeline tokens defining execution order. */
export type Pipeline = PipelineToken[];

/** Ordered list of middleware phase IDs. */
export type MiddlewarePhaseOrder = MiddlewarePhaseId[];

/** Set of supported middleware phases (O(1) lookup). */
export type SupportedMiddlewarePhaseSet = Record<MiddlewarePhaseId, true>;

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
  pipeline: Pipeline;
  middlewarePhaseOrder: MiddlewarePhaseOrder;
  supportedMiddlewarePhases: SupportedMiddlewarePhaseSet;
  decorators: AdapterEntryDecorators;
  dependsOn?: AdapterDependsOn;
};
