import { defineAdapter } from '@zipbul/common';
import { CoreStep } from '@zipbul/core';
import { HttpAdapter } from './http-adapter';
import { HttpContext } from './http-context';
import { HttpStep, HttpPhase } from './enums';

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
  step: HttpStep,
  phase: HttpPhase,
  pipeline: [
    HttpPhase.OnRequest,
    HttpStep.ResolveRoute,
    HttpPhase.BeforeParse,
    HttpStep.ParseBody,
    HttpPhase.BeforeValidate,
    CoreStep.Validation,
    CoreStep.Guard,
    HttpPhase.BeforeHandle,
    CoreStep.Handler,
    HttpStep.WriteResponse,
    HttpPhase.AfterHandle,
    HttpStep.Serialize,
    HttpPhase.BeforeResponse,
    HttpPhase.AfterResponse,
  ],
});
