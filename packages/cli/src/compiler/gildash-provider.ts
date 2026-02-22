import { Gildash } from '@zipbul/gildash';
import type { IndexResult } from '@zipbul/gildash';

import { isErr } from '@zipbul/result';

export interface GildashProviderOptions {
  projectRoot: string;
  extensions?: string[];
  ignorePatterns?: string[];
}

export class GildashProvider {
  private constructor(private readonly ledger: Gildash) {}

  static async open(options: GildashProviderOptions): Promise<GildashProvider> {
    const gildashOptions: Parameters<typeof Gildash.open>[0] = {
      projectRoot: options.projectRoot,
    };

    if (options.extensions !== undefined) {
      gildashOptions.extensions = options.extensions;
    }

    if (options.ignorePatterns !== undefined) {
      gildashOptions.ignorePatterns = options.ignorePatterns;
    }

    const result = await Gildash.open(gildashOptions);

    if (isErr(result)) {
      throw new Error(result.data.message, { cause: result.data.cause });
    }

    return new GildashProvider(result);
  }

  getDependencies(filePath: string): string[] {
    const result = this.ledger.getDependencies(filePath);

    if (isErr(result)) {
      throw new Error(result.data.message, { cause: result.data.cause });
    }

    return result;
  }

  getDependents(filePath: string): string[] {
    const result = this.ledger.getDependents(filePath);

    if (isErr(result)) {
      throw new Error(result.data.message, { cause: result.data.cause });
    }

    return result;
  }

  async getAffected(changedFiles: string[]): Promise<string[]> {
    const result = await this.ledger.getAffected(changedFiles);

    if (isErr(result)) {
      throw new Error(result.data.message, { cause: result.data.cause });
    }

    return result;
  }

  async hasCycle(): Promise<boolean> {
    const result = await this.ledger.hasCycle();

    if (isErr(result)) {
      throw new Error(result.data.message, { cause: result.data.cause });
    }

    return result;
  }

  onIndexed(callback: (result: IndexResult) => void): () => void {
    return this.ledger.onIndexed(callback);
  }

  async reindex(): Promise<void> {
    const result = await this.ledger.reindex();

    if (isErr(result)) {
      throw new Error(result.data.message, { cause: result.data.cause });
    }
  }

  async close(): Promise<void> {
    const result = await this.ledger.close();

    if (isErr(result)) {
      throw new Error(result.data.message, { cause: result.data.cause });
    }
  }
}
