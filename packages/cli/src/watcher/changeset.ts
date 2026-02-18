import { appendFile, mkdir, rename, rm } from 'node:fs/promises';

import { zipbulCacheDirPath, zipbulCacheFilePath } from '../common/zipbul-paths';

export type ChangesetEventType = 'change' | 'rename' | 'delete';

export interface ChangesetRecord {
  ts: number;
  event: ChangesetEventType;
  file: string;
}

export const CHANGESET_FILE_NAME = 'changeset.jsonl' as const;
export const CHANGESET_ROTATED_FILE_NAME = 'changeset.jsonl.1' as const;
export const DEFAULT_CHANGESET_MAX_LINES = 1000 as const;

function isErrno(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === 'object' && err !== null && 'code' in err;
}

function countJsonlLines(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }

  return trimmed.split(/\r?\n/).length;
}

export class ChangesetWriter {
  private initialized = false;
  private currentLineCount = 0;
  private readonly changesetPath: string;
  private readonly rotatedPath: string;
  private readonly changesetDir: string;
  private readonly maxLines: number;

  constructor(
    private readonly options: {
      projectRoot: string;
      nowMs: () => number;
      maxLines?: number;
    },
  ) {
    this.changesetDir = zipbulCacheDirPath(options.projectRoot);
    this.changesetPath = zipbulCacheFilePath(options.projectRoot, CHANGESET_FILE_NAME);
    this.rotatedPath = zipbulCacheFilePath(options.projectRoot, CHANGESET_ROTATED_FILE_NAME);
    this.maxLines = options.maxLines ?? DEFAULT_CHANGESET_MAX_LINES;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const file = Bun.file(this.changesetPath);
    if (await file.exists()) {
      const text = await file.text();
      this.currentLineCount = countJsonlLines(text);
    } else {
      this.currentLineCount = 0;
    }

    this.initialized = true;
  }

  private async rotateIfNeeded(): Promise<void> {
    if (this.currentLineCount < this.maxLines) {
      return;
    }

    await rm(this.rotatedPath, { force: true });

    try {
      await rename(this.changesetPath, this.rotatedPath);
    } catch (err) {
      if (isErrno(err) && err.code === 'ENOENT') {
        // Nothing to rotate.
      } else {
        throw err;
      }
    }

    this.currentLineCount = 0;
  }

  async append(input: { event: ChangesetEventType; file: string; ts?: number }): Promise<void> {
    await mkdir(this.changesetDir, { recursive: true });
    await this.ensureInitialized();
    await this.rotateIfNeeded();

    const record: ChangesetRecord = {
      ts: input.ts ?? this.options.nowMs(),
      event: input.event,
      file: input.file,
    };

    await appendFile(this.changesetPath, `${JSON.stringify(record)}\n`, 'utf8');
    this.currentLineCount += 1;
  }
}
