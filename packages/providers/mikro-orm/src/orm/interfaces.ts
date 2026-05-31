import type { Options } from '@mikro-orm/core';

import type { ConnectionName } from '../connection';

/**
 * Options a {@link MikroOrmService} subclass supplies. Extends MikroORM's native
 * `Options` with an optional logical connection name (for multiple named connections).
 */
export interface ZipbulMikroOrmOptions extends Options {
  readonly connection?: ConnectionName;
}
