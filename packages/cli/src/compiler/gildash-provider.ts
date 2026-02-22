import { Gildash } from '@zipbul/gildash';
import type { IndexResult } from '@zipbul/gildash';

export interface GildashProviderOptions {
  projectRoot: string;
  extensions?: string[];
  ignorePatterns?: string[];
}

export class GildashProvider {
  private constructor(private readonly ledger: Gildash) {}

  static async open(options: GildashProviderOptions): Promise<GildashProvider> {
    const ledger = await Gildash.open({
      projectRoot: options.projectRoot,
      extensions: options.extensions,
      ignorePatterns: options.ignorePatterns,
    });

    return new GildashProvider(ledger);
  }

  getDependencies(filePath: string): string[] {
    return this.ledger.getDependencies(filePath);
  }

  getDependents(filePath: string): string[] {
    return this.ledger.getDependents(filePath);
  }

  async getAffected(changedFiles: string[]): Promise<string[]> {
    return this.ledger.getAffected(changedFiles);
  }

  async hasCycle(): Promise<boolean> {
    return this.ledger.hasCycle();
  }

  onIndexed(callback: (result: IndexResult) => void): () => void {
    return this.ledger.onIndexed(callback);
  }

  async close(): Promise<void> {
    return this.ledger.close();
  }
}
