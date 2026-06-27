import { Baker } from '@zipbul/baker';

/**
 * The application-scoped baker.
 *
 * baker 5.x has no global `seal`/`Recipe` — every `@Recipe` class belongs to a
 * `Baker` instance. This is the single instance the framework owns for
 * application DTOs: handler body/param schemas register through {@link Recipe},
 * and {@link Application} calls `appBaker.seal()` once at startup (before
 * pipeline initialization) so every app DTO is sealed before any handler
 * deserializes.
 *
 * Middleware libraries do NOT use this — each owns its own `new Baker()` and
 * seals its own option DTOs. baker 5.1 scopes `deserialize`/`validate` to the
 * instance too, so app handler DTOs run through `appBaker.deserialize` (in the
 * adapter) while each middleware runs its own schema through its own baker.
 */
export const appBaker = new Baker();

/**
 * Application-scoped `@Recipe` — registers a DTO class with {@link appBaker}.
 * Use on handler DTOs: `@Recipe class CreateUserDto { @Field(isString) name!: string }`.
 */
export const Recipe = appBaker.Recipe;
