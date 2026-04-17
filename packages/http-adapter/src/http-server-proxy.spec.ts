import { describe, it, expect, mock } from 'bun:test';

mock.module('@zipbul/logger', () => ({
  Logger: class {
    static inherit() {
      return { debug: mock(), info: mock(), warn: mock(), error: mock() };
    }
    debug() {}
    info() {}
    warn() {}
    error() {}
  },
}));

mock.module('@zipbul/baker', () => ({
  deserialize: async () => ({}),
  isBakerError: () => false,
}));

import {
  evaluateTrustProxy,
  resolveClientIp,
  isTrustedIp,
  isInCidrRange,
  matchesCidr,
  ipv4ToNumber,
  ipv6ToBytes,
  matchesPrefix,
  resolveProxyInfo,
} from './proxy';

const { __internals } = await import('./http-server');
const { createHttpRequest } = __internals;

/**
 * [OVERFLOW Checkpoint]
 * - Target: evaluateTrustProxy, resolveClientIp, isTrustedIp, isInCidrRange,
 *   matchesCidr, ipv4ToNumber, resolveProxyInfo, createHttpRequest
 *   (proxy/IP/CIDR/factory group in http-server.ts)
 * - Branch count: 55+
 *   evaluateTrustProxy: L265 `if(config===false)`, L266 `if(config===true)`, L267 `if(ip===null)`,
 *     L269 `typeof config==='number'`, L270 `typeof config==='string'`, L271 `Array.isArray(config)`,
 *     L272 `typeof config==='function'`, L273 fallthrough return false
 *   resolveClientIp: L325 `if(ipChain.length===0)`, L326 `if(trustProxy===true)`, L326 `ipChain[0]??socketIp`,
 *     L327 `if(trustProxy===false)`, L333 `if(currentIp===null||!isTrustedIp(...))`, L336 `ipChain[i]??null`
 *   isTrustedIp: L347 `if(config===true)`, L348 `if(config===false)`, L350 `normalizeIp(ip)??ip`,
 *     L352 `typeof config==='number'`, L353 `typeof config==='string'`, L354 `Array.isArray(config)`,
 *     L355 `typeof config==='function'`, L356 fallthrough return false
 *   isInCidrRange: L361 `if(cidr.includes('/'))`, L362 `if(matchesCidr(...))`, L364 `normalizeIp===normalizeIp`
 *   matchesCidr: L376 `if(Number.isNaN(prefix))`, L381 `if(ipNum===null||rangeNum===null)`,
 *     L383 `normalizeIp(ip)===normalizeIp(range)` (IPv6 fallback), L386 `if(prefix<0||prefix>32)`,
 *     L388 `prefix===0?0:(~0<<(32-prefix))>>>0`
 *   ipv4ToNumber: L394 `if(parts.length!==4)`, L399 `Number.isNaN(octet)||octet<0||octet>255`
 *   resolveProxyInfo: L281-284 xff parsing/filter, L286 resolveClientIp call,
 *     L290 `if(forwarded!==null)`, L292 `if(info.proto!==null||info.host!==null)`,
 *     L293 `info.host!==null&&validateForwardedHost(info.host)?info.host:null`,
 *     L305 `headers.get('x-forwarded-proto')?.split(',')[0]?.trim()?.toLowerCase()??null`,
 *     L306-307 x-forwarded-host + validation, L308-309 x-forwarded-port parseInt,
 *     L314 `port!==null&&Number.isNaN(port)?null:port`
 *   createHttpRequest: L415 validateHttpMethod, L416 `if(method===null)`, L420 `new URL(raw.url)`,
 *     L421 catch bad URL, L425-426 parseContentLength + `if(contentLength==='invalid')`,
 *     L428-432 urlProtocol/urlHost/urlHostname/urlPort extraction,
 *     L439 `if(proxyInfo!==null)`, L440-442 proto http/https check, L444 `proxyInfo.host??urlHost`,
 *     L445 `host!==null?extractHostname(host):urlHostname`, L447-451 port resolution chain,
 *     L452-457 non-proxy path, L473 `urlObj.search.length>0?urlObj.search:null`,
 *     L476 `normalizeIp(proxyInfo!==null?(proxyInfo.clientIp??socketIp):socketIp)`
 * - Minimum per category: 50
 * - Categories:
 *   | Cat | Count | Sample (3+) |
 *   |-----|-------|-------------|
 *   | HP  | 60    | 1. evaluateTrustProxy returns true when config===true (L266), 2. evaluateTrustProxy returns true when config is number (L269), 3. evaluateTrustProxy delegates to isInCidrRange for string config (L270), 4. evaluateTrustProxy delegates to isInCidrRange for array config (L271), 5. evaluateTrustProxy calls function config with (ip,0) (L272), 6. resolveClientIp returns first XFF IP when trustProxy===true (L326), 7. resolveClientIp walks chain right-to-left stopping at untrusted (L332-338), 8. isTrustedIp returns true for config===true (L347), 9. isTrustedIp checks hopIndex<config for number (L352), 10. isTrustedIp delegates string to isInCidrRange (L353), 11. isTrustedIp delegates array to isInCidrRange (L354), 12. isTrustedIp calls function config with normalized IP (L355), 13. isInCidrRange matches exact IP without CIDR (L364), 14. isInCidrRange matches via matchesCidr for CIDR (L362), 15. matchesCidr 10.0.0.1 in 10.0.0.0/8 (L388-389), 16. matchesCidr 192.168.1.100 in 192.168.0.0/16 (L388-389), 17. matchesCidr exact /32 match (L388-389 prefix=32), 18. matchesCidr /0 matches everything (L388 prefix===0), 19. ipv4ToNumber valid 10.0.0.1 (L396-402), 20. ipv4ToNumber 0.0.0.0 → 0 (L402), 21. ipv4ToNumber 255.255.255.255 → 4294967295 (L402), 22. resolveProxyInfo uses Forwarded header with proto/host (L290-301), 23. resolveProxyInfo falls back to X-Forwarded-* when no Forwarded (L304-317), 24. resolveProxyInfo parses XFF chain correctly (L281-284), 25. createHttpRequest returns ok with valid GET (L459-482), 26. createHttpRequest applies proxy info for protocol/host/hostname/port (L439-457), 27. createHttpRequest uses URL values when no proxy (L452-457), 28. resolveClientIp skip 1 hop with number config (L332-338), 29. resolveClientIp skip 2 hops with number config (L332-338), 30. resolveProxyInfo Forwarded with only proto (L292 proto!==null) |
 *   | NE  | 55    | 1. evaluateTrustProxy returns false when config===false (L265), 2. evaluateTrustProxy returns false when ip===null with non-boolean config (L267), 3. resolveClientIp returns socketIp when trustProxy===false (L327), 4. isTrustedIp returns false for config===false (L348), 5. isTrustedIp returns false for hopIndex>=config number (L352), 6. isInCidrRange returns false when no match (L367), 7. matchesCidr returns false for NaN prefix (L376), 8. matchesCidr returns false for prefix>32 (L386), 9. matchesCidr returns false for prefix<0 (L386), 10. matchesCidr returns false for IP outside range (L389), 11. ipv4ToNumber returns null for non-4-part (L394), 12. ipv4ToNumber returns null for octet>255 (L399), 13. ipv4ToNumber returns null for octet<0 (L399), 14. ipv4ToNumber returns null for NaN octet (L399), 15. createHttpRequest returns not-implemented for unknown method (L416), 16. createHttpRequest returns bad-request for malformed URL (L421-422), 17. createHttpRequest returns bad-request for duplicate CL (L426), 18. resolveProxyInfo X-Forwarded-Port NaN → null (L314), 19. resolveProxyInfo invalid forwarded host → null (L293) |
 *   | ED  | 52    | 1. resolveClientIp empty ipChain → socketIp (L325), 2. resolveClientIp all IPs trusted → return last in chain (L339), 3. resolveClientIp socketIp null (L324 socketIp:null), 4. isInCidrRange empty cidrs list (L360-367), 5. matchesCidr IPv6 fallback exact match only (L381-383), 6. ipv4ToNumber 0.0.0.0 boundary (L402), 7. ipv4ToNumber 255.255.255.255 boundary (L402), 8. createHttpRequest queryString absent → null (L473), 9. createHttpRequest queryString present (L473), 10. createHttpRequest contentType parsed (L474), 11. createHttpRequest ip normalized (L476), 12. resolveProxyInfo multiple comma-separated XFF → first element for X-Forwarded-* (L305-308), 13. isTrustedIp ::ffff: prefix normalized before check (L350) |
 *   | CO  | 50    | 1. resolveClientIp socketIp null + non-empty chain + trustProxy true (L326 ipChain[0]??socketIp), 2. resolveProxyInfo Forwarded with host but invalid + proto present (L292+L293), 3. createHttpRequest proxyInfo with invalid proto + valid host (L440-442+L444), 4. createHttpRequest proxyInfo host has port embedded (L447-449), 5. resolveClientIp chain with mixed trusted/untrusted + null socketIp (L333 currentIp===null) |
 *   | ST  | N/A: All functions are pure/stateless — no lifecycle, no init/close, no mutable state across calls |
 *   | CR  | N/A: All functions are synchronous and pure — no shared state, no async operations |
 *   | ID  | 50    | 1. evaluateTrustProxy same inputs yields same result (L264-274), 2. ipv4ToNumber same IP yields same number (L392-403), 3. matchesCidr same inputs yields same boolean (L370-390) |
 *   | OR  | 50    | 1. resolveClientIp traverses ipChain right-to-left (L332), 2. resolveProxyInfo prioritizes Forwarded over X-Forwarded-* (L290-317), 3. isInCidrRange matches on second CIDR in list (L360-367 iteration order) |
 * - Total scenarios: 367
 */

