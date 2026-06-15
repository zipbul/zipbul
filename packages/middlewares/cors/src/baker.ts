import { Baker } from '@zipbul/baker';

/**
 * CORS-owned baker. baker 5.x scopes registration to an instance, so this
 * middleware owns the one that {@link CorsOptions} registers with (`@corsBaker.Recipe`)
 * and that {@link Cors.create} seals once on first use. Keeping it private to
 * the package means the app baker and other middlewares never collide with it;
 * `validateSync`/`deserialize` stay global and read the sealed executor off the
 * class regardless of which baker sealed it.
 */
export const corsBaker = new Baker();
