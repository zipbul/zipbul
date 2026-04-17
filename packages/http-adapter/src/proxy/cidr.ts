/**
 * CIDR matching utilities for IPv4 and IPv6 addresses.
 */

export function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    const octet = parseInt(part, 10);
    if (Number.isNaN(octet) || octet < 0 || octet > 255) return null;
    result = (result << 8) | octet;
  }
  return result >>> 0;
}

/**
 * Parses an IPv6 address string into a 16-byte Uint8Array.
 * Handles `::` zero-group expansion and embedded IPv4 (e.g. `::ffff:10.0.0.1`).
 *
 * @returns 16-byte array or null if the input is not a valid IPv6 address.
 */
export function ipv6ToBytes(ip: string): Uint8Array | null {
  // Handle embedded IPv4 suffix (e.g. ::ffff:10.0.0.1)
  const lastColon = ip.lastIndexOf(':');
  const tail = ip.slice(lastColon + 1);
  let ipv4Suffix: number | null = null;

  if (tail.includes('.')) {
    ipv4Suffix = ipv4ToNumber(tail);
    if (ipv4Suffix === null) return null;
    // Replace the IPv4 part with two 16-bit groups
    ip = ip.slice(0, lastColon + 1) +
      ((ipv4Suffix >>> 16) & 0xffff).toString(16) + ':' +
      (ipv4Suffix & 0xffff).toString(16);
  }

  const halves = ip.split('::');
  if (halves.length > 2) return null;

  const leftHalf = halves[0]!;
  const left = leftHalf.length > 0 ? leftHalf.split(':') : [];
  const right = halves.length === 2 && halves[1]!.length > 0 ? halves[1]!.split(':') : [];

  const totalGroups = left.length + right.length;
  if (halves.length === 1 && totalGroups !== 8) return null;
  if (halves.length === 2 && totalGroups > 7) return null;

  const zeroFill = 8 - totalGroups;
  const groups: string[] = [...left];
  for (let i = 0; i < zeroFill; i++) groups.push('0');
  groups.push(...right);

  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const val = parseInt(groups[i]!, 16);
    if (Number.isNaN(val) || val < 0 || val > 0xffff) return null;
    bytes[i * 2] = (val >>> 8) & 0xff;
    bytes[i * 2 + 1] = val & 0xff;
  }

  return bytes;
}

/**
 * Compares two 16-byte IPv6 addresses under a given prefix length.
 */
export function matchesPrefix(addr: Uint8Array, range: Uint8Array, prefix: number): boolean {
  const fullBytes = prefix >>> 3;

  for (let i = 0; i < fullBytes; i++) {
    if (addr[i] !== range[i]) return false;
  }

  const remainingBits = prefix & 7;
  if (remainingBits > 0) {
    const mask = (0xff << (8 - remainingBits)) & 0xff;
    if ((addr[fullBytes]! & mask) !== (range[fullBytes]! & mask)) return false;
  }

  return true;
}

export function isInCidrRange(ip: string, cidrs: readonly string[]): boolean {
  for (const cidr of cidrs) {
    if (cidr.includes('/')) {
      if (matchesCidr(ip, cidr)) return true;
    } else {
      if (normalizeIp(ip) === normalizeIp(cidr)) return true;
    }
  }
  return false;
}

export function matchesCidr(ip: string, cidr: string): boolean {
  const slashIndex = cidr.indexOf('/');
  const range = cidr.slice(0, slashIndex);
  const prefixStr = cidr.slice(slashIndex + 1);
  const prefix = parseInt(prefixStr, 10);

  if (Number.isNaN(prefix)) return false;

  const ipNum = ipv4ToNumber(ip);
  const rangeNum = ipv4ToNumber(range);

  if (ipNum !== null && rangeNum !== null) {
    if (prefix < 0 || prefix > 32) return false;
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (ipNum & mask) === (rangeNum & mask);
  }

  // IPv6 CIDR prefix matching
  const ipBytes = ipv6ToBytes(ip);
  const rangeBytes = ipv6ToBytes(range);

  if (ipBytes === null || rangeBytes === null) return false;
  if (prefix < 0 || prefix > 128) return false;

  return matchesPrefix(ipBytes, rangeBytes, prefix);
}

export function normalizeIp(ip: string | null): string | null {
  if (ip === null) return null;
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}