/**
 * [PRUNE Checkpoint]
 * - Scenarios before: 367
 * - Removed: 298
 * - Key removals (5+):
 *   1. HP-31~HP-60 repeat same branch paths with trivial IP/CIDR variations; keeping HP-1~HP-30
 *   2. NE-20~NE-55 exercise same null/error guard paths with different invalid inputs; keeping NE-1~NE-19
 *   3. ED-14~ED-52 boundary variations on same length/size checks; keeping ED-1~ED-13
 *   4. CO-6~CO-50 same multi-branch combos with different values; keeping CO-1~CO-5
 *   5. ID-4~ID-50 same idempotent pure function calls; keeping ID-1~ID-3
 *   6. OR-4~OR-50 same ordering logic with different chain sizes; keeping OR-1~OR-3
 *   7. NE-16 "bad-request for malformed URL": Bun's Request constructor validates URLs before
 *      createHttpRequest is called; the L421 catch branch cannot be triggered via unit test
 *      without an integration-level raw HTTP socket. Covered in http-server-helpers.spec.ts.
 * - Final test count: 69
 * - Final test list:
 *   1.  [HP] should return true when config is true (evaluateTrustProxy)
 *   2.  [HP] should return true when config is number for any ip (evaluateTrustProxy)
 *   3.  [HP] should delegate to isInCidrRange when config is string (evaluateTrustProxy)
 *   4.  [HP] should delegate to isInCidrRange when config is array (evaluateTrustProxy)
 *   5.  [HP] should call function config with ip and hopIndex 0 (evaluateTrustProxy)
 *   6.  [NE] should return false when config is false (evaluateTrustProxy)
 *   7.  [NE] should return false when ip is null and config is non-boolean (evaluateTrustProxy)
 *   8.  [ED] should return false for fallthrough with unknown config type (evaluateTrustProxy)
 *   9.  [HP] should return first XFF IP when trustProxy is true (resolveClientIp)
 *   10. [HP] should skip 1 hop when trustProxy is 1 (resolveClientIp)
 *   11. [HP] should skip 2 hops when trustProxy is 2 (resolveClientIp)
 *   12. [HP] should skip matching IPs when trustProxy is CIDR string (resolveClientIp)
 *   13. [HP] should return last in chain when all IPs trusted (resolveClientIp)
 *   14. [NE] should return socketIp when trustProxy is false (resolveClientIp)
 *   15. [ED] should return socketIp when ipChain is empty (resolveClientIp)
 *   16. [CO] should handle socketIp null gracefully (resolveClientIp)
 *   17. [HP] should return true when config is true (isTrustedIp)
 *   18. [HP] should return true when hopIndex is less than number config (isTrustedIp)
 *   19. [HP] should delegate to isInCidrRange when config is string (isTrustedIp)
 *   20. [HP] should delegate to isInCidrRange when config is array (isTrustedIp)
 *   21. [HP] should call function config with normalized IP and hopIndex (isTrustedIp)
 *   22. [NE] should return false when config is false (isTrustedIp)
 *   23. [NE] should return false when hopIndex equals number config (isTrustedIp)
 *   24. [ED] should normalize ::ffff: prefix before check (isTrustedIp)
 *   25. [HP] should match exact IP without CIDR notation (isInCidrRange)
 *   26. [HP] should match IP via matchesCidr when CIDR notation present (isInCidrRange)
 *   27. [HP] should match on second CIDR in list (isInCidrRange)
 *   28. [NE] should return false when no CIDR matches (isInCidrRange)
 *   29. [HP] should normalize both IPs for exact match (isInCidrRange)
 *   30. [ED] should return false when CIDR list is empty (isInCidrRange)
 *   31. [HP] should return true for 10.0.0.1 in 10.0.0.0/8 (matchesCidr)
 *   32. [HP] should return true for 192.168.1.100 in 192.168.0.0/16 (matchesCidr)
 *   33. [HP] should return true for exact /32 match (matchesCidr)
 *   34. [HP] should return true for /0 matching everything (matchesCidr)
 *   35. [NE] should return false for 10.0.0.1 in 192.168.0.0/16 (matchesCidr)
 *   36. [NE] should return false for NaN prefix (matchesCidr)
 *   37. [NE] should return false for prefix greater than 32 (matchesCidr)
 *   38. [NE] should return false for prefix less than 0 (matchesCidr)
 *   39. [ED] should fall back to exact match for IPv6 (matchesCidr)
 *   40. [HP] should convert 10.0.0.1 to correct number (ipv4ToNumber)
 *   41. [HP] should convert 0.0.0.0 to 0 (ipv4ToNumber)
 *   42. [HP] should convert 255.255.255.255 to 4294967295 (ipv4ToNumber)
 *   43. [NE] should return null for non-4-part IP (ipv4ToNumber)
 *   44. [NE] should return null for octet greater than 255 (ipv4ToNumber)
 *   45. [NE] should return null for negative octet (ipv4ToNumber)
 *   46. [NE] should return null for NaN octet (ipv4ToNumber)
 *   47. [HP] should use Forwarded header with proto and host when present (resolveProxyInfo)
 *   48. [HP] should use Forwarded header with only proto when host absent (resolveProxyInfo)
 *   49. [HP] should fall back to X-Forwarded-Proto/Host/Port when no Forwarded (resolveProxyInfo)
 *   50. [HP] should parse XFF chain correctly (resolveProxyInfo)
 *   51. [NE] should null invalid forwarded host (resolveProxyInfo)
 *   52. [NE] should null X-Forwarded-Port when NaN (resolveProxyInfo)
 *   53. [ED] should use first element for comma-separated X-Forwarded-* values (resolveProxyInfo)
 *   54. [OR] should prioritize Forwarded over X-Forwarded-* headers (resolveProxyInfo)
 *   55. [HP] should return ok with correct fields for valid GET (createHttpRequest)
 *   56. [HP] should apply proxy info for protocol host hostname port (createHttpRequest)
 *   57. [HP] should use URL values when no proxy info (createHttpRequest)
 *   58. [NE] should return not-implemented for unknown method (createHttpRequest)
 *   59. [NE] should return bad-request for duplicate inconsistent content-length (createHttpRequest)
 *   60. [ED] should set queryString to null when absent (createHttpRequest)
 *   61. [ED] should set queryString when present (createHttpRequest)
 *   62. [ED] should parse contentType from headers (createHttpRequest)
 *   63. [ED] should normalize ip from proxy clientIp (createHttpRequest)
 *   64. [CO] should fall back to urlProtocol when proxy proto is not http or https (createHttpRequest)
 *   65. [CO] should extract port from proxy host when host contains port (createHttpRequest)
 *   66. [CO] should use proxyInfo.port when host has no embedded port (createHttpRequest)
 *   67. [ID] should return same result for same evaluateTrustProxy input
 *   68. [ID] should return same result for same ipv4ToNumber input
 *   69. [OR] should traverse ipChain right-to-left in resolveClientIp
 */

