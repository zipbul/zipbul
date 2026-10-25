/**
 * Internal marker that identifies an {@link Err}. It is both the runtime tag
 * set by `err()` and the type brand on `Err`. Not exported from the package.
 *
 * `Symbol.for` keeps detection working across package copies and realms.
 */
export const ERR: unique symbol = Symbol.for('@zipbul/result');
