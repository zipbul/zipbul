import { Baker } from '@zipbul/baker';

/**
 * CORS-owned baker. baker 5.x scopes registration to an instance, so this
 * middleware owns the one that {@link CorsOptions} registers with (`@corsBaker.Recipe`)
 * and that {@link Cors.create} seals once on first use. Keeping it private to
 * the package means the app baker and other middlewares never collide with it;
 * `corsBaker.validateSync` runs against the executor this baker sealed.
 */
export const corsBaker = new Baker();
