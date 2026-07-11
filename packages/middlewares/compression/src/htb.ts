/**
 * Heal-the-BREACH (HTB) — injects random-length padding into compressed
 * output so that sizes vary between requests, defeating BREACH oracle attacks.
 *
 * Gzip: padding in FEXTRA field (RFC 1952 §2.3.1).
 * Zstd: prepended Skippable Frame (RFC 8878 §3.1.2).
 *
 * The padding is transparent to any RFC-compliant decompressor.
 */

const GZIP_HEADER_SIZE = 10;
const FEXTRA_FLAG = 0x04;
const MAX_XLEN = 0xffff; // 16-bit max for gzip XLEN field

// RFC 1952 §2.3.1: FEXTRA subfield header (SI1, SI2, LEN)
const SUBFIELD_HEADER_SIZE = 4; // SI1(1) + SI2(1) + LEN(2)
const SUBFIELD_SI1 = 0x5a; // 'Z'
const SUBFIELD_SI2 = 0x50; // 'P' — "ZP" identifies zipbul padding

/** Bias-free CSPRNG integer in [1, maxPadding] via rejection sampling. */
const rngBuf = new Uint32Array(1);
function randomPadLen(maxPadding: number): number {
  const limit = 0x100000000 - (0x100000000 % maxPadding);
  let value: number;
  do {
    crypto.getRandomValues(rngBuf);
    // rngBuf has length 1 → index 0 always exists (satisfies noUncheckedIndexedAccess).
    value = rngBuf[0]!;
  } while (value >= limit);
  return 1 + (value % maxPadding);
}

/** Writes a proper RFC 1952 subfield: SI1 SI2 LEN(le16) data. */
function writeSubfield(target: Uint8Array, offset: number, dataLen: number): void {
  target[offset] = SUBFIELD_SI1;
  target[offset + 1] = SUBFIELD_SI2;
  target[offset + 2] = dataLen & 0xff;
  target[offset + 3] = (dataLen >> 8) & 0xff;
}

export function injectGzipPadding(compressed: Uint8Array, maxPadding: number): Uint8Array {
  const padLen = randomPadLen(maxPadding);
  const subfieldTotal = SUBFIELD_HEADER_SIZE + padLen; // total bytes added to extra field
  // gzip output is always ≥10 bytes, so the FLG byte (index 3) always exists.
  const flagByte = compressed[3]!;
  const hasFExtra = (flagByte & FEXTRA_FLAG) !== 0;

  if (hasFExtra) {
    // Existing FEXTRA: read current XLEN, append a new subfield
    // FEXTRA set ⇒ a well-formed gzip carries XLEN at bytes 10–11.
    const xlenLo = compressed[GZIP_HEADER_SIZE]!;
    const xlenHi = compressed[GZIP_HEADER_SIZE + 1]!;
    const existingXlen = xlenLo | (xlenHi << 8);
    const newXlen = existingXlen + subfieldTotal;

    // XLEN is a 16-bit field; if subfield would overflow, return unmodified copy
    if (newXlen > MAX_XLEN) return compressed.slice();

    const result = new Uint8Array(compressed.length + subfieldTotal);
    // Header (10 bytes)
    result.set(compressed.subarray(0, GZIP_HEADER_SIZE));
    // New XLEN
    result[GZIP_HEADER_SIZE] = newXlen & 0xff;
    result[GZIP_HEADER_SIZE + 1] = (newXlen >> 8) & 0xff;
    // Original extra data
    const extraStart = GZIP_HEADER_SIZE + 2;
    result.set(compressed.subarray(extraStart, extraStart + existingXlen), extraStart);
    // New subfield (SI1 SI2 LEN data) after existing extra data
    writeSubfield(result, extraStart + existingXlen, padLen);
    // Padding data (zero-filled by Uint8Array constructor)
    // Rest of compressed data
    const afterExtra = extraStart + existingXlen;
    result.set(compressed.subarray(afterExtra), extraStart + newXlen);

    return result;
  }

  // No existing FEXTRA: insert XLEN + subfield after header
  const result = new Uint8Array(compressed.length + 2 + subfieldTotal);
  // Header (10 bytes), set FEXTRA flag
  result.set(compressed.subarray(0, GZIP_HEADER_SIZE));
  result[3] = flagByte | FEXTRA_FLAG;
  // XLEN (little-endian)
  result[GZIP_HEADER_SIZE] = subfieldTotal & 0xff;
  result[GZIP_HEADER_SIZE + 1] = (subfieldTotal >> 8) & 0xff;
  // Subfield header
  writeSubfield(result, GZIP_HEADER_SIZE + 2, padLen);
  // Padding data (zero-filled by Uint8Array constructor)
  // Rest of compressed data
  result.set(compressed.subarray(GZIP_HEADER_SIZE), GZIP_HEADER_SIZE + 2 + subfieldTotal);

  return result;
}

const ZSTD_SKIPPABLE_MAGIC = 0x184d2a50;

export function injectZstdPadding(compressed: Uint8Array, maxPadding: number): Uint8Array {
  const padLen = randomPadLen(maxPadding);
  const frameOverhead = 8; // 4 bytes magic + 4 bytes frame size
  const result = new Uint8Array(compressed.length + frameOverhead + padLen);

  // 데이터 프레임을 먼저 두고 Skippable Frame을 뒤에 붙인다(trailing). RFC 8878 §3.1은
  // skippable frame을 어디에 두든 합법이나, 선두 배치는 일부 one-shot 디코더(node:zlib zstd)가
  // 첫 프레임만 읽고 멈춰 빈 출력을 낸다. 후미 배치는 그런 디코더도 데이터 프레임을 먼저
  // 복원하므로 상호운용성이 넓다. 길이 변화(=BREACH 완화)는 배치와 무관하게 동일하다.
  result.set(compressed, 0);
  const off = compressed.length;

  // Skippable Frame magic number (little-endian)
  result[off] = ZSTD_SKIPPABLE_MAGIC & 0xff;
  result[off + 1] = (ZSTD_SKIPPABLE_MAGIC >> 8) & 0xff;
  result[off + 2] = (ZSTD_SKIPPABLE_MAGIC >> 16) & 0xff;
  result[off + 3] = (ZSTD_SKIPPABLE_MAGIC >> 24) & 0xff;

  // User_Data size (little-endian)
  result[off + 4] = padLen & 0xff;
  result[off + 5] = (padLen >> 8) & 0xff;
  result[off + 6] = (padLen >> 16) & 0xff;
  result[off + 7] = (padLen >> 24) & 0xff;

  // Padding bytes after the frame header are zero-filled by the Uint8Array constructor.
  return result;
}
