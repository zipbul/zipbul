import { describe, expect, it } from 'bun:test';
import { HttpPhase, isHttpPhase } from './enums';

describe('isHttpPhase', () => {
  it('should return true for OnRequest', () => {
    expect(isHttpPhase('OnRequest')).toBe(true);
  });

  it('should return true for BeforeParsing', () => {
    expect(isHttpPhase('BeforeParsing')).toBe(true);
  });

  it('should return true for BeforeValidation', () => {
    expect(isHttpPhase('BeforeValidation')).toBe(true);
  });

  it('should return true for BeforeHandler', () => {
    expect(isHttpPhase('BeforeHandler')).toBe(true);
  });

  it('should return true for BeforeResponse', () => {
    expect(isHttpPhase('BeforeResponse')).toBe(true);
  });

  it('should return true for Cleanup', () => {
    expect(isHttpPhase('Cleanup')).toBe(true);
  });

  it('should return false for AfterResponse', () => {
    expect(isHttpPhase('AfterResponse')).toBe(false);
  });

  it('should return false for InvalidPhase', () => {
    expect(isHttpPhase('InvalidPhase')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isHttpPhase('')).toBe(false);
  });
});

describe('HttpPhase', () => {
  it('should have exactly 6 values including Cleanup and not AfterResponse', () => {
    const values = Object.values(HttpPhase);

    expect(values).toHaveLength(6);
    expect(values).toContain('Cleanup');
    expect(values).not.toContain('AfterResponse');
  });

  it('should contain all expected phase values', () => {
    expect(HttpPhase.OnRequest).toBe('OnRequest');
    expect(HttpPhase.BeforeParsing).toBe('BeforeParsing');
    expect(HttpPhase.BeforeValidation).toBe('BeforeValidation');
    expect(HttpPhase.BeforeHandler).toBe('BeforeHandler');
    expect(HttpPhase.BeforeResponse).toBe('BeforeResponse');
    expect(HttpPhase.Cleanup).toBe('Cleanup');
  });
});