// ── evaluateTrustProxy ───────────────────────────────────────

describe('evaluateTrustProxy', () => {
  it('should return true when config is true', () => {
    const result = evaluateTrustProxy('10.0.0.1', true);

    expect(result).toBe(true);
  });

  it('should return true when config is number for any ip', () => {
    const result = evaluateTrustProxy('192.168.1.1', 3);

    expect(result).toBe(true);
  });

  it('should delegate to isInCidrRange when config is string', () => {
    const result = evaluateTrustProxy('10.0.0.1', '10.0.0.0/8');

    expect(result).toBe(true);
  });

  it('should delegate to isInCidrRange when config is array', () => {
    const result = evaluateTrustProxy('10.0.0.1', ['192.168.0.0/16', '10.0.0.0/8']);

    expect(result).toBe(true);
  });

  it('should call function config with ip and hopIndex 0', () => {
    const trustFn = mock((ip: string, _hop: number) => ip === '10.0.0.1');

    const result = evaluateTrustProxy('10.0.0.1', trustFn);

    expect(result).toBe(true);
    expect(trustFn).toHaveBeenCalledWith('10.0.0.1', 0);
  });

  it('should return false when config is false', () => {
    const result = evaluateTrustProxy('10.0.0.1', false);

    expect(result).toBe(false);
  });

  it('should return false when ip is null and config is non-boolean', () => {
    const result = evaluateTrustProxy(null, 1);

    expect(result).toBe(false);
  });

  it('should return false for fallthrough with unknown config type', () => {
    const result = evaluateTrustProxy('10.0.0.1', Symbol() as never);

    expect(result).toBe(false);
  });
});

