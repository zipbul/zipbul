import { describe, expect, it } from 'bun:test';

import { RequestContext } from './async-storage';

describe('RequestContext', () => {
  it('should store context and return via getContext', () => {
    // Arrange & Act
    RequestContext.run({ reqId: 'r1' }, () => {
      // Assert
      const ctx = RequestContext.getContext();

      expect(ctx).toEqual({ reqId: 'r1' });
    });
  });

  it('should return callback result from run', () => {
    // Act
    const result = RequestContext.run({ reqId: 'r1' }, () => 42);

    // Assert
    expect(result).toBe(42);
  });

  it('should merge parent context with child in nested run', () => {
    // Arrange & Act
    RequestContext.run({ reqId: 'r1', userId: 'u1' }, () => {
      RequestContext.run({ fn: 'doWork' }, () => {
        // Assert
        const ctx = RequestContext.getContext();

        expect(ctx).toEqual({ reqId: 'r1', userId: 'u1', fn: 'doWork' });
      });
    });
  });

  it('should get reqId from stored context', () => {
    // Arrange & Act
    RequestContext.run({ reqId: 'req-42' }, () => {
      // Assert
      expect(RequestContext.getRequestId()).toBe('req-42');
    });
  });

  it('should return undefined from getContext outside run', () => {
    // Act & Assert
    expect(RequestContext.getContext()).toBeUndefined();
  });

  it('should return undefined from getRequestId outside run', () => {
    // Act & Assert
    expect(RequestContext.getRequestId()).toBeUndefined();
  });

  it('should use context as-is when no parent exists', () => {
    // Arrange
    const context = { reqId: 'solo', fn: 'test' };

    // Act
    RequestContext.run(context, () => {
      // Assert
      const stored = RequestContext.getContext();

      expect(stored).toEqual(context);
    });
  });

  it('should override parent key when child has same key', () => {
    // Arrange & Act
    RequestContext.run({ reqId: 'parent', fn: 'parentFn' }, () => {
      RequestContext.run({ fn: 'childFn' }, () => {
        // Assert
        const ctx = RequestContext.getContext();

        expect(ctx?.fn).toBe('childFn');
        expect(ctx?.reqId).toBe('parent');
      });
    });
  });

  it('should isolate contexts in concurrent async runs', async () => {
    // Arrange
    const results: string[] = [];

    // Act
    await Promise.all([
      RequestContext.run({ reqId: 'a' }, async () => {
        await new Promise(r => setTimeout(r, 10));
        results.push(`1:${RequestContext.getRequestId()}`);
      }),
      RequestContext.run({ reqId: 'b' }, async () => {
        await new Promise(r => setTimeout(r, 5));
        results.push(`2:${RequestContext.getRequestId()}`);
      }),
    ]);

    // Assert
    expect(results).toContain('1:a');
    expect(results).toContain('2:b');
  });
});
