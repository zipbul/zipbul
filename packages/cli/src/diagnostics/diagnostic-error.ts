import type { Diagnostic } from './types';

export class DiagnosticError extends Error {
  constructor(
    public readonly diagnostic: Diagnostic,
    options?: ErrorOptions,
  ) {
    super(diagnostic.why, options);
    this.name = 'DiagnosticError';
  }
}
