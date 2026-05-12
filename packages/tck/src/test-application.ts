import {
  Application,
  Container,
  createApplication,
  defineModule,
  registerBootstrapState,
} from '@zipbul/core';

export interface TckApplicationOptions {
  register: (app: Application) => void | Promise<void>;
}

export class TestApplication {
  private _closed = false;

  private constructor(private readonly _app: Application) {}

  static async create(opts: TckApplicationOptions): Promise<TestApplication> {
    registerBootstrapState({
      container: new Container(),
      adapterConfig: {},
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
