import type { AdapterMiddlewareConfig } from '@zipbul/core';

import {
  Application,
  Container,
  createApplication,
  defineModule,
  registerBootstrapState,
} from '@zipbul/core';

export interface TckApplicationOptions {
  /**
   * Attaches adapters to the application before it starts. Use this to wire the
   * transport(s) under test; declarative middleware/guard/filter registration
   * belongs in {@link TckApplicationOptions.adapterConfig}, not here.
   */
  register: (app: Application) => void | Promise<void>;

  /**
   * Per-adapter middleware/guard/exception-filter configuration, keyed by the
   * adapter's resolved config key (its `name` if attached with one, otherwise
   * its class name). This is the declarative equivalent of the AOT-generated
   * `adapterConfig`: the application bootstrap hands each slice to the matching
   * adapter via `applyMiddlewareConfig` / `applyGuardConfig` /
   * `applyExceptionFilterConfig`, exactly as a compiled app would.
   */
  adapterConfig?: Record<string, AdapterMiddlewareConfig>;
}

export class TestApplication {
  private _closed = false;

  private constructor(private readonly _app: Application) {}

  static async create(opts: TckApplicationOptions): Promise<TestApplication> {
    registerBootstrapState({
      container: new Container(),
      adapterConfig: opts.adapterConfig ?? {},
    });

    const app = createApplication(defineModule());

    try {
      await opts.register(app);
      await app.start();
    } catch (err) {
      try { await app.stop(); } catch { /* swallow — caller already failed */ }
      throw err;
    }

    return new TestApplication(app);
  }

  async close(): Promise<void> {
    if (this._closed) return;
    try {
      await this._app.stop();
    } finally {
      this._closed = true;
    }
  }
}
