import { describe, expect, it } from 'bun:test';

import { buildDiagnostic } from './diagnostic-builder';

describe('buildDiagnostic', () => {
  // [HP-1]
  it('should format summary and why with error severity prefix', () => {
    const result = buildDiagnostic({
      code: 'ZB_TEST_001',
      severity: 'error',
      summary: 'Something broke',
      reason: 'Missing config file',
    });

    expect(result.severity).toBe('error');
    expect(result.code).toBe('ZB_TEST_001');
    expect(result.summary).toBe('[error/ZB_TEST_001] Something broke');
    expect(result.why).toBe('[error/ZB_TEST_001] Missing config file');
  });

  // [HP-2]
  it('should format summary and why with warning severity prefix', () => {
    const result = buildDiagnostic({
      code: 'ZB_TEST_002',
      severity: 'warning',
      summary: 'Deprecated usage',
      reason: 'Use new API instead',
    });

    expect(result.severity).toBe('warning');
    expect(result.code).toBe('ZB_TEST_002');
    expect(result.summary).toBe('[warning/ZB_TEST_002] Deprecated usage');
    expect(result.why).toBe('[warning/ZB_TEST_002] Use new API instead');
  });

  // [HP-3]
  it('should include where when file is provided', () => {
    const result = buildDiagnostic({
      code: 'ZB_TEST_001',
      severity: 'error',
      summary: 'Error',
      reason: 'Reason',
      file: 'src/app.ts',
    });

    expect(result.where).toEqual({ file: 'src/app.ts' });
  });

  // [HP-4]
  it('should include how when how is provided', () => {
    const result = buildDiagnostic({
      code: 'ZB_TEST_001',
      severity: 'error',
      summary: 'Error',
      reason: 'Reason',
      how: 'Remove the duplicate import',
    });

    expect(result.how).toBe('Remove the duplicate import');
  });

  // [HP-5]
  it('should include both where and how when both provided', () => {
    const result = buildDiagnostic({
      code: 'ZB_TEST_001',
      severity: 'error',
      summary: 'Error',
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
      code: 'ZB_TEST_001',
      severity: 'error',
      summary: 'Error',
      reason: 'Reason',
    });

    expect(result).not.toHaveProperty('where');
    expect(result).not.toHaveProperty('how');
  });

  // [NE-6]
  it('should include where when file is empty string', () => {
    const result = buildDiagnostic({
      code: 'ZB_TEST_001',
      severity: 'error',
      summary: 'Error',
      reason: 'Reason',
      file: '',
    });

    expect(result.where).toEqual({ file: '' });
  });

  // [NE-7]
  it('should include how when how is empty string', () => {
    const result = buildDiagnostic({
      code: 'ZB_TEST_001',
      severity: 'error',
      summary: 'Error',
      reason: 'Reason',
      how: '',
    });

    expect(result.how).toBe('');
  });

  // [ED-3]
  it('should handle empty code string in prefix', () => {
    const result = buildDiagnostic({
      code: '',
      severity: 'error',
      summary: 'Error',
      reason: 'Reason',
    });

    expect(result.summary).toBe('[error/] Error');
    expect(result.why).toBe('[error/] Reason');
    expect(result.code).toBe('');
  });

  // [ED-4]
  it('should handle empty summary string', () => {
    const result = buildDiagnostic({
      code: 'ZB_TEST_001',
      severity: 'error',
      summary: '',
      reason: 'Reason',
    });

    expect(result.summary).toBe('[error/ZB_TEST_001] ');
  });

  // [ED-5]
  it('should handle empty reason string', () => {
    const result = buildDiagnostic({
      code: 'ZB_TEST_001',
      severity: 'error',
      summary: 'Error',
      reason: '',
    });

    expect(result.why).toBe('[error/ZB_TEST_001] ');
  });

  // [CO-1]
  it('should handle all empty required strings with no optionals', () => {
    const result = buildDiagnostic({
      code: '',
      severity: 'error',
      summary: '',
      reason: '',
    });

    expect(result.code).toBe('');
    expect(result.summary).toBe('[error/] ');
    expect(result.why).toBe('[error/] ');
    expect(result).not.toHaveProperty('where');
    expect(result).not.toHaveProperty('how');
  });

  // [CO-2]
  it('should handle all empty required strings with empty optionals', () => {
    const result = buildDiagnostic({
      code: '',
      severity: 'error',
      summary: '',
      reason: '',
      file: '',
      how: '',
    });

    expect(result.code).toBe('');
    expect(result.summary).toBe('[error/] ');
    expect(result.why).toBe('[error/] ');
    expect(result.where).toEqual({ file: '' });
    expect(result.how).toBe('');
  });

  // [CO-4]
  it('should include how but omit where when only how provided', () => {
    const result = buildDiagnostic({
      code: 'ZB_TEST_001',
      severity: 'error',
      summary: 'Error',
      reason: 'Reason',
      how: 'Fix it',
    });

    expect(result).not.toHaveProperty('where');
    expect(result.how).toBe('Fix it');
  });

  // [CO-5]
  it('should include where but omit how when only file provided', () => {
    const result = buildDiagnostic({
      code: 'ZB_TEST_001',
      severity: 'error',
      summary: 'Error',
      reason: 'Reason',
      file: 'src/app.ts',
    });

    expect(result.where).toEqual({ file: 'src/app.ts' });
    expect(result).not.toHaveProperty('how');
  });

  // [ID-1]
  it('should return identical results for identical params', () => {
    const params = {
      code: 'ZB_TEST_001',
      severity: 'error' as const,
      summary: 'Error',
      reason: 'Reason',
      file: 'src/app.ts',
      how: 'Fix it',
    };

    const result1 = buildDiagnostic(params);
    const result2 = buildDiagnostic(params);

    expect(result1).toEqual(result2);
  });
});