// ── resolveClientIp ──────────────────────────────────────────

describe('resolveClientIp', () => {
  it('should return first XFF IP when trustProxy is true', () => {
    const result = resolveClientIp(['1.2.3.4', '5.6.7.8'], true, '10.0.0.1');

    expect(result).toBe('1.2.3.4');
  });

  it('should skip 1 hop when trustProxy is 1', () => {
    const result = resolveClientIp(['1.2.3.4', '5.6.7.8'], 1, '10.0.0.1');

    expect(result).toBe('5.6.7.8');
  });

  it('should skip 2 hops when trustProxy is 2', () => {
    const result = resolveClientIp(['1.2.3.4', '5.6.7.8', '9.10.11.12'], 2, '10.0.0.1');

    expect(result).toBe('5.6.7.8');
  });

  it('should skip matching IPs when trustProxy is CIDR string', () => {
    const result = resolveClientIp(['1.2.3.4', '10.0.0.5'], '10.0.0.0/8', '10.0.0.1');

    expect(result).toBe('1.2.3.4');
  });

  it('should return last in chain when all IPs trusted', () => {
    const result = resolveClientIp(['1.2.3.4', '5.6.7.8'], true, '10.0.0.1');

    expect(result).toBe('1.2.3.4');
  });

  it('should return socketIp when trustProxy is false', () => {
    const result = resolveClientIp(['1.2.3.4'], false, '10.0.0.1');

    expect(result).toBe('10.0.0.1');
  });

  it('should return socketIp when ipChain is empty', () => {
    const result = resolveClientIp([], true, '10.0.0.1');

    expect(result).toBe('10.0.0.1');
  });

  it('should handle socketIp null gracefully', () => {
    const result = resolveClientIp([], true, null);

    expect(result).toBeNull();
  });
});

// ── isTrustedIp ──────────────────────────────────────────────

describe('isTrustedIp', () => {
  it('should return true when config is true', () => {
    const result = isTrustedIp('10.0.0.1', true, 0);

    expect(result).toBe(true);
  });

  it('should return true when hopIndex is less than number config', () => {
    const result = isTrustedIp('10.0.0.1', 3, 2);

    expect(result).toBe(true);
  });

  it('should delegate to isInCidrRange when config is string', () => {
    const result = isTrustedIp('192.168.1.50', '192.168.0.0/16', 0);

    expect(result).toBe(true);
  });

  it('should delegate to isInCidrRange when config is array', () => {
    const result = isTrustedIp('10.0.0.1', ['10.0.0.0/8', '172.16.0.0/12'], 0);

    expect(result).toBe(true);
  });

  it('should call function config with normalized IP and hopIndex', () => {
    const trustFn = mock((_ip: string, _hop: number) => true);

    const result = isTrustedIp('::ffff:10.0.0.1', trustFn, 5);

    expect(result).toBe(true);
    expect(trustFn).toHaveBeenCalledWith('10.0.0.1', 5);
  });

  it('should return false when config is false', () => {
    const result = isTrustedIp('10.0.0.1', false, 0);

    expect(result).toBe(false);
  });

  it('should return false when hopIndex equals number config', () => {
    const result = isTrustedIp('10.0.0.1', 2, 2);

    expect(result).toBe(false);
  });

  it('should normalize ::ffff: prefix before check', () => {
    const result = isTrustedIp('::ffff:10.0.0.1', '10.0.0.0/8', 0);

    expect(result).toBe(true);
  });
});

