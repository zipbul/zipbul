import type { MikroOrmErrorReason } from './enums';

/** Payload for a {@link import('./errors').MikroOrmError}, mirroring the framework `*ErrorData` shape. */
export interface MikroOrmErrorData {
  readonly reason: MikroOrmErrorReason;
  readonly message: string;
}
