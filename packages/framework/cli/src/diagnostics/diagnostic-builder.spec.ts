import { describe, expect, it } from 'bun:test';

import { buildDiagnostic } from './diagnostic-builder';

describe('buildDiagnostic', () => {
  // [HP-1]
  it('should build diagnostic with reason mapped to why', () => {
    const result = buildDiagnostic({
      reason: 'Missing config file',
    });

    expect(result.why).toBe('Missing config file');
  });

  // [HP-3]
  it('should include where when file is provided', () => {
    const result = buildDiagnostic({
      reason: 'Reason',
      file: 'src/app.ts',
    });

    expect(result.where).toEqual({ file: 'src/app.ts' });
  });

  // [HP-4]
  it('should include how when how is provided', () => {
    const result = buildDiagnostic({
      reason: 'Reason',
      how: 'Remove the duplicate import',
    });

    expect(result.how).toBe('Remove the duplicate import');
  });

  // [HP-5]
  it('should include both where and how when both provided', () => {
    const result = buildDiagnostic({
      reason: 'Reason',
      file: 'src/app.ts',
      how: 'Fix the import',
    });

    expect(result.where).toEqual({ file: 'src/app.ts' });
    expect(result.how).toBe('Fix the import');
  });

  // [HP-6]
  it('should omit where and how when neither provided', () => {
    const result = buildDiagnostic({
      reason: 'Reason',
    });

    expect(result).not.toHaveProperty('where');
    expect(result).not.toHaveProperty('how');
  });

  // [NE-6]
  it('should include where when file is empty string', () => {
    const result = buildDiagnostic({
      reason: 'Reason',
      file: '',
    });

    expect(result.where).toEqual({ file: '' });
  });

  // [NE-7]
  it('should include how when how is empty string', () => {
    const result = buildDiagnostic({
      reason: 'Reason',
      how: '',
    });

    expect(result.how).toBe('');
  });

  // [ED-3]
  it('should build diagnostic with minimal required fields only', () => {
    const result = buildDiagnostic({
      reason: 'Reason',
    });

    expect(result.why).toBe('Reason');
  });

  // [ED-5]
  it('should handle empty reason string', () => {
    const result = buildDiagnostic({
      reason: '',
    });

    expect(result.why).toBe('');
  });

  // [CO-1]
  it('should handle all empty required strings with no optionals', () => {
    const result = buildDiagnostic({
      reason: '',
    });

    expect(result.why).toBe('');
    expect(result).not.toHaveProperty('where');
    expect(result).not.toHaveProperty('how');
  });

  // [CO-2]
  it('should handle all empty required strings with empty optionals', () => {
    const result = buildDiagnostic({
      reason: '',
      file: '',
      how: '',
    });

    expect(result.why).toBe('');
    expect(result.where).toEqual({ file: '' });
    expect(result.how).toBe('');
  });

  // [CO-4]
  it('should include how but omit where when only how provided', () => {
    const result = buildDiagnostic({
      reason: 'Reason',
      how: 'Fix it',
    });

    expect(result).not.toHaveProperty('where');
    expect(result.how).toBe('Fix it');
  });

  // [CO-5]
  it('should include where but omit how when only file provided', () => {
    const result = buildDiagnostic({
      reason: 'Reason',
      file: 'src/app.ts',
    });

    expect(result.where).toEqual({ file: 'src/app.ts' });
    expect(result).not.toHaveProperty('how');
  });

  // [ID-1]
  it('should return identical results for identical params', () => {
    const params = {
      reason: 'Reason',
      file: 'src/app.ts',
      how: 'Fix it',
    };

    const result1 = buildDiagnostic(params);
    const result2 = buildDiagnostic(params);

    expect(result1).toEqual(result2);
  });

  // [HP-SYM-1]
  it('should include symbol in where when file and symbol are both provided', () => {
    const result = buildDiagnostic({
      reason: 'Reason',
      file: 'src/app.ts',
      symbol: 'AppController.create',
    });

    expect(result.where).toEqual({ file: 'src/app.ts', symbol: 'AppController.create' });
  });

  // [HP-SYM-2]
  it('should include where with symbol and how when all three optionals provided', () => {
    const result = buildDiagnostic({
      reason: 'Reason',
      file: 'src/app.ts',
      symbol: 'AppController',
      how: 'Fix it',
    });

    expect(result.where).toEqual({ file: 'src/app.ts', symbol: 'AppController' });
    expect(result.how).toBe('Fix it');
  });

  // [CO-SYM-1]
  it('should ignore symbol when file is not provided', () => {
    const result = buildDiagnostic({
      reason: 'Reason',
      symbol: 'AppController',
    });

    expect(result).not.toHaveProperty('where');
  });

  // [ED-SYM-1]
  it('should include empty symbol in where when symbol is empty string', () => {
    const result = buildDiagnostic({
      reason: 'Reason',
      file: 'src/app.ts',
      symbol: '',
    });

    expect(result.where).toEqual({ file: 'src/app.ts', symbol: '' });
  });

  // [CO-SYM-2]
  it('should handle all empty required and all empty optionals including symbol', () => {
    const result = buildDiagnostic({
      reason: '',
      file: '',
      symbol: '',
      how: '',
    });

    expect(result.why).toBe('');
    expect(result.where).toEqual({ file: '', symbol: '' });
    expect(result.how).toBe('');
  });

  // [ID-SYM-1]
  it('should return identical results for identical params including symbol', () => {
    const params = {
      reason: 'Reason',
      file: 'src/app.ts',
      symbol: 'AppController.create',
      how: 'Fix it',
    };

    const result1 = buildDiagnostic(params);
    const result2 = buildDiagnostic(params);

    expect(result1).toEqual(result2);
  });

  // [HP-NO-SUMMARY]
  it('should not include summary field in output', () => {
    const result = buildDiagnostic({
      reason: 'Reason',
    });

    expect(result).not.toHaveProperty('summary');
  });

  // [HP-CAUSE-1]
  it('should include cause when cause is provided', () => {
    const originalError = new Error('root cause');
    const result = buildDiagnostic({
      reason: 'Reason',
      cause: originalError,
    });

    expect(result.cause).toBe(originalError);
  });

  // [HP-CAUSE-2]
  it('should omit cause when cause is not provided', () => {
    const result = buildDiagnostic({
      reason: 'Reason',
    });

    expect(result).not.toHaveProperty('cause');
  });
});
