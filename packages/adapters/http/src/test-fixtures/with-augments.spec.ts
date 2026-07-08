import { describe, it, expect } from 'bun:test';
import { augmentRawKey, defineMiddleware } from '@zipbul/common';

import { HttpAdapter } from '../http-adapter';
import { HttpContext } from '../http-context';
import { createTestHttpContext } from './http-context-fixture';
import { withAugments } from './with-augments';

let seq = 0;
const uniqueProp = (base: string): string => `__wa_${base}_${seq++}`;

describe('withAugments', () => {
  it('should populate the raw slot from a bare supply function and run fn in the adapter context', async () => {
    // Arrange
    const prop = uniqueProp('getQuery');
    const def = defineMiddleware({
      adapters: [HttpAdapter],
      augments: {
        request: {
          [prop]: (ctx) => {
            const http = ctx.to(HttpContext);

            return { qs: http.request.queryString };
          },
        },
      },
    });
    const ctx = createTestHttpContext({ url: 'http://localhost/x?a=1' });

    // Act
    const raw = await withAugments(def, ctx, () => ctx.get(augmentRawKey('request', prop)));

    // Assert
    expect(raw).toEqual({ qs: '?a=1' });
  });

  it('should run fn even for a definition without augments', async () => {
    // Arrange
    const def = defineMiddleware(() => () => undefined);
    const ctx = createTestHttpContext();

    // Act
    const out = await withAugments(def, ctx, () => 'ran');

    // Assert
    expect(out).toBe('ran');
  });
});
