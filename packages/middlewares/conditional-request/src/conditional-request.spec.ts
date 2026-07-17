import { describe, expect, it } from 'bun:test';

import { conditionalRequestMiddleware } from './conditional-request';

describe('conditionalRequestMiddleware', () => {
  it('returns a middleware definition for the default config', () => {
    const middleware = conditionalRequestMiddleware();

    expect(typeof middleware.factory).toBe('function');
  });

  it('accepts an explicit enabled flag', () => {
    const middleware = conditionalRequestMiddleware({ enabled: false });

    expect(typeof middleware.factory).toBe('function');
  });

  it('throws at registration when an option is the wrong type', () => {
    // @ts-expect-error — intentionally invalid to show boot-time validation.
    expect(() => conditionalRequestMiddleware({ enabled: 'yes' })).toThrow();
  });
});
