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
 * seals its own option DTOs. Runtime calls (`deserialize`/`validate`) are baker
 * instance methods in baker 5.2+, so each schema is run through the same baker
 * that sealed it: app DTOs via `appBaker.deserialize`, middleware DTOs via their
 * own baker instance.
 */
export const appBaker = new Baker();

/**
 * Application-scoped `@Recipe` — registers a DTO class with {@link appBaker}.
 * Use on handler DTOs: `@Recipe class CreateUserDto { @Field(isString) name!: string }`.
 */
export const Recipe = appBaker.Recipe;
