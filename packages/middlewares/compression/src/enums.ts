/**
 * Content codings that this compression middleware implements.
 *
 * Wire values match the IANA HTTP Content Coding Registry and are byte-for-byte
 * identical to the corresponding `ContentEncoding` members in `@zipbul/http-adapter`.
 *
 * `ContentEncoding.Identity` (no encoding) is intentionally excluded — the
 * middleware never *applies* identity; it skips compression entirely when
 * identity is the negotiated outcome.
 *
 * Adding a new codec requires explicitly extending this enum AND providing
 * a `BUFFER_COMPRESSORS` entry, a `DEFAULT_LEVELS` entry, and a `LEVEL_RANGES`
 * entry. This is intentional: the supported codec set is the single source of
 * truth, not a derivation from the wire-format registry.
 */
export enum CompressionCodec {
  Gzip = 'gzip',
  Br = 'br',
  Deflate = 'deflate',
  Zstd = 'zstd',
}

export enum CompressionErrorReason {
  InvalidThreshold = 'invalid_threshold',
  InvalidEncodings = 'invalid_encodings',
  InvalidLevel = 'invalid_level',
  EmptyEncodings = 'empty_encodings',
  InvalidBreach = 'invalid_breach',
}
