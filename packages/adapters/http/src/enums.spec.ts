import { describe, expect, it } from 'bun:test';
import { HttpAdapterPhase } from './enums';
import { isHttpAdapterPhase } from './utils';

describe('isHttpAdapterPhase', () => {
  it('should return true for OnRequest', () => {
    expect(isHttpAdapterPhase('OnRequest')).toBe(true);
  });

  it('should return true for BeforeParse', () => {
    expect(isHttpAdapterPhase('BeforeParse')).toBe(true);
  });

  it('should return true for BeforeValidate', () => {
    expect(isHttpAdapterPhase('BeforeValidate')).toBe(true);
  });

  it('should return true for BeforeHandle', () => {
    expect(isHttpAdapterPhase('BeforeHandle')).toBe(true);
  });

  it('should return true for AfterHandle', () => {
    expect(isHttpAdapterPhase('AfterHandle')).toBe(true);
  });

  it('should return true for BeforeResponse', () => {
    expect(isHttpAdapterPhase('BeforeResponse')).toBe(true);
  });

  it('should return true for AfterResponse', () => {
    expect(isHttpAdapterPhase('AfterResponse')).toBe(true);
  });

  it('should return false for InvalidPhase', () => {
    expect(isHttpAdapterPhase('InvalidPhase')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isHttpAdapterPhase('')).toBe(false);
  });

  it('should return false for removed phase names', () => {
    expect(isHttpAdapterPhase('BeforeParsing')).toBe(false);
    expect(isHttpAdapterPhase('BeforeValidation')).toBe(false);
    expect(isHttpAdapterPhase('BeforeHandler')).toBe(false);
    expect(isHttpAdapterPhase('Cleanup')).toBe(false);
  });
});

describe('HttpAdapterPhase', () => {
  it('should have exactly 7 values', () => {
    const values: readonly string[] = Object.values(HttpAdapterPhase);

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
    expect(HttpAdapterPhase.OnRequest as string).toBe('OnRequest');
    expect(HttpAdapterPhase.BeforeParse as string).toBe('BeforeParse');
    expect(HttpAdapterPhase.BeforeValidate as string).toBe('BeforeValidate');
    expect(HttpAdapterPhase.BeforeHandle as string).toBe('BeforeHandle');
    expect(HttpAdapterPhase.AfterHandle as string).toBe('AfterHandle');
    expect(HttpAdapterPhase.BeforeResponse as string).toBe('BeforeResponse');
    expect(HttpAdapterPhase.AfterResponse as string).toBe('AfterResponse');
  });
});
