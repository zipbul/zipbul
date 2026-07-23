import { mockContext } from '@zipbul/http-adapter/testing';

import type { MiddlewareDefinition } from '@zipbul/common';
import type { HttpContext } from '@zipbul/http-adapter';

import { helmetMiddleware } from '../../index';

import type { HelmetOptions } from '../../index';

export interface RunHelmetExtras {
  /** Executed before helmet — seeds pre-existing response state. */
  prior?: readonly MiddlewareDefinition[];
  /** Executed after helmet — exercises the "later middleware wins" contract. */
  subsequent?: readonly MiddlewareDefinition[];
}

/**
 * Runs `helmetMiddleware` against a real `HttpContext`/`HttpResponse` (no
 * socket, no app boot) and returns the executed context. `prior` middlewares
 * run before helmet — planting state helmet must overwrite; `subsequent`
 * middlewares run after — exercising the public later-wins ordering contract
 * helmet cannot block.
 */
export async function runHelmet(
  options?: Partial<HelmetOptions>,
  extras: RunHelmetExtras = {},
): Promise<HttpContext> {
  const ctx = mockContext({});

  for (const middleware of extras.prior ?? []) {
    await middleware.factory()(ctx);
  }

  await helmetMiddleware(options).factory()(ctx);

  for (const middleware of extras.subsequent ?? []) {
    await middleware.factory()(ctx);
  }

  return ctx;
}
