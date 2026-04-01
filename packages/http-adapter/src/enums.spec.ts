import { describe, expect, it } from 'bun:test';
import { HttpPhase, isHttpPhase } from './enums';

describe('isHttpPhase', () => {
  it('should return true for OnRequest', () => {
    expect(isHttpPhase('OnRequest')).toBe(true);
  });

  it('should return true for BeforeParse', () => {
    expect(isHttpPhase('BeforeParse')).toBe(true);
  });

  it('should return true for BeforeValidate', () => {
    expect(isHttpPhase('BeforeValidate')).toBe(true);
  });

  it('should return true for BeforeHandle', () => {
    expect(isHttpPhase('BeforeHandle')).toBe(true);
  });

  it('should return true for AfterHandle', () => {
    expect(isHttpPhase('AfterHandle')).toBe(true);
  });

  it('should return true for BeforeResponse', () => {
    expect(isHttpPhase('BeforeResponse')).toBe(true);
  });

  it('should return true for AfterResponse', () => {
    expect(isHttpPhase('AfterResponse')).toBe(true);
  });

  it('should return false for InvalidPhase', () => {
    expect(isHttpPhase('InvalidPhase')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isHttpPhase('')).toBe(false);
  });

  it('should return false for removed phase names', () => {
    expect(isHttpPhase('BeforeParsing')).toBe(false);
    expect(isHttpPhase('BeforeValidation')).toBe(false);
    expect(isHttpPhase('BeforeHandler')).toBe(false);
    expect(isHttpPhase('Cleanup')).toBe(false);
  });
});

describe('HttpPhase', () => {
  it('should have exactly 7 values', () => {
    const values = Object.values(HttpPhase);

    expect(values).toHaveLength(7);
    expect(values).toContain('OnRequest');
    expect(values).toContain('BeforeParse');
    expect(values).toContain('BeforeValidate');
    expect(values).toContain('BeforeHandle');
    expect(values).toContain('AfterHandle');
    expect(values).toContain('BeforeResponse');
    expect(values).toContain('AfterResponse');
  });

  it('should contain all expected phase values', () => {
    expect(HttpPhase.OnRequest).toBe('OnRequest');
    expect(HttpPhase.BeforeParse).toBe('BeforeParse');
    expect(HttpPhase.BeforeValidate).toBe('BeforeValidate');
    expect(HttpPhase.BeforeHandle).toBe('BeforeHandle');
    expect(HttpPhase.AfterHandle).toBe('AfterHandle');
    expect(HttpPhase.BeforeResponse).toBe('BeforeResponse');
    expect(HttpPhase.AfterResponse).toBe('AfterResponse');
  });
});
