import { describe, expect, it } from 'bun:test';
import { isErr } from '@zipbul/result';

import { HttpAdapter } from './http-adapter';
import type { ErrorResponseData } from './types';

describe('HttpAdapter protocol-translation hooks (symmetric with wrapValidationError)', () => {
  class Exposed extends HttpAdapter {
    public callWrapUnhandled(error: unknown): unknown {
      return this.wrapUnhandledException(error);
    }
    public callWrapInvalidFilter(error: unknown, filterResult: unknown): unknown {
      return this.wrapInvalidFilterResult(error, filterResult);
    }
  }

  describe('wrapUnhandledException', () => {
    it('returns ErrorResponseData with 500 + RFC reason for any thrown value', () => {
      const adapter = new Exposed();
      const result = adapter.callWrapUnhandled(new Error('totally unhandled'));
      expect(isErr(result)).toBe(true);
      const data = (result as { data: ErrorResponseData }).data;
      expect(data.status).toBe(500);
      expect(data.message).toBe('Internal Server Error');
      expect('cause' in (data as unknown as Record<string, unknown>)).toBe(false);
    });

    it('ignores the thrown value — always generic 500 (caller must not leak invariant)', () => {
      const adapter = new Exposed();
      const a = adapter.callWrapUnhandled('string');
      const b = adapter.callWrapUnhandled({ custom: true });
      const c = adapter.callWrapUnhandled(undefined);
      const d = adapter.callWrapUnhandled(null);
      for (const r of [a, b, c, d]) {
        expect(isErr(r)).toBe(true);
        expect((r as { data: ErrorResponseData }).data).toEqual({
          status: 500,
          message: 'Internal Server Error',
        });
      }
    });
  });

  describe('wrapInvalidFilterResult', () => {
    it('returns generic 500 when a matched filter returned a non-Err value', () => {
      const adapter = new Exposed();
      const result = adapter.callWrapInvalidFilter(new Error('boom'), { oops: 'forgot err()' });
      expect(isErr(result)).toBe(true);
      const data = (result as { data: ErrorResponseData }).data;
      expect(data.status).toBe(500);
      expect(data.message).toBe('Internal Server Error');
    });
  });
});
