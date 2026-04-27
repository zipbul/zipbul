import { describe, it, expect } from 'bun:test';
import { extractCrashDiagnostics } from './crash-diagnostics';
import type { CrashDiagnostics } from './crash-diagnostics';

type Narrowed<T extends CrashDiagnostics['type']> = Extract<CrashDiagnostics, { type: T }>;

function narrow<T extends CrashDiagnostics['type']>(
  diag: CrashDiagnostics,
  expected: T,
): Narrowed<T> {
  if (diag.type !== expected) {
    throw new Error(`expected CrashDiagnostics.type '${expected}', got '${diag.type}'`);
  }
  return diag as Narrowed<T>;
}

describe('extractCrashDiagnostics', () => {
  describe('Error input', () => {
    it('should extract message and stack from a standard Error', () => {
      const error = new Error('something broke');
      const result = extractCrashDiagnostics(error);

      expect(result.type).toBe('error');
      const narrowed = narrow(result, 'error');
      expect(narrowed.message).toBe('something broke');
      expect(narrowed.stack).toBeDefined();
      expect(narrowed.error).toBe(error);
    });

    it('should extract name from a custom error class', () => {
      class CustomError extends Error {
        constructor() {
          super('custom');
          this.name = 'CustomError';
        }
      }

      const error = new CustomError();
      const result = extractCrashDiagnostics(error);

      expect(result.type).toBe('error');
      const narrowed = narrow(result, 'error');
      expect(narrowed.name).toBe('CustomError');
      expect(narrowed.message).toBe('custom');
    });
  });

  describe('CloseEvent input', () => {
    it('should extract code, reason, and wasClean from CloseEvent', () => {
      const event = new CloseEvent('close', { code: 1, reason: 'exited', wasClean: false });
      const result = extractCrashDiagnostics(event);

      expect(result.type).toBe('close');
      const narrowed = narrow(result, 'close');
      expect(narrowed.code).toBe(1);
      expect(narrowed.reason).toBe('exited');
      expect(narrowed.wasClean).toBe(false);
    });

    it('should extract code 137 for OOM-killed worker', () => {
      const event = new CloseEvent('close', { code: 137, reason: '', wasClean: false });
      const result = extractCrashDiagnostics(event);

      expect(result.type).toBe('close');
      const narrowed = narrow(result, 'close');
      expect(narrowed.code).toBe(137);
      expect(narrowed.wasClean).toBe(false);
    });

    it('should extract code 0 for normal exit', () => {
      const event = new CloseEvent('close', { code: 0, wasClean: true });
      const result = extractCrashDiagnostics(event);

      expect(result.type).toBe('close');
      const narrowed = narrow(result, 'close');
      expect(narrowed.code).toBe(0);
      expect(narrowed.wasClean).toBe(true);
    });
  });

  describe('ErrorEvent input', () => {
    it('should unwrap the nested .error property to get the real Error', () => {
      const innerError = new Error('real cause');
      const event = new ErrorEvent('error', { error: innerError, message: 'error event msg' });
      const result = extractCrashDiagnostics(event);

      expect(result.type).toBe('error-event');
      const narrowed = narrow(result, 'error-event');
      expect(narrowed.error).toBe(innerError);
      expect(narrowed.message).toBe('real cause');
      expect(narrowed.stack).toBeDefined();
    });

    it('should handle ErrorEvent where .error is not an Error instance', () => {
      const event = new ErrorEvent('error', { error: 'string error', message: 'msg' });
      const result = extractCrashDiagnostics(event);

      expect(result.type).toBe('error-event');
      const narrowed = narrow(result, 'error-event');
      expect(narrowed.error).toBeUndefined();
      expect(narrowed.message).toBe('msg');
    });

    it('should handle ErrorEvent with filename and lineno', () => {
      const event = new ErrorEvent('error', {
        error: new Error('fail'),
        message: 'fail',
        filename: '/worker.ts',
        lineno: 42,
        colno: 10,
      });
      const result = extractCrashDiagnostics(event);

      expect(result.type).toBe('error-event');
      const narrowed = narrow(result, 'error-event');
      expect(narrowed.filename).toBe('/worker.ts');
      expect(narrowed.lineno).toBe(42);
      expect(narrowed.colno).toBe(10);
    });

    it('should handle ErrorEvent with no .error property', () => {
      const event = new ErrorEvent('error', { message: 'generic' });
      const result = extractCrashDiagnostics(event);

      expect(result.type).toBe('error-event');
      const narrowed = narrow(result, 'error-event');
      expect(narrowed.error).toBeUndefined();
      expect(narrowed.message).toBe('generic');
    });
  });

  describe('MessageEvent input', () => {
    it('should extract data summary from MessageEvent', () => {
      const event = new MessageEvent('messageerror', { data: { foo: 'bar' } });
      const result = extractCrashDiagnostics(event);

      expect(result.type).toBe('message-event');
      const narrowed = narrow(result, 'message-event');
      expect(narrowed.message).toBeDefined();
    });
  });

  describe('unknown Event input', () => {
    it('should return minimal info for a generic Event', () => {
      const event = new Event('unknown');
      const result = extractCrashDiagnostics(event);

      expect(result.type).toBe('unknown-event');
      const narrowed = narrow(result, 'unknown-event');
      expect(narrowed.message).toBe('unknown');
    });
  });
});
