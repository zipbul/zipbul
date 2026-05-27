/**
 * Test preload — pulls the cors package entry so its top-level
 * `configure()` + `seal()` runs once before any spec executes.
 *
 * `seal()` is idempotent and module evaluation is cached, so this preload is
 * effectively a no-op after the first import. Specs that exercise
 * `Cors.create` must reach validated state and this guarantees it.
 */
import '../index';
