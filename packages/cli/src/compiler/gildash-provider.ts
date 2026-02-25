import { Gildash } from '@zipbul/gildash';
import type { IndexResult } from '@zipbul/gildash';

import type { Result } from '@zipbul/result';
import type { Diagnostic } from '../diagnostics';

import { err, isErr } from '@zipbul/result';
import { buildDiagnostic } from '../diagnostics';

export interface GildashProviderOptions {
  projectRoot: string;
  extensions?: string[];
  ignorePatterns?: string[];
}

export class GildashProvider {
  private constructor(private readonly ledger: Gildash) {}

  static async open(options: GildashProviderOptions): Promise<Result<GildashProvider, Diagnostic>> {
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
      return err(buildDiagnostic({
        reason: result.data.message,
        cause: result.data,
      }));
    }

    return new GildashProvider(result);
  }

  getDependencies(filePath: string): Result<string[], Diagnostic> {
    const result = this.ledger.getDependencies(filePath);

    if (isErr(result)) {
      return err(buildDiagnostic({
        reason: result.data.message,
        cause: result.data,
      }));
    }

    return result;
  }

  getDependents(filePath: string): Result<string[], Diagnostic> {
    const result = this.ledger.getDependents(filePath);

    if (isErr(result)) {
      return err(buildDiagnostic({
        reason: result.data.message,
        cause: result.data,
      }));
    }

    return result;
  }

  async getAffected(changedFiles: string[]): Promise<Result<string[], Diagnostic>> {
    const result = await this.ledger.getAffected(changedFiles);

    if (isErr(result)) {
      return err(buildDiagnostic({
        reason: result.data.message,
        cause: result.data,
      }));
    }

    return result;
  }

  async hasCycle(): Promise<Result<boolean, Diagnostic>> {
    const result = await this.ledger.hasCycle();

    if (isErr(result)) {
      return err(buildDiagnostic({
        reason: result.data.message,
        cause: result.data,
      }));
    }

    return result;
  }

  onIndexed(callback: (result: IndexResult) => void): () => void {
    return this.ledger.onIndexed(callback);
  }

  async reindex(): Promise<Result<void, Diagnostic>> {
    const result = await this.ledger.reindex();

    if (isErr(result)) {
      return err(buildDiagnostic({
        reason: result.data.message,
        cause: result.data,
      }));
    }
  }

  async close(): Promise<Result<void, Diagnostic>> {
    const result = await this.ledger.close();

    if (isErr(result)) {
      return err(buildDiagnostic({
        reason: result.data.message,
        cause: result.data,
      }));
    }
  }
}
