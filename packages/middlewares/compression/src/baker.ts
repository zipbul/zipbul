import { Baker } from '@zipbul/baker';

/**
 * Compression-owned baker. baker 5.x scopes registration to an instance, so this
 * middleware owns the one that {@link CompressionOptionsSchema} registers with
 * (`@compressionBaker.Recipe`) and that `validateCompressionOptions` seals once on
 * first use. Keeping it package-private means the app baker and other middlewares
 * never collide with the schema; mirrors the cors/cookie/query-parser pattern.
 */
export const compressionBaker = new Baker();
