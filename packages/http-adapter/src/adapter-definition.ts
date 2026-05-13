import { defineAdapter } from '@zipbul/common';
import { CoreStep } from '@zipbul/core';
import { HttpAdapter } from './http-adapter';
import { HttpContext } from './http-context';
import { HttpAdapterStep, HttpAdapterPhase } from './enums';

/**
 * HTTP adapter definition.
 *
 * Declarative static schema consumed by the AOT compiler.
 * Pipeline ordering determines the execution sequence for every HTTP handler.
 *
 * @public
 */
export const adapterDefinition = defineAdapter({
  adapter: HttpAdapter,
  context: HttpContext,
  step: HttpAdapterStep,
  phase: HttpAdapterPhase,
  pipeline: [
    HttpAdapterPhase.OnRequest,
    HttpAdapterStep.ResolveRoute,
    HttpAdapterPhase.BeforeParse,
    HttpAdapterStep.ParseBody,
    HttpAdapterPhase.BeforeValidate,
    CoreStep.Validation,
    CoreStep.Guard,
    HttpAdapterPhase.BeforeHandle,
    CoreStep.Handler,
    HttpAdapterStep.WriteResponse,
    HttpAdapterPhase.AfterHandle,
    HttpAdapterStep.Serialize,
    HttpAdapterPhase.BeforeResponse,
    HttpAdapterPhase.AfterResponse,
  ],
});
