import type { Options } from '@mikro-orm/core';

import type { ConnectionName } from '../connection';

/**
 * Options a {@link MikroOrmService} subclass supplies. Extends MikroORM's native `Options` (as
 * `Partial`, matching the official `init`/`defineConfig` contract — the all-required `Options` is
 * not satisfiable by any real config) with an optional logical connection name for multiple named
 * connections.
 */
export interface ZipbulMikroOrmOptions extends Partial<Options> {
  readonly connection?: ConnectionName;
}
