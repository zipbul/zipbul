import { Gildash, GildashError, type GildashOptions } from '@zipbul/gildash';

import type { CliRendererLike } from '../bin/interfaces';

export interface OpenGildashWithFallbackParams {
  readonly options: GildashOptions;
  readonly renderer: CliRendererLike;
  readonly open?: (opts: GildashOptions) => Promise<Gildash>;
}

export interface OpenGildashWithFallbackResult {
  readonly ledger: Gildash;
  readonly semanticAvailable: boolean;
}

/**
 * Opens a Gildash instance with automatic fallback when semantic mode is
 * unavailable. Build and dev commands both need this exact retry: if
 * `semantic: true` throws `GildashError { type: 'semantic' }`, fall back to
 * the non-semantic open and surface a warning. Any other error is re-thrown.
 */
export async function openGildashWithFallback(
  params: OpenGildashWithFallbackParams,
): Promise<OpenGildashWithFallbackResult> {
  const open = params.open ?? ((opts: GildashOptions) => Gildash.open(opts));

  try {
    const ledger = await open({ ...params.options, semantic: true });
    return { ledger, semanticAvailable: true };
  } catch (e) {
    if (e instanceof GildashError && e.type === 'semantic') {
      params.renderer.warn(`Semantic mode unavailable, falling back: ${e.message}`);
      const ledger = await open({ ...params.options, semantic: false });
      return { ledger, semanticAvailable: false };
    }
    throw e;
  }
}