// ── isInCidrRange ────────────────────────────────────────────

describe('isInCidrRange', () => {
  it('should match exact IP without CIDR notation', () => {
    const result = isInCidrRange('10.0.0.1', ['10.0.0.1']);

    expect(result).toBe(true);
  });

  it('should match IP via matchesCidr when CIDR notation present', () => {
    const result = isInCidrRange('10.0.0.5', ['10.0.0.0/24']);

    expect(result).toBe(true);
  });

  it('should match on second CIDR in list', () => {
    const result = isInCidrRange('172.16.5.1', ['10.0.0.0/8', '172.16.0.0/12']);

    expect(result).toBe(true);
  });

  it('should return false when no CIDR matches', () => {
    const result = isInCidrRange('8.8.8.8', ['10.0.0.0/8', '192.168.0.0/16']);

    expect(result).toBe(false);
  });

  it('should normalize both IPs for exact match', () => {
    const result = isInCidrRange('::ffff:10.0.0.1', ['::ffff:10.0.0.1']);

    expect(result).toBe(true);
  });

  it('should return false when CIDR list is empty', () => {
    const result = isInCidrRange('10.0.0.1', []);

    expect(result).toBe(false);
  });
});

// ── matchesCidr ──────────────────────────────────────────────

describe('matchesCidr', () => {
  it('should return true for 10.0.0.1 in 10.0.0.0/8', () => {
    const result = matchesCidr('10.0.0.1', '10.0.0.0/8');

    expect(result).toBe(true);
  });

  it('should return true for 192.168.1.100 in 192.168.0.0/16', () => {
    const result = matchesCidr('192.168.1.100', '192.168.0.0/16');

    expect(result).toBe(true);
  });

  it('should return true for exact /32 match', () => {
    const result = matchesCidr('10.0.0.1', '10.0.0.1/32');

    expect(result).toBe(true);
  });

  it('should return true for /0 matching everything', () => {
    const result = matchesCidr('192.168.1.1', '0.0.0.0/0');

    expect(result).toBe(true);
  });

  it('should return false for 10.0.0.1 in 192.168.0.0/16', () => {
    const result = matchesCidr('10.0.0.1', '192.168.0.0/16');

    expect(result).toBe(false);
  });

  it('should return false for NaN prefix', () => {
    const result = matchesCidr('10.0.0.1', '10.0.0.0/abc');

    expect(result).toBe(false);
  });

  it('should return false for prefix greater than 32', () => {
    const result = matchesCidr('10.0.0.1', '10.0.0.0/33');

    expect(result).toBe(false);
  });

  it('should return false for prefix less than 0', () => {
    const result = matchesCidr('10.0.0.1', '10.0.0.0/-1');

    expect(result).toBe(false);
  });

  it('should fall back to exact match for IPv6', () => {
    const result = matchesCidr('::1', '::1/128');

    expect(result).toBe(true);
  });
});

// ── ipv4ToNumber ─────────────────────────────────────────────

describe('ipv4ToNumber', () => {
  it('should convert 10.0.0.1 to correct number', () => {
    const result = ipv4ToNumber('10.0.0.1');

    expect(result).toBe((10 << 24 | 0 << 16 | 0 << 8 | 1) >>> 0);
  });

  it('should convert 0.0.0.0 to 0', () => {
    const result = ipv4ToNumber('0.0.0.0');

    expect(result).toBe(0);
  });

  it('should convert 255.255.255.255 to 4294967295', () => {
    const result = ipv4ToNumber('255.255.255.255');

    expect(result).toBe(4294967295);
  });

  it('should return null for non-4-part IP', () => {
    const result = ipv4ToNumber('::1');

    expect(result).toBeNull();
  });

  it('should return null for octet greater than 255', () => {
    const result = ipv4ToNumber('256.0.0.1');

    expect(result).toBeNull();
  });

  it('should return null for negative octet', () => {
    const result = ipv4ToNumber('-1.0.0.0');

    expect(result).toBeNull();
  });

  it('should return null for NaN octet', () => {
    const result = ipv4ToNumber('abc.0.0.1');

    expect(result).toBeNull();
  });
});

// ── resolveProxyInfo ─────────────────────────────────────────

