import { describe, it, expect } from 'bun:test';
import { defineModule } from '@zipbul/core';
import { HttpAdapter, type HttpTestSurface } from '@zipbul/http-adapter';

import { Test } from '../../index';

describe('@zipbul/testing — inProcess HTTP inject (smoke)', () => {
  it('boots an app and returns a Response from the production fetch path (404 with no routes)', async () => {
    const module = defineModule();

    const app = await Test.createApplication({
      module,
      attach: (b) => {
        b.attach(HttpAdapter, { port: 0 });
      },
    }).compile();

    try {
      const surface = app.adapter(HttpAdapter) as HttpTestSurface;
      const res = await surface.inject({ method: 'GET', url: 'http://localhost/probe' });
      // With no controllers registered, the production resolveRoute path
      // returns 404. The point of the smoke test is that the inject path
      // produced a Response at all — proving the wiring is end-to-end.
      expect(res.status).toBe(404);
    } finally {
      await app.close();
    }
  });
});
