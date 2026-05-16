/**
 * HTTP content/transfer encodings (IANA HTTP Content Coding Registry).
 *
 * `Identity` means no encoding is applied (RFC 9110 §8.4.1).
 */
export enum ContentEncoding {
  Identity = 'identity',
  Gzip = 'gzip',
  Br = 'br',
  Deflate = 'deflate',
  Zstd = 'zstd',
}