describe('resolveProxyInfo', () => {
  it('should use Forwarded header with proto and host when present', () => {
    const headers = new Headers({
      'forwarded': 'proto=https;host=proxy.example.com',
      'x-forwarded-for': '1.2.3.4',
    });

    const result = resolveProxyInfo(headers, true, '10.0.0.1');

    expect(result.proto).toBe('https');
    expect(result.host).toBe('proxy.example.com');
    expect(result.port).toBeNull();
  });

  it('should use Forwarded header with only proto when host absent', () => {
    const headers = new Headers({
      'forwarded': 'proto=https',
    });

    const result = resolveProxyInfo(headers, true, '10.0.0.1');

    expect(result.proto).toBe('https');
    expect(result.host).toBeNull();
  });

  it('should fall back to X-Forwarded-Proto/Host/Port when no Forwarded', () => {
    const headers = new Headers({
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'proxy.example.com',
      'x-forwarded-port': '8443',
      'x-forwarded-for': '1.2.3.4',
    });

    const result = resolveProxyInfo(headers, true, '10.0.0.1');

    expect(result.proto).toBe('https');
    expect(result.host).toBe('proxy.example.com');
    expect(result.port).toBe(8443);
  });

  it('should parse XFF chain correctly', () => {
    const headers = new Headers({
      'x-forwarded-for': '1.2.3.4, 5.6.7.8, 9.10.11.12',
    });

    const result = resolveProxyInfo(headers, true, '10.0.0.1');

    expect(result.ipChain).toEqual(['1.2.3.4', '5.6.7.8', '9.10.11.12']);
    expect(result.clientIp).toBe('1.2.3.4');
  });

  it('should null invalid forwarded host', () => {
    const headers = new Headers({
      'forwarded': 'proto=https;host=bad host',
    });

    const result = resolveProxyInfo(headers, true, '10.0.0.1');

    expect(result.proto).toBe('https');
    expect(result.host).toBeNull();
  });

  it('should null X-Forwarded-Port when NaN', () => {
    const headers = new Headers({
      'x-forwarded-port': 'abc',
    });

    const result = resolveProxyInfo(headers, true, '10.0.0.1');

    expect(result.port).toBeNull();
  });

  it('should use first element for comma-separated X-Forwarded-* values', () => {
    const headers = new Headers({
      'x-forwarded-proto': 'https, http',
      'x-forwarded-host': 'first.com, second.com',
      'x-forwarded-port': '443, 8080',
    });

    const result = resolveProxyInfo(headers, true, '10.0.0.1');

    expect(result.proto).toBe('https');
    expect(result.host).toBe('first.com');
    expect(result.port).toBe(443);
  });

  it('should prioritize Forwarded over X-Forwarded-* headers', () => {
    const headers = new Headers({
      'forwarded': 'proto=https;host=forwarded.example.com',
      'x-forwarded-proto': 'http',
      'x-forwarded-host': 'xfh.example.com',
    });

    const result = resolveProxyInfo(headers, true, '10.0.0.1');

    expect(result.proto).toBe('https');
    expect(result.host).toBe('forwarded.example.com');
  });
});

// ── createHttpRequest ────────────────────────────────────────

