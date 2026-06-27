import type { AbstractSqlPlatform } from '@mikro-orm/sql';

/** Abstract constructor bound, as required by the TS mixin pattern (single `any[]` rest param). */
// oxlint-disable-next-line no-explicit-any
export type AbstractPlatformCtor<T extends AbstractSqlPlatform> = abstract new (...args: any[]) => T;
