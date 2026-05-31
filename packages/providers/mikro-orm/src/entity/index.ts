/**
 * Modern (TC39 stage-3) ES entity decorators — single import surface.
 *
 * This is the ONE sanctioned function-export exception in the package: MikroORM's
 * decorators are factory functions and must be re-exported as-is. Wrapping them
 * would break MikroORM's metadata reflection and generic type inference.
 */
export * from '@mikro-orm/decorators/es';