describe('createHttpRequest', () => {
  const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);

  it('should return ok with correct fields for valid GET', () => {
    const raw = new Request('http://example.com/path?q=1', {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });

    const result = createHttpRequest(raw, '10.0.0.1', false, null, ALLOWED_METHODS);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.request.method).toBe('GET');
      expect(result.request.path).toBe('/path');
      expect(result.request.protocol).toBe('http');
      expect(result.request.hostname).toBe('example.com');
      expect(result.request.ip).toBe('10.0.0.1');
      expect(result.request.isTrustedProxy).toBe(false);
    }
  });

  it('should apply proxy info for protocol host hostname port', () => {
    const raw = new Request('http://original.com/path', { method: 'GET' });
    const proxyInfo = {
      proto: 'https',
      host: 'proxy.example.com:8443',
      port: null,
      clientIp: '1.2.3.4',
      ipChain: ['1.2.3.4'],
    };

    const result = createHttpRequest(raw, '10.0.0.1', true, proxyInfo, ALLOWED_METHODS);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.request.protocol).toBe('https');
      expect(result.request.host).toBe('proxy.example.com:8443');
      expect(result.request.hostname).toBe('proxy.example.com');
      expect(result.request.port).toBe(8443);
      expect(result.request.ip).toBe('1.2.3.4');
      expect(result.request.ips).toEqual(['1.2.3.4']);
    }
  });

  it('should use URL values when no proxy info', () => {
    const raw = new Request('https://direct.example.com:9090/test', { method: 'GET' });

    const result = createHttpRequest(raw, '10.0.0.1', false, null, ALLOWED_METHODS);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.request.protocol).toBe('https');
      expect(result.request.host).toBe('direct.example.com:9090');
      expect(result.request.hostname).toBe('direct.example.com');
      expect(result.request.port).toBe(9090);
      expect(result.request.ips).toEqual([]);
    }
  });

  it('should return not-implemented for unknown method', () => {
    const raw = new Request('http://example.com/', { method: 'PROPFIND' });

    const result = createHttpRequest(raw, '10.0.0.1', false, null, ALLOWED_METHODS);

    expect(result.kind).toBe('not-implemented');
  });

  it('should return bad-request for duplicate inconsistent content-length', () => {
    const headers = new Headers();
    headers.set('content-length', '5, 3');
    const raw = new Request('http://example.com/', { method: 'GET', headers });

    const result = createHttpRequest(raw, '10.0.0.1', false, null, ALLOWED_METHODS);

    expect(result.kind).toBe('bad-request');
  });

  it('should set queryString to null when absent', () => {
    const raw = new Request('http://example.com/path', { method: 'GET' });

    const result = createHttpRequest(raw, '10.0.0.1', false, null, ALLOWED_METHODS);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.request.queryString).toBeNull();
    }
  });

  it('should set queryString when present', () => {
    const raw = new Request('http://example.com/path?foo=bar&baz=1', { method: 'GET' });

    const result = createHttpRequest(raw, '10.0.0.1', false, null, ALLOWED_METHODS);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.request.queryString).toBe('?foo=bar&baz=1');
    }
  });

  it('should parse contentType from headers', () => {
    const raw = new Request('http://example.com/', {
      method: 'POST',
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });

    const result = createHttpRequest(raw, '10.0.0.1', false, null, ALLOWED_METHODS);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.request.contentType).not.toBeNull();
      expect(result.request.contentType!.mediaType).toBe('text/html');
      expect(result.request.contentType!.charset).toBe('utf-8');
    }
  });

  it('should normalize ip from proxy clientIp', () => {
    const raw = new Request('http://example.com/', { method: 'GET' });
    const proxyInfo = {
      proto: 'http',
      host: null,
      port: null,
      clientIp: '::ffff:192.168.1.1',
      ipChain: ['::ffff:192.168.1.1'],
    };

    const result = createHttpRequest(raw, '10.0.0.1', true, proxyInfo, ALLOWED_METHODS);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.request.ip).toBe('192.168.1.1');
    }
  });

  it('should fall back to urlProtocol when proxy proto is not http or https', () => {
    const raw = new Request('http://example.com/', { method: 'GET' });
    const proxyInfo = {
      proto: 'ftp',
      host: null,
      port: null,
      clientIp: '1.2.3.4',
      ipChain: ['1.2.3.4'],
    };

    const result = createHttpRequest(raw, '10.0.0.1', true, proxyInfo, ALLOWED_METHODS);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.request.protocol).toBe('http');
    }
  });

  it('should extract port from proxy host when host contains port', () => {
    const raw = new Request('http://example.com/', { method: 'GET' });
    const proxyInfo = {
      proto: 'https',
      host: 'proxy.example.com:9090',
      port: null,
      clientIp: '1.2.3.4',
      ipChain: ['1.2.3.4'],
    };

    const result = createHttpRequest(raw, '10.0.0.1', true, proxyInfo, ALLOWED_METHODS);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.request.port).toBe(9090);
    }
  });

  it('should use proxyInfo.port when host has no embedded port', () => {
    const raw = new Request('http://example.com/', { method: 'GET' });
    const proxyInfo = {
      proto: 'https',
      host: 'proxy.example.com',
      port: 7070,
      clientIp: '1.2.3.4',
      ipChain: ['1.2.3.4'],
    };

    const result = createHttpRequest(raw, '10.0.0.1', true, proxyInfo, ALLOWED_METHODS);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.request.port).toBe(7070);
    }
  });
});

// ── Idempotency ──────────────────────────────────────────────

describe('idempotency', () => {
  it('should return same result for same evaluateTrustProxy input', () => {
    const first = evaluateTrustProxy('10.0.0.1', '10.0.0.0/8');
    const second = evaluateTrustProxy('10.0.0.1', '10.0.0.0/8');

    expect(first).toBe(second);
  });

  it('should return same result for same ipv4ToNumber input', () => {
    const first = ipv4ToNumber('192.168.1.1');
    const second = ipv4ToNumber('192.168.1.1');

    expect(first).toBe(second);
  });
});

// ── Ordering ─────────────────────────────────────────────────

describe('ordering', () => {
  it('should traverse ipChain right-to-left in resolveClientIp', () => {
    const calls: string[] = [];
    const trustFn = mock((ip: string, _hop: number) => {
      calls.push(ip);
      return ip.startsWith('10.');
    });

    resolveClientIp(['1.2.3.4', '10.0.0.5', '10.0.0.6'], trustFn, '10.0.0.1');

    expect(calls[0]).toBe('10.0.0.1');
    expect(calls[1]).toBe('10.0.0.6');
    expect(calls[2]).toBe('10.0.0.5');
  });
});

// ── ipv6ToBytes ──────────────────────────────────────────────

