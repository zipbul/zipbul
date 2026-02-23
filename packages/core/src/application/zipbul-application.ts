import type {
  ProviderToken,
  ZipbulAdapter,
  Context,
  ZipbulContainer,
  ZipbulValue,
  ClassToken,
} from '@zipbul/common';

import { Container } from '../injector/container';
import type { AdapterEntry } from './interfaces';

class AppContext implements Context {
  getType(): string {
    return 'application';
  }

  get(_key: string): ZipbulValue | undefined {
    return undefined;
  }

  to<TContext extends ZipbulValue>(_ctor: ClassToken<TContext>): TContext {
    throw new Error('Context.to() is not supported in application context');
  }
}

export class ZipbulApplication {
  private readonly container: Container = new Container();
  private readonly adapters: Map<string, AdapterEntry> = new Map();
  private started = false;
  private stopped = false;

  public get(token: ProviderToken): ZipbulValue {
    return this.container.get(token);
  }

  public getContainer(): ZipbulContainer {
    return this.container;
  }

  public addAdapter(adapter: ZipbulAdapter, config: { name: string; protocol: string }): void {
    if (!config.name) {
      throw new Error('Adapter name must not be empty');
    }

    if (this.started) {
      throw new Error('Cannot add adapter after application has started');
    }

    if (this.adapters.has(config.name)) {
      throw new Error(`Adapter "${config.name}" is already registered`);
    }

    this.adapters.set(config.name, {
      adapter,
      name: config.name,
      protocol: config.protocol,
    });
  }

  public async start(): Promise<void> {
    if (this.started) {
      throw new Error('Application has already started');
    }

    this.started = true;
    const context = new AppContext();

    for (const entry of this.adapters.values()) {
      await entry.adapter.start(context);
    }
  }

  public async stop(): Promise<void> {
    if (!this.started) {
      throw new Error('Application has not been started');
    }

    if (this.stopped) {
      throw new Error('Application has already stopped');
    }

    this.stopped = true;
    const entries = Array.from(this.adapters.values()).reverse();

    for (const entry of entries) {
      await entry.adapter.stop();
    }
  }

  public attach(): void {
    //
  }
}

