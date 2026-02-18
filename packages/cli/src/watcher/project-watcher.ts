import { relative } from 'path';

import * as watcher from '@parcel/watcher';

import { ZIPBUL_DIRNAME } from '../common/zipbul-paths';

import type { FileChangePayload } from './interfaces';

export const PROJECT_WATCHER_IGNORE_GLOBS: readonly string[] = [
  '**/.git/**',
  `**/${ZIPBUL_DIRNAME}/**`,
  '**/dist/**',
  '**/node_modules/**',
];

export class ProjectWatcher {
  private subscription: watcher.AsyncSubscription | undefined;

  constructor(private readonly rootPath: string) {}

  async start(onChange: (event: FileChangePayload) => void) {
    console.info(`👁️  Watching for file changes in ${this.rootPath}...`);

    this.subscription = await watcher.subscribe(
      this.rootPath,
      (_err: Error | null, events: Array<watcher.Event>) => {
        for (const evt of events) {
          const relativeName = relative(this.rootPath, evt.path).replaceAll('\\', '/');

          // Guard: ignore paths outside the watched root.
          if (relativeName.startsWith('..')) {
            continue;
          }

          if (!relativeName.endsWith('.ts') || relativeName.endsWith('.d.ts')) {
            continue;
          }

          const eventType =
            evt.type === 'update' ? 'change' : evt.type === 'delete' ? 'delete' : 'rename';

          onChange({ eventType, filename: relativeName });
        }
      },
      {
        ignore: [...PROJECT_WATCHER_IGNORE_GLOBS],
      },
    );
  }

  async close() {
    await this.subscription?.unsubscribe();
    this.subscription = undefined;
  }
}
