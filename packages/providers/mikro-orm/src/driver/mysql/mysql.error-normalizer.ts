import type { ErrorNormalizer } from '../../dialect';

/**
 * Normalizes Bun.SQL MySQL errors for MikroORM's official `MySqlExceptionConverter`,
 * which switches on `exception.errno` (1062 = unique violation, etc.). MySQL surfaces
 * `errno` natively, so this is largely a pass-through; kept as a class so the contract
 * has a per-DB home and any future alignment fix lands here.
 *
 * @internal
 */
export class MySqlErrorNormalizer implements ErrorNormalizer {
  normalize(error: unknown): unknown {
    // TODO(impl): verify Bun.SQL MySQL surfaces `.errno` exactly as MikroORM expects;
    // adjust here if a code/errno remap is needed.
    return error;
  }
}
