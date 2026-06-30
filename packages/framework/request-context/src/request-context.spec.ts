import { describe, expect, it } from 'bun:test';

import { RequestContext } from './request-context';

describe('RequestContext', () => {
  it('exposes the data inside the scope', () => {
    RequestContext.run({ reqId: 'r1' }, () => {
      expect(RequestContext.get()).toEqual({ reqId: 'r1' });
    });
  });

  it('returns undefined outside any scope', () => {
    expect(RequestContext.get()).toBeUndefined();
  });

  it('returns the callback result', () => {
    expect(RequestContext.run({ reqId: 'r1' }, () => 42)).toBe(42);
  });

  it('merges a nested scope over its parent', () => {
    RequestContext.run({ reqId: 'r1', userId: 'u1' }, () => {
      RequestContext.run({ fn: 'work' }, () => {
        expect(RequestContext.get()).toEqual({ reqId: 'r1', userId: 'u1', fn: 'work' });
      });
    });
  });

  it('reads reqId via getRequestId', () => {
    RequestContext.run({ reqId: 'req-42' }, () => {
      expect(RequestContext.getRequestId()).toBe('req-42');
    });
  });

  it('returns undefined reqId outside any scope', () => {
    expect(RequestContext.getRequestId()).toBeUndefined();
  });
});
