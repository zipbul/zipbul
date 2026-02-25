import { describe, expect, it } from 'bun:test';

import { DiagnosticError } from './diagnostic-error';
import type { Diagnostic } from './types';

describe('DiagnosticError', () => {
  // [HP-1]
  it('should be an instance of Error', () => {
    const diagnostic: Diagnostic = { why: 'Something failed' };
    const error = new DiagnosticError(diagnostic);

    expect(error).toBeInstanceOf(Error);
  });

  // [HP-2]
  it('should expose the diagnostic on the diagnostic property', () => {
    const diagnostic: Diagnostic = { why: 'Something failed', how: 'Fix it' };
    const error = new DiagnosticError(diagnostic);

    expect(error.diagnostic).toBe(diagnostic);
  });

  // [HP-3]
  it('should set message from diagnostic.why', () => {
    const diagnostic: Diagnostic = { why: 'Missing config' };
    const error = new DiagnosticError(diagnostic);

    expect(error.message).toBe('Missing config');
  });

  // [HP-4]
  it('should set name to DiagnosticError', () => {
    const diagnostic: Diagnostic = { why: 'err' };
    const error = new DiagnosticError(diagnostic);

    expect(error.name).toBe('DiagnosticError');
  });

  // [HP-5]
  it('should accept ErrorOptions with cause', () => {
    const original = new Error('root');
    const diagnostic: Diagnostic = { why: 'Wrapped' };
    const error = new DiagnosticError(diagnostic, { cause: original });

    expect(error.cause).toBe(original);
  });

  // [HP-6]
  it('should be catchable via instanceof check', () => {
    const diagnostic: Diagnostic = { why: 'fail' };

    try {
      throw new DiagnosticError(diagnostic);
    } catch (e) {
      expect(e).toBeInstanceOf(DiagnosticError);

      if (e instanceof DiagnosticError) {
        expect(e.diagnostic).toBe(diagnostic);
      }
    }
  });
});
