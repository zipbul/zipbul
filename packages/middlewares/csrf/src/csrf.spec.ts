import { describe, expect, it } from 'bun:test';

import { csrfMiddleware } from './csrf';

describe('csrfMiddleware', () => {
  it('returns a middleware definition for the default config', () => {
    const middleware = csrfMiddleware();

    expect(typeof middleware.factory).toBe('function');
  });

  it('accepts an explicit enabled flag', () => {
    const middleware = csrfMiddleware({ enabled: false });

    expect(typeof middleware.factory).toBe('function');
  });

  it('throws at registration when an option is the wrong type', () => {
    // @ts-expect-error — intentionally invalid to show boot-time validation.
    expect(() => csrfMiddleware({ enabled: 'yes' })).toThrow();
  });
});