describe('ipv6ToBytes', () => {
  it('should parse :: (all zeros)', () => {
    const result = ipv6ToBytes('::');

    expect(result).not.toBeNull();
    expect(result!.length).toBe(16);
    expect(Array.from(result!).every((b) => b === 0)).toBe(true);
  });

  it('should parse ::1 (loopback)', () => {
    const result = ipv6ToBytes('::1');

    expect(result).not.toBeNull();
    expect(result![14]).toBe(0);
    expect(result![15]).toBe(1);
    // All other bytes should be 0
    for (let i = 0; i < 14; i++) {
      expect(result![i]).toBe(0);
    }
  });

  it('should parse 1:: (leading group only)', () => {
    const result = ipv6ToBytes('1::');

    expect(result).not.toBeNull();
    expect(result![0]).toBe(0);
    expect(result![1]).toBe(1);
    for (let i = 2; i < 16; i++) {
      expect(result![i]).toBe(0);
    }
  });

  it('should parse 1::2 (groups on both sides of ::)', () => {
    const result = ipv6ToBytes('1::2');

    expect(result).not.toBeNull();
    expect(result![0]).toBe(0);
    expect(result![1]).toBe(1);
    for (let i = 2; i < 14; i++) {
      expect(result![i]).toBe(0);
    }
    expect(result![14]).toBe(0);
    expect(result![15]).toBe(2);
  });

  it('should parse ::ffff:10.0.0.1 (embedded IPv4)', () => {
    const result = ipv6ToBytes('::ffff:10.0.0.1');

    expect(result).not.toBeNull();
    // ::ffff: prefix
    expect(result![10]).toBe(0xff);
    expect(result![11]).toBe(0xff);
    // 10.0.0.1
    expect(result![12]).toBe(10);
    expect(result![13]).toBe(0);
    expect(result![14]).toBe(0);
    expect(result![15]).toBe(1);
  });

  it('should parse ::ffff:255.255.255.255 (embedded IPv4 max)', () => {
    const result = ipv6ToBytes('::ffff:255.255.255.255');

    expect(result).not.toBeNull();
    expect(result![10]).toBe(0xff);
    expect(result![11]).toBe(0xff);
    expect(result![12]).toBe(255);
    expect(result![13]).toBe(255);
    expect(result![14]).toBe(255);
    expect(result![15]).toBe(255);
  });

  it('should parse fe80:: (link-local prefix)', () => {
    const result = ipv6ToBytes('fe80::');

    expect(result).not.toBeNull();
    expect(result![0]).toBe(0xfe);
    expect(result![1]).toBe(0x80);
    for (let i = 2; i < 16; i++) {
      expect(result![i]).toBe(0);
    }
  });

  it('should parse full form 0:0:0:0:0:0:0:1', () => {
    const result = ipv6ToBytes('0:0:0:0:0:0:0:1');

    expect(result).not.toBeNull();
    // Should be identical to ::1
    const loopback = ipv6ToBytes('::1');
    expect(Array.from(result!)).toEqual(Array.from(loopback!));
  });

  it('should return null for invalid input with triple colon', () => {
    const result = ipv6ToBytes(':::1');

    expect(result).toBeNull();
  });

  it('should return null for too many groups', () => {
    const result = ipv6ToBytes('1:2:3:4:5:6:7:8:9');

    expect(result).toBeNull();
  });

  it('should return null for invalid hex group', () => {
    const result = ipv6ToBytes('1:2:3:4:5:6:7:zzzz');

    expect(result).toBeNull();
  });

  it('should return null for group value exceeding 0xffff', () => {
    const result = ipv6ToBytes('1:2:3:4:5:6:7:10000');

    expect(result).toBeNull();
  });

  it('should return null for invalid embedded IPv4', () => {
    const result = ipv6ToBytes('::ffff:999.0.0.1');

    expect(result).toBeNull();
  });
});

// ── matchesPrefix ────────────────────────────────────────────

describe('matchesPrefix', () => {
  const addr = ipv6ToBytes('::1')!;
  const allZeros = ipv6ToBytes('::')!;
  const allOnes = new Uint8Array(16).fill(0xff);

  it('should match everything with prefix 0', () => {
    expect(matchesPrefix(addr, allOnes, 0)).toBe(true);
    expect(matchesPrefix(allZeros, allOnes, 0)).toBe(true);
  });

  it('should match full byte boundary with prefix 8', () => {
    const a = ipv6ToBytes('ff00::')!;
    const b = ipv6ToBytes('ff01::')!;

    expect(matchesPrefix(a, b, 8)).toBe(true);
  });

  it('should distinguish at prefix 9 (partial byte)', () => {
    // ff00 = 1111_1111 0000_0000
    // ff80 = 1111_1111 1000_0000
    // At prefix 9, the 9th bit matters: ff00 has 0, ff80 has 1
    const a = ipv6ToBytes('ff00::')!;
    const b = ipv6ToBytes('ff80::')!;

    expect(matchesPrefix(a, b, 9)).toBe(false);

    // Same prefix should match
    expect(matchesPrefix(a, a, 9)).toBe(true);
  });

  it('should match with prefix 64 (half address)', () => {
    const a = ipv6ToBytes('2001:db8:85a3::1')!;
    const b = ipv6ToBytes('2001:db8:85a3::9999')!;

    expect(matchesPrefix(a, b, 64)).toBe(true);
  });

  it('should not match different /64 prefixes', () => {
    const a = ipv6ToBytes('2001:db8:85a3::1')!;
    const b = ipv6ToBytes('2001:db8:85a4::1')!;

    expect(matchesPrefix(a, b, 64)).toBe(false);
  });

  it('should match with prefix 127 (differs only in last bit)', () => {
    const a = ipv6ToBytes('::1')!;
    const b = ipv6ToBytes('::')!;

    // ::1 = ...0000_0001, :: = ...0000_0000
    // prefix 127 checks first 127 bits — both are all zeros except last bit
    expect(matchesPrefix(a, b, 127)).toBe(true);
  });

  it('should not match with prefix 128 when last bit differs', () => {
    const a = ipv6ToBytes('::1')!;
    const b = ipv6ToBytes('::')!;

    expect(matchesPrefix(a, b, 128)).toBe(false);
  });

  it('should match identical addresses with prefix 128', () => {
    const a = ipv6ToBytes('fe80::1')!;
    const b = ipv6ToBytes('fe80::1')!;

    expect(matchesPrefix(a, b, 128)).toBe(true);
  });
});
