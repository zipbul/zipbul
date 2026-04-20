import { describe, it, expect, mock, spyOn } from 'bun:test';

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

// Direct imports from source modules
import { parseContentTypeInfo, parseParameters } from './content-type';
import { resolveRequestId, validateRequestId } from './request-id';
import { extractHostname, extractPort, defaultPortByProtocol } from './url-parts';
import { normalizeIp, validateForwardedHost, parseForwardedLast, evaluateTrustProxy, resolveProxyInfo, resolveClientIp, isTrustedIp, isInCidrRange, matchesCidr, ipv4ToNumber } from './proxy';
import { parseJsonBody } from './body';

// Runtime-only internals still accessed via __internals
const { __internals } = await import('./http-server');

const {
  parseContentLength,
  validateHttpMethod,
  resolveRawBody,
  createHttpRequest,
} = __internals;

/**
 * [OVERFLOW Checkpoint]
 * - Target: http-server.ts helper functions (parseContentTypeInfo, parseParameters,
 *   parseContentLength, resolveRequestId, validateRequestId, extractHostname,
 *   extractPort, defaultPortByProtocol, validateHttpMethod, normalizeIp,
 *   parseJsonBody, resolveRawBody, validateForwardedHost, parseForwardedLast,
 *   evaluateTrustProxy, resolveProxyInfo, resolveClientIp, isTrustedIp,
 *   isInCidrRange, matchesCidr, ipv4ToNumber, createHttpRequest)
 * - Branch count: 90+
 *   parseContentTypeInfo: L65 `if(raw===null||raw.length===0)`, L70 `if(mediaType.length===0)`,
 *     L73 `if(semicolonIndex!==-1)`, L77 `if(eqIndex===-1)`, L82 `if(value.startsWith('"')&&value.endsWith('"'))`,
 *     L91 `params.get('charset')?.toLowerCase()??null`, L92 `params.get('boundary')??null`
 *   parseParameters: L109 `if(escaped)`, L114 `if(char==='\\'&&inQuotes)`, L119 `if(char==='"')`,
 *     L124 `if(char===';'&&!inQuotes)`, L132 `if(current.length>0)`
 *   parseContentLength: L138 `if(raw===null||raw.length===0)`, L141 `if(raw.includes(','))`,
 *     L143-144 split+unique check, L146 `Number.isNaN(parsed)`, L150 `Number.isNaN(parsed)`
 *   resolveRequestId: L154 `if(options?.header!==undefined)`, L156 `if(headerValue!==null&&validateRequestId)`,
 *     L160 `if(options?.generate!==undefined)`, L163 fallback crypto.randomUUID
 *   validateRequestId: L170 `if(value.length===0||value.length>256)`, L173 `if(code<0x20||code>0x7e)`
 *   extractHostname: L179 `if(host.startsWith('['))`, L180 `closeBracket!==-1`, L183 `colonIndex!==-1`
 *   extractPort: L188 `if(host.startsWith('['))`, L189 `portSeparator!==-1`, L192 `colonIndex!==-1`
 *   defaultPortByProtocol: L197 `if(protocol==='https')`
 *   validateHttpMethod: L204 `allowedMethods.has(method)?...:null`
 *   normalizeIp: L208 `if(ip===null)`, L209 `ip.startsWith('::ffff:')`
 *   parseJsonBody: single return
 *   resolveRawBody: L219 `matchedRoute?.rawBody===true`
 *   validateForwardedHost: L223 `if(value.length===0||value.length>255)`, L225 `if(value.startsWith('[')&&!value.includes(']'))`,
 *     L228 `if(code<0x21||code>0x7e)`
 *   parseForwardedLast: L244 `if(eqIndex===-1)`, L250 `if(val.startsWith('"')&&val.endsWith('"'))`,
 *     L254 `if(key==='proto')`, L255 `else if(key==='host')`
 *   evaluateTrustProxy: L265 `if(config===false)`, L266 `if(config===true)`, L267 `if(ip===null)`,
 *     L269 `if(typeof config==='number')`, L270 `if(typeof config==='string')`,
 *     L271 `if(Array.isArray(config))`, L272 `if(typeof config==='function')`
 *   resolveProxyInfo: L281-284 xff parsing, L290 `if(forwarded!==null)`, L292 `if(info.proto||info.host)`,
 *     L293 validateForwardedHost, L305-314 X-Forwarded-* fallback
 *   resolveClientIp: L325 `if(ipChain.length===0)`, L326 `if(trustProxy===true)`,
 *     L327 `if(trustProxy===false)`, L333 `if(currentIp===null||!isTrustedIp)`, L336 `ipChain[i]??null`
 *   isTrustedIp: L347 `if(config===true)`, L348 `if(config===false)`, L352 `typeof config==='number'`,
 *     L353 `typeof config==='string'`, L354 `Array.isArray(config)`, L355 `typeof config==='function'`
 *   isInCidrRange: L361 `if(cidr.includes('/'))`, L362 `if(matchesCidr)`, L364 `normalizeIp===normalizeIp`
 *   matchesCidr: L376 `if(Number.isNaN(prefix))`, L381 `if(ipNum===null||rangeNum===null)`,
 *     L386 `if(prefix<0||prefix>32)`, L388 `prefix===0?0:...`
 *   ipv4ToNumber: L394 `if(parts.length!==4)`, L399 `Number.isNaN(octet)||octet<0||octet>255`
 *   createHttpRequest: L416 `if(method===null)`, L421 `catch(URL error)`, L426 `if(contentLength==='invalid')`,
 *     L439 `if(proxyInfo!==null)`, L440-442 proto check, L444-451 host/hostname/port proxy path,
 *     L452-456 non-proxy path
 * - Minimum per category: 50
 * - Categories:
 *   | Cat | Count | Sample (3+) |
 *   |-----|-------|-------------|
 *   | HP  | 55    | 1. parseContentTypeInfo returns mediaType+charset for `text/html; charset=utf-8` (http-server.ts L68,L82,L91), 2. parseParameters splits simple semicolon-separated pairs (L124), 3. parseContentLength returns number for valid header (L149-150), 4. resolveRequestId uses header value when valid (L154-158), 5. extractHostname returns hostname from host:port (L183-184), 6. defaultPortByProtocol returns 443 for https (L197), 7. validateHttpMethod returns method when in set (L204), 8. normalizeIp strips ::ffff: prefix (L209), 9. parseJsonBody returns parsed value (L215), 10. resolveRawBody returns true when rawBody is true (L219), 11. validateForwardedHost returns true for valid hostname (L230), 12. parseForwardedLast extracts proto and host from last element (L238-258), 13. evaluateTrustProxy returns true when config is true (L266), 14. resolveProxyInfo uses Forwarded header when present (L290-301), 15. resolveClientIp returns first XFF when trustProxy is true (L326), 16. isTrustedIp returns true for number config within hop range (L352), 17. isInCidrRange matches exact IP (L364), 18. matchesCidr returns true for IP in CIDR range (L388-389), 19. ipv4ToNumber converts valid IPv4 (L396-402), 20. createHttpRequest returns ok with valid request (L459-482) |
 *   | NE  | 52    | 1. parseContentTypeInfo returns null for null input (L65), 2. parseContentLength returns null for NaN (L150), 3. validateRequestId returns false for control chars (L173), 4. validateHttpMethod returns null for unknown method (L204), 5. createHttpRequest returns not-implemented for bad method (L416), 6. createHttpRequest returns bad-request for invalid URL (L421-422), 7. createHttpRequest returns bad-request for inconsistent content-length (L426), 8. evaluateTrustProxy returns false for null IP with non-boolean config (L267), 9. matchesCidr returns false for NaN prefix (L376), 10. ipv4ToNumber returns null for non-4-part IP (L394) |
 *   | ED  | 53    | 1. parseContentTypeInfo with empty string (L65 raw.length===0), 2. validateRequestId with empty string (L170 value.length===0), 3. validateRequestId with exactly 256 chars (L170 boundary), 4. validateRequestId with 257 chars (L170 value.length>256), 5. parseContentLength with empty header value (L138), 6. extractHostname with IPv6 no close bracket (L180-181), 7. validateForwardedHost with empty string (L223), 8. validateForwardedHost with exactly 255 chars (L223 boundary), 9. validateForwardedHost with 256 chars (L223 >255), 10. matchesCidr with prefix=0 (L388 prefix===0), 11. matchesCidr with prefix=32 (L386 boundary), 12. matchesCidr with prefix=33 (L386 >32), 13. parseParameters with empty input (L132 current.length>0) |
 *   | CO  | 50    | 1. parseContentTypeInfo with empty mediaType after trim and params present (L70 mediaType.length===0), 2. parseContentLength with duplicate inconsistent then NaN (L144+L146), 3. resolveRequestId with header set but invalid then generate function (L156+L160), 4. createHttpRequest with proxy info having invalid proto and valid host (L440-442+L444), 5. resolveProxyInfo with Forwarded header having only host but invalid (L292+L293) |
 *   | ST  | N/A: All helper functions are pure/stateless — no lifecycle, no init/close, no mutable state across calls |
 *   | CR  | N/A: All helper functions are synchronous and pure — no shared state, no async operations |
 *   | ID  | 52    | 1. parseContentTypeInfo same input yields same result (L64-95), 2. normalizeIp same input yields same result (L207-210), 3. ipv4ToNumber same IP yields same number (L392-403) |
 *   | OR  | 50    | 1. parseForwardedLast uses last comma-separated element (L238-239), 2. resolveClientIp traverses ipChain right-to-left (L332), 3. resolveProxyInfo prioritizes Forwarded over X-Forwarded-* (L290-317) |
 * - Total scenarios: 362
 */

/**
 * [PRUNE Checkpoint]
 * - Scenarios before: 362
 * - Removed: 256
 * - Key removals (5+):
 *   1. HP-21~HP-55 repeat same parsing paths with trivial value variations; keeping HP-1~HP-20
 *   2. NE-11~NE-52 exercise same null/error guard paths with different inputs; keeping NE-1~NE-10
 *   3. ED-14~ED-53 boundary variations on same length/size checks; keeping ED-1~ED-13
 *   4. CO-6~CO-50 same multi-branch combinations with different values; keeping CO-1~CO-5
 *   5. ID-4~ID-52 same idempotent pure function calls; keeping ID-1~ID-3
 *   6. OR-4~OR-50 same ordering logic with different chain sizes; keeping OR-1~OR-3
 * - Final test count: 106
 * - Final test list:
 *   1.  [HP] should return mediaType and charset when content-type has charset param (parseContentTypeInfo)
 *   2.  [HP] should return mediaType and boundary when content-type is multipart with boundary (parseContentTypeInfo)
 *   3.  [HP] should unquote quoted-string param values (parseContentTypeInfo)
 *   4.  [HP] should lowercase mediaType and charset (parseContentTypeInfo)
 *   5.  [HP] should parse multiple params (parseContentTypeInfo)
 *   6.  [HP] should return mediaType only when no params present (parseContentTypeInfo)
 *   7.  [HP] should unescape backslash-escaped chars in quoted values (parseContentTypeInfo)
 *   8.  [HP] should split simple semicolon-separated pairs (parseParameters)
 *   9.  [HP] should preserve semicolons inside quoted values (parseParameters)
 *   10. [HP] should handle escaped backslash in quotes (parseParameters)
 *   11. [HP] should return single element when no semicolons (parseParameters)
 *   12. [HP] should return 42 when header is "42" (parseContentLength)
 *   13. [HP] should return 5 when duplicate consistent "5, 5" (parseContentLength)
 *   14. [HP] should use header value when header option set and header valid (resolveRequestId)
 *   15. [HP] should use generate function when provided and no valid header (resolveRequestId)
 *   16. [HP] should return true for printable ASCII string (validateRequestId)
 *   17. [HP] should extract hostname from host:port (extractHostname)
 *   18. [HP] should extract hostname from plain host (extractHostname)
 *   19. [HP] should extract IPv6 hostname from bracketed format (extractHostname)
 *   20. [HP] should extract port from host:port (extractPort)
 *   21. [HP] should extract port from IPv6 bracketed format (extractPort)
 *   22. [HP] should return 443 for https (defaultPortByProtocol)
 *   23. [HP] should return 80 for http (defaultPortByProtocol)
 *   24. [HP] should return method when in allowed set (validateHttpMethod)
 *   25. [HP] should strip ::ffff: prefix from IPv4-mapped IPv6 (normalizeIp)
 *   26. [HP] should return IPv4 as-is (normalizeIp)
 *   27. [HP] should return ::1 as-is (normalizeIp)
 *   28. [HP] should return object as JsonValue (parseJsonBody)
 *   29. [HP] should return null as JsonValue (parseJsonBody)
 *   30. [HP] should return string as JsonValue (parseJsonBody)
 *   31. [HP] should return number as JsonValue (parseJsonBody)
 *   32. [HP] should return true when route has rawBody true (resolveRawBody)
 *   33. [HP] should return true for valid hostname (validateForwardedHost)
 *   34. [HP] should return true for valid IPv6 brackets (validateForwardedHost)
 *   35. [HP] should extract proto and host from single element (parseForwardedLast)
 *   36. [HP] should extract quoted values (parseForwardedLast)
 *   37. [HP] should return true when config is true (evaluateTrustProxy)
 *   38. [HP] should return true when config is number (evaluateTrustProxy)
 *   39. [HP] should delegate to isInCidrRange when config is string (evaluateTrustProxy)
 *   40. [HP] should delegate to isInCidrRange when config is array (evaluateTrustProxy)
 *   41. [HP] should call function when config is function (evaluateTrustProxy)
 *   42. [HP] should use Forwarded header when present with proto and host (resolveProxyInfo)
 *   43. [HP] should fall back to X-Forwarded-* when no Forwarded header (resolveProxyInfo)
 *   44. [HP] should return first XFF IP when trustProxy is true (resolveClientIp)
 *   45. [HP] should walk ipChain right-to-left stopping at untrusted IP (resolveClientIp)
 *   46. [HP] should return true for config true (isTrustedIp)
 *   47. [HP] should check hop index for number config (isTrustedIp)
 *   48. [HP] should delegate to isInCidrRange for string config (isTrustedIp)
 *   49. [HP] should delegate to isInCidrRange for array config (isTrustedIp)
 *   50. [HP] should call function config (isTrustedIp)
 *   51. [HP] should match exact IP without CIDR (isInCidrRange)
 *   52. [HP] should match IP in CIDR range (isInCidrRange)
 *   53. [HP] should return true for IP within /24 range (matchesCidr)
 *   54. [HP] should convert valid IPv4 to number (ipv4ToNumber)
 *   55. [HP] should return ok with valid request (createHttpRequest)
 *   56. [NE] should return null when input is null (parseContentTypeInfo)
 *   57. [NE] should return null when input is empty string (parseContentTypeInfo)
 *   58. [NE] should return null when content-length is NaN (parseContentLength)
 *   59. [NE] should return 'invalid' when duplicate inconsistent "5, 3" (parseContentLength)
 *   60. [NE] should return false for control char in requestId (validateRequestId)
 *   61. [NE] should return null for unknown method (validateHttpMethod)
 *   62. [NE] should return null when ip is null (normalizeIp)
 *   63. [NE] should return false for empty hostname (validateForwardedHost)
 *   64. [NE] should return false for unmatched IPv6 bracket (validateForwardedHost)
 *   65. [NE] should return false for control char in hostname (validateForwardedHost)
 *   66. [NE] should return not-implemented when method is invalid (createHttpRequest)
 *   67. [NE] should return bad-request when URL is invalid (createHttpRequest)
 *   68. [NE] should return bad-request when content-length is inconsistent (createHttpRequest)
 *   69. [NE] should return false when config is false (evaluateTrustProxy)
 *   70. [NE] should return false when ip is null and config is non-boolean (evaluateTrustProxy)
 *   71. [NE] should return false for NaN prefix (matchesCidr)
 *   72. [NE] should return null for non-4-part IP (ipv4ToNumber)
 *   73. [NE] should return null for octet out of range (ipv4ToNumber)
 *   74. [ED] should return null when content-length header is null (parseContentLength)
 *   75. [ED] should return null when content-length header is empty (parseContentLength)
 *   76. [ED] should return false for empty requestId (validateRequestId)
 *   77. [ED] should return true for 256-char requestId (validateRequestId)
 *   78. [ED] should return false for 257-char requestId (validateRequestId)
 *   79. [ED] should return host as-is when IPv6 bracket not closed (extractHostname)
 *   80. [ED] should return null when no port in host (extractPort)
 *   81. [ED] should return null when IPv6 has no port (extractPort)
 *   82. [ED] should return 80 for null protocol (defaultPortByProtocol)
 *   83. [ED] should return 80 for unknown protocol (defaultPortByProtocol)
 *   84. [ED] should return false when route is undefined (resolveRawBody)
 *   85. [ED] should return false when route has rawBody false (resolveRawBody)
 *   86. [ED] should return false for hostname over 255 chars (validateForwardedHost)
 *   87. [ED] should return null proto and null host when no directives (parseForwardedLast)
 *   88. [ED] should return empty array for empty input (parseParameters)
 *   89. [ED] should return false for prefix < 0 (matchesCidr)
 *   90. [ED] should return false for prefix > 32 (matchesCidr)
 *   91. [ED] should handle prefix = 0 as match-all (matchesCidr)
 *   92. [ED] should fall back to exact match for IPv6 in matchesCidr (matchesCidr)
 *   93. [ED] should return no match when CIDR list is empty (isInCidrRange)
 *   94. [ED] should return socketIp when ipChain is empty (resolveClientIp)
 *   95. [ED] should return socketIp when trustProxy is false (resolveClientIp)
 *   96. [ED] should return false for config false (isTrustedIp)
 *   97. [ED] should return false for fallthrough with unknown config type (evaluateTrustProxy)
 *   98. [CO] should return null mediaType after trim with params (parseContentTypeInfo)
 *   99. [CO] should skip to generate when header set but value invalid (resolveRequestId)
 *   100. [CO] should fall back to crypto.randomUUID when no options (resolveRequestId)
 *   101. [CO] should use last comma-separated element (parseForwardedLast)
 *   102. [CO] should validate forwarded host and null invalid ones in resolveProxyInfo (resolveProxyInfo)
 *   103. [CO] should fall back to X-Forwarded-* when Forwarded has no proto or host (resolveProxyInfo)
 *   104. [CO] should resolve port from X-Forwarded-Port in resolveProxyInfo (resolveProxyInfo)
 *   105. [ID] should return same result for same parseContentTypeInfo input
 *   106. [OR] should prioritize Forwarded over X-Forwarded-* headers (resolveProxyInfo)
 */

describe('parseContentTypeInfo', () => {
  it('should return null when input is null', () => {
    const result = parseContentTypeInfo(null);

    expect(result).toBeNull();
  });

  it('should return null when input is empty string', () => {
    const result = parseContentTypeInfo('');

    expect(result).toBeNull();
  });

  it('should return mediaType only when no params present', () => {
    const result = parseContentTypeInfo('application/json');

    expect(result).not.toBeNull();
    expect(result!.mediaType).toBe('application/json');
    expect(result!.charset).toBeNull();
    expect(result!.boundary).toBeNull();
    expect(result!.params.size).toBe(0);
  });

  it('should return mediaType and charset when content-type has charset param', () => {
    const result = parseContentTypeInfo('text/html; charset=utf-8');

    expect(result).not.toBeNull();
    expect(result!.mediaType).toBe('text/html');
    expect(result!.charset).toBe('utf-8');
  });

  it('should return mediaType and boundary when content-type is multipart with boundary', () => {
    const result = parseContentTypeInfo('multipart/form-data; boundary=----abc');

    expect(result).not.toBeNull();
    expect(result!.mediaType).toBe('multipart/form-data');
    expect(result!.boundary).toBe('----abc');
  });

  it('should unquote quoted-string param values', () => {
    const result = parseContentTypeInfo('text/plain; charset="utf-8"');

    expect(result).not.toBeNull();
    expect(result!.charset).toBe('utf-8');
  });

  it('should unescape backslash-escaped chars in quoted values', () => {
    const result = parseContentTypeInfo('text/plain; charset="utf\\"8"');

    expect(result).not.toBeNull();
    expect(result!.charset).toBe('utf"8');
  });

  it('should lowercase mediaType and charset', () => {
    const result = parseContentTypeInfo('TEXT/HTML; Charset=UTF-8');

    expect(result).not.toBeNull();
    expect(result!.mediaType).toBe('text/html');
    expect(result!.charset).toBe('utf-8');
  });

  it('should parse multiple params', () => {
    const result = parseContentTypeInfo('text/plain; charset=utf-8; boundary=abc');

    expect(result).not.toBeNull();
    expect(result!.charset).toBe('utf-8');
    expect(result!.boundary).toBe('abc');
    expect(result!.params.size).toBe(2);
  });

  it('should return null when mediaType is empty after trim', () => {
    const result = parseContentTypeInfo('  ; charset=utf-8');

    expect(result).toBeNull();
  });

  it('should return same result for same input', () => {
    const input = 'application/json; charset=utf-8';
    const first = parseContentTypeInfo(input);
    const second = parseContentTypeInfo(input);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.mediaType).toBe(second!.mediaType);
    expect(first!.charset).toBe(second!.charset);
  });
});

describe('parseParameters', () => {
  it('should split simple semicolon-separated pairs', () => {
    const result = parseParameters('charset=utf-8;boundary=abc');

    expect(result).toEqual(['charset=utf-8', 'boundary=abc']);
  });

  it('should preserve semicolons inside quoted values', () => {
    const result = parseParameters('key="value;with;semi"');

    expect(result).toEqual(['key="value;with;semi"']);
  });

  it('should handle escaped backslash in quotes', () => {
    const result = parseParameters('key="val\\\\ue"');

    expect(result).toEqual(['key="val\\\\ue"']);
  });

  it('should return empty array for empty input', () => {
    const result = parseParameters('');

    expect(result).toEqual([]);
  });

  it('should return single element when no semicolons', () => {
    const result = parseParameters('charset=utf-8');

    expect(result).toEqual(['charset=utf-8']);
  });
});

describe('parseContentLength', () => {
  it('should return null when content-length header is null', () => {
    const headers = new Headers();

    const result = parseContentLength(headers);

    expect(result).toBeNull();
  });

  it('should return null when content-length header is empty', () => {
    const headers = new Headers({ 'content-length': '' });

    const result = parseContentLength(headers);

    expect(result).toBeNull();
  });

  it('should return 42 when header is "42"', () => {
    const headers = new Headers({ 'content-length': '42' });

    const result = parseContentLength(headers);

    expect(result).toBe(42);
  });

  it('should return null when content-length is NaN', () => {
    const headers = new Headers({ 'content-length': 'abc' });

    const result = parseContentLength(headers);

    expect(result).toBeNull();
  });

  it('should return 5 when duplicate consistent "5, 5"', () => {
    const headers = new Headers();
    headers.append('content-length', '5, 5');

    const result = parseContentLength(headers);

    expect(result).toBe(5);
  });

  it('should return invalid when duplicate inconsistent "5, 3"', () => {
    const headers = new Headers();
    headers.append('content-length', '5, 3');

    const result = parseContentLength(headers);

    expect(result).toBe('invalid');
  });

  it('should return invalid when content-length is negative (RFC 9110 §8.6)', () => {
    const headers = new Headers({ 'content-length': '-1' });

    const result = parseContentLength(headers);

    expect(result).toBe('invalid');
  });

  it('should return invalid when duplicate consistent negative "-5, -5"', () => {
    const headers = new Headers();
    headers.append('content-length', '-5, -5');

    const result = parseContentLength(headers);

    expect(result).toBe('invalid');
  });
});

describe('validateRequestId', () => {
  it('should return true for printable ASCII string', () => {
    const result = validateRequestId('abc-123-def');

    expect(result).toBe(true);
  });

  it('should return false for empty requestId', () => {
    const result = validateRequestId('');

    expect(result).toBe(false);
  });

  it('should return true for 256-char requestId', () => {
    const id = 'a'.repeat(256);

    const result = validateRequestId(id);

    expect(result).toBe(true);
  });

  it('should return false for 257-char requestId', () => {
    const id = 'a'.repeat(257);

    const result = validateRequestId(id);

    expect(result).toBe(false);
  });

  it('should return false for control char in requestId', () => {
    const result = validateRequestId('abc\x00def');

    expect(result).toBe(false);
  });
});

describe('resolveRequestId', () => {
  it('should use header value when header option set and header valid', () => {
    const headers = new Headers({ 'x-request-id': 'my-id-123' });
    const options = { header: 'x-request-id' };

    const result = resolveRequestId(headers, options);

    expect(result).toBe('my-id-123');
  });

  it('should use generate function when provided and no valid header', () => {
    const headers = new Headers();
    const generateFn = mock(() => 'generated-id');
    const options = { header: 'x-request-id', generate: generateFn };

    const result = resolveRequestId(headers, options);

    expect(result).toBe('generated-id');
    expect(generateFn).toHaveBeenCalledTimes(1);
  });

  it('should skip to generate when header set but value invalid', () => {
    const tooLongId = 'a'.repeat(257);
    const headers = new Headers({ 'x-request-id': tooLongId });
    const generateFn = mock(() => 'fallback-id');
    const options = { header: 'x-request-id', generate: generateFn };

    const result = resolveRequestId(headers, options);

    expect(result).toBe('fallback-id');
    expect(generateFn).toHaveBeenCalledTimes(1);
  });

  it('should fall back to crypto.randomUUID when no options', () => {
    const headers = new Headers();
    const cryptoSpy = spyOn(crypto, 'randomUUID').mockReturnValue('mocked-uuid' as `${string}-${string}-${string}-${string}-${string}`);

    const result = resolveRequestId(headers);

    expect(result).toBe('mocked-uuid');
    cryptoSpy.mockRestore();
  });
});

describe('extractHostname', () => {
  it('should extract hostname from host:port', () => {
    const result = extractHostname('example.com:8080');

    expect(result).toBe('example.com');
  });

  it('should extract hostname from plain host', () => {
    const result = extractHostname('example.com');

    expect(result).toBe('example.com');
  });

  it('should extract IPv6 hostname from bracketed format', () => {
    const result = extractHostname('[::1]:8080');

    expect(result).toBe('::1');
  });

  it('should extract IPv6 hostname from brackets without port', () => {
    const result = extractHostname('[::1]');

    expect(result).toBe('::1');
  });

  it('should return host as-is when IPv6 bracket not closed', () => {
    const result = extractHostname('[::1');

    expect(result).toBe('[::1');
  });
});

describe('extractPort', () => {
  it('should extract port from host:port', () => {
    const result = extractPort('example.com:8080');

    expect(result).toBe('8080');
  });

  it('should extract port from IPv6 bracketed format', () => {
    const result = extractPort('[::1]:8080');

    expect(result).toBe('8080');
  });

  it('should return null when no port in host', () => {
    const result = extractPort('example.com');

    expect(result).toBeNull();
  });

  it('should return null when IPv6 has no port', () => {
    const result = extractPort('[::1]');

    expect(result).toBeNull();
  });
});

describe('defaultPortByProtocol', () => {
  it('should return 443 for https', () => {
    const result = defaultPortByProtocol('https');

    expect(result).toBe(443);
  });

  it('should return 80 for http', () => {
    const result = defaultPortByProtocol('http');

    expect(result).toBe(80);
  });

  it('should return 80 for null protocol', () => {
    const result = defaultPortByProtocol(null);

    expect(result).toBe(80);
  });

  it('should return 80 for unknown protocol', () => {
    const result = defaultPortByProtocol('ftp');

    expect(result).toBe(80);
  });
});

describe('validateHttpMethod', () => {
  it('should return method when in allowed set', () => {
    const allowed = new Set(['GET', 'POST']);

    const result = validateHttpMethod('GET', allowed);

    expect(result).toBe('GET');
  });

  it('should return null for unknown method', () => {
    const allowed = new Set(['GET', 'POST']);

    const result = validateHttpMethod('PATCH', allowed);

    expect(result).toBeNull();
  });
});

describe('normalizeIp', () => {
  it('should return null when ip is null', () => {
    const result = normalizeIp(null);

    expect(result).toBeNull();
  });

  it('should strip ::ffff: prefix from IPv4-mapped IPv6', () => {
    const result = normalizeIp('::ffff:10.0.0.1');

    expect(result).toBe('10.0.0.1');
  });

  it('should return IPv4 as-is', () => {
    const result = normalizeIp('10.0.0.1');

    expect(result).toBe('10.0.0.1');
  });

  it('should return ::1 as-is', () => {
    const result = normalizeIp('::1');

    expect(result).toBe('::1');
  });
});

describe('parseJsonBody', () => {
  it('should return object as JsonValue', () => {
    const obj = { key: 'value' };

    const result = parseJsonBody(obj);

    expect(result).toEqual({ key: 'value' });
  });

  it('should return null as JsonValue', () => {
    const result = parseJsonBody(null);

    expect(result).toBeNull();
  });

  it('should return string as JsonValue', () => {
    const result = parseJsonBody('hello');

    expect(result).toBe('hello');
  });

  it('should return number as JsonValue', () => {
    const result = parseJsonBody(42);

    expect(result).toBe(42);
  });
});

describe('resolveRawBody', () => {
  it('should return false when route is undefined', () => {
    const result = resolveRawBody(undefined);

    expect(result).toBe(false);
  });

  it('should return false when route has rawBody false', () => {
    const route = { rawBody: false } as { rawBody: boolean };

    const result = resolveRawBody(route as never);

    expect(result).toBe(false);
  });

  it('should return true when route has rawBody true', () => {
    const route = { rawBody: true } as { rawBody: boolean };

    const result = resolveRawBody(route as never);

    expect(result).toBe(true);
  });
});

describe('validateForwardedHost', () => {
  it('should return true for valid hostname', () => {
    const result = validateForwardedHost('example.com');

    expect(result).toBe(true);
  });

  it('should return false for empty hostname', () => {
    const result = validateForwardedHost('');

    expect(result).toBe(false);
  });

  it('should return false for hostname over 255 chars', () => {
    const longHost = 'a'.repeat(256);

    const result = validateForwardedHost(longHost);

    expect(result).toBe(false);
  });

  it('should return false for control char in hostname', () => {
    const result = validateForwardedHost('example\x00.com');

    expect(result).toBe(false);
  });

  it('should return true for valid IPv6 brackets', () => {
    const result = validateForwardedHost('[::1]');

    expect(result).toBe(true);
  });

  it('should return false for unmatched IPv6 bracket', () => {
    const result = validateForwardedHost('[::1');

    expect(result).toBe(false);
  });
});

describe('parseForwardedLast', () => {
  it('should extract proto and host from single element', () => {
    const result = parseForwardedLast('proto=https;host=example.com');

    expect(result.proto).toBe('https');
    expect(result.host).toBe('example.com');
  });

  it('should use last comma-separated element', () => {
    const result = parseForwardedLast('proto=http;host=first.com, proto=https;host=last.com');

    expect(result.proto).toBe('https');
    expect(result.host).toBe('last.com');
  });

  it('should extract quoted values', () => {
    const result = parseForwardedLast('proto=https;host="example.com"');

    expect(result.proto).toBe('https');
    expect(result.host).toBe('example.com');
  });

  it('should return null proto and null host when no directives', () => {
    const result = parseForwardedLast('for=1.2.3.4');

    expect(result.proto).toBeNull();
    expect(result.host).toBeNull();
  });
});

describe('evaluateTrustProxy', () => {
  it('should return false when config is false', () => {
    const result = evaluateTrustProxy('10.0.0.1', false);

    expect(result).toBe(false);
  });

  it('should return true when config is true', () => {
    const result = evaluateTrustProxy('10.0.0.1', true);

    expect(result).toBe(true);
  });

  it('should return false when ip is null and config is non-boolean', () => {
    const result = evaluateTrustProxy(null, 1);

    expect(result).toBe(false);
  });

  it('should return true when config is number', () => {
    const result = evaluateTrustProxy('10.0.0.1', 2);

    expect(result).toBe(true);
  });

  it('should delegate to isInCidrRange when config is string', () => {
    const result = evaluateTrustProxy('10.0.0.1', '10.0.0.1');

    expect(result).toBe(true);
  });

  it('should delegate to isInCidrRange when config is array', () => {
    const result = evaluateTrustProxy('10.0.0.1', ['10.0.0.1']);

    expect(result).toBe(true);
  });

  it('should call function when config is function', () => {
    const fn = mock((ip: string, _hop: number) => ip === '10.0.0.1');

    const result = evaluateTrustProxy('10.0.0.1', fn);

    expect(result).toBe(true);
    expect(fn).toHaveBeenCalledWith('10.0.0.1', 0);
  });

  it('should return false for fallthrough with unknown config type', () => {
    // Force an unexpected config type via type assertion
    const result = evaluateTrustProxy('10.0.0.1', Symbol() as never);

    expect(result).toBe(false);
  });
});

describe('resolveProxyInfo', () => {
  it('should use Forwarded header when present with proto and host', () => {
    const headers = new Headers({
      'forwarded': 'proto=https;host=proxy.example.com',
      'x-forwarded-for': '1.2.3.4',
    });

    const result = resolveProxyInfo(headers, true, '10.0.0.1');

    expect(result.proto).toBe('https');
    expect(result.host).toBe('proxy.example.com');
    expect(result.port).toBeNull();
  });

  it('should fall back to X-Forwarded-* when no Forwarded header', () => {
    const headers = new Headers({
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'proxy.example.com',
      'x-forwarded-port': '443',
      'x-forwarded-for': '1.2.3.4',
    });

    const result = resolveProxyInfo(headers, true, '10.0.0.1');

    expect(result.proto).toBe('https');
    expect(result.host).toBe('proxy.example.com');
    expect(result.port).toBe(443);
  });

  it('should validate forwarded host and null invalid ones', () => {
    const headers = new Headers({
      'forwarded': 'proto=https;host=bad host',
    });

    const result = resolveProxyInfo(headers, true, '10.0.0.1');

    expect(result.proto).toBe('https');
    expect(result.host).toBeNull();
  });

  it('should fall back to X-Forwarded-* when Forwarded has no proto or host', () => {
    const headers = new Headers({
      'forwarded': 'for=1.2.3.4',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'fallback.example.com',
    });

    const result = resolveProxyInfo(headers, true, '10.0.0.1');

    expect(result.proto).toBe('https');
    expect(result.host).toBe('fallback.example.com');
  });

  it('should resolve port from X-Forwarded-Port', () => {
    const headers = new Headers({
      'x-forwarded-port': '8080',
    });

    const result = resolveProxyInfo(headers, true, '10.0.0.1');

    expect(result.port).toBe(8080);
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

describe('resolveClientIp', () => {
  it('should return socketIp when ipChain is empty', () => {
    const result = resolveClientIp([], true, '10.0.0.1');

    expect(result).toBe('10.0.0.1');
  });

  it('should return first XFF IP when trustProxy is true', () => {
    const result = resolveClientIp(['1.2.3.4', '5.6.7.8'], true, '10.0.0.1');

    expect(result).toBe('1.2.3.4');
  });

  it('should return socketIp when trustProxy is false', () => {
    const result = resolveClientIp(['1.2.3.4'], false, '10.0.0.1');

    expect(result).toBe('10.0.0.1');
  });

  it('should walk ipChain right-to-left stopping at untrusted IP', () => {
    const trustFn = mock((ip: string, _hop: number) => ip === '10.0.0.1');

    const result = resolveClientIp(['1.2.3.4', '5.6.7.8'], trustFn, '10.0.0.1');

    expect(result).toBe('5.6.7.8');
  });
});

describe('isTrustedIp', () => {
  it('should return true for config true', () => {
    const result = isTrustedIp('10.0.0.1', true, 0);

    expect(result).toBe(true);
  });

  it('should return false for config false', () => {
    const result = isTrustedIp('10.0.0.1', false, 0);

    expect(result).toBe(false);
  });

  it('should check hop index for number config', () => {
    expect(isTrustedIp('10.0.0.1', 2, 0)).toBe(true);
    expect(isTrustedIp('10.0.0.1', 2, 1)).toBe(true);
    expect(isTrustedIp('10.0.0.1', 2, 2)).toBe(false);
  });

  it('should delegate to isInCidrRange for string config', () => {
    const result = isTrustedIp('10.0.0.1', '10.0.0.0/24', 0);

    expect(result).toBe(true);
  });

  it('should delegate to isInCidrRange for array config', () => {
    const result = isTrustedIp('10.0.0.1', ['10.0.0.0/24'], 0);

    expect(result).toBe(true);
  });

  it('should call function config', () => {
    const fn = mock((_ip: string, _hop: number) => true);

    const result = isTrustedIp('::ffff:10.0.0.1', fn, 3);

    expect(result).toBe(true);
    expect(fn).toHaveBeenCalledWith('10.0.0.1', 3);
  });
});

describe('isInCidrRange', () => {
  it('should match exact IP without CIDR', () => {
    const result = isInCidrRange('10.0.0.1', ['10.0.0.1']);

    expect(result).toBe(true);
  });

  it('should match IP in CIDR range', () => {
    const result = isInCidrRange('10.0.0.5', ['10.0.0.0/24']);

    expect(result).toBe(true);
  });

  it('should return no match when CIDR list is empty', () => {
    const result = isInCidrRange('10.0.0.1', []);

    expect(result).toBe(false);
  });
});

describe('matchesCidr', () => {
  it('should return true for IP within /24 range', () => {
    const result = matchesCidr('192.168.1.100', '192.168.1.0/24');

    expect(result).toBe(true);
  });

  it('should return false for NaN prefix', () => {
    const result = matchesCidr('10.0.0.1', '10.0.0.0/abc');

    expect(result).toBe(false);
  });

  it('should return false for prefix < 0', () => {
    const result = matchesCidr('10.0.0.1', '10.0.0.0/-1');

    expect(result).toBe(false);
  });

  it('should return false for prefix > 32', () => {
    const result = matchesCidr('10.0.0.1', '10.0.0.0/33');

    expect(result).toBe(false);
  });

  it('should handle prefix = 0 as match-all', () => {
    const result = matchesCidr('192.168.1.1', '0.0.0.0/0');

    expect(result).toBe(true);
  });

  it('should fall back to exact match for IPv6', () => {
    const result = matchesCidr('::1', '::1/128');

    expect(result).toBe(true);
  });
});

describe('ipv4ToNumber', () => {
  it('should convert valid IPv4 to number', () => {
    const result = ipv4ToNumber('10.0.0.1');

    expect(result).toBe((10 << 24 | 0 << 16 | 0 << 8 | 1) >>> 0);
  });

  it('should return null for non-4-part IP', () => {
    const result = ipv4ToNumber('::1');

    expect(result).toBeNull();
  });

  it('should return null for octet out of range', () => {
    const result = ipv4ToNumber('256.0.0.1');

    expect(result).toBeNull();
  });
});

describe('createHttpRequest', () => {
  const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);

  it('should return ok with valid request', () => {
    const raw = new Request('http://example.com/path?q=1', {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });

    const result = createHttpRequest(raw, '10.0.0.1', false, null, ALLOWED_METHODS);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.request.method).toBe('GET');
      expect(result.request.path).toBe('/path');
      expect(result.request.hostname).toBe('example.com');
      expect(result.request.protocol).toBe('http');
      expect(result.request.queryString).toBe('?q=1');
      expect(result.request.contentType).not.toBeNull();
      expect(result.request.contentType!.mediaType).toBe('application/json');
      expect(result.request.ip).toBe('10.0.0.1');
      expect(result.request.isTrustedProxy).toBe(false);
    }
  });

  it('should return not-implemented when method is invalid', () => {
    const raw = new Request('http://example.com/', { method: 'PROPFIND' });

    const result = createHttpRequest(raw, '10.0.0.1', false, null, ALLOWED_METHODS);

    expect(result.kind).toBe('not-implemented');
  });

  it('should return bad-request when content-length is inconsistent', () => {
    const raw = new Request('http://example.com/', { method: 'GET' });
    const headers = new Headers(raw.headers);
    headers.set('content-length', '5, 3');
    const modifiedRequest = new Request(raw.url, {
      method: raw.method,
      headers,
    });

    const result = createHttpRequest(modifiedRequest, '10.0.0.1', false, null, ALLOWED_METHODS);

    expect(result.kind).toBe('bad-request');
  });

  it('should return not-implemented with request field for unsupported method', () => {
    const raw = new Request('http://example.com/resource', { method: 'LINK' });

    const result = createHttpRequest(raw, '10.0.0.1', false, null, ALLOWED_METHODS);

    expect(result.kind).toBe('not-implemented');
    expect('request' in result).toBe(true);
    if (result.kind === 'not-implemented') {
      expect(result.request.method).toBe('LINK');
      expect(result.request.path).toBe('/resource');
    }
  });

  it('should return bad-request with invalid-url reason and no request field for invalid URL', () => {
    // Create a Request-like object with an invalid URL to trigger the URL parse failure
    const invalidRaw = {
      url: ':::invalid',
      method: 'GET',
      headers: new Headers(),
      signal: AbortSignal.timeout(5000),
    } as unknown as Request;

    const result = createHttpRequest(invalidRaw, '10.0.0.1', false, null, ALLOWED_METHODS);

    expect(result.kind).toBe('bad-request');
    if (result.kind === 'bad-request') {
      expect(result.reason).toBe('invalid-url');
      expect('request' in result).toBe(false);
    }
  });

  it('should return bad-request with invalid-content-length reason and request field for mismatched content-length', () => {
    const raw = new Request('http://example.com/data', { method: 'POST' });
    const headers = new Headers(raw.headers);
    headers.set('content-length', '5, 3');
    const modifiedRequest = new Request(raw.url, {
      method: raw.method,
      headers,
    });

    const result = createHttpRequest(modifiedRequest, '10.0.0.1', false, null, ALLOWED_METHODS);

    expect(result.kind).toBe('bad-request');
    if (result.kind === 'bad-request') {
      expect(result.reason).toBe('invalid-content-length');
      expect('request' in result).toBe(true);
      if ('request' in result) {
        expect(result.request.contentLength).toBeNull();
      }
    }
  });

  it('should return ok with all fields populated for normal GET', () => {
    const raw = new Request('http://example.com/users?page=2', {
      method: 'GET',
      headers: { 'content-type': 'text/html', 'x-custom': 'value' },
    });

    const result = createHttpRequest(raw, '192.168.1.1', false, null, ALLOWED_METHODS);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.request.method).toBe('GET');
      expect(result.request.path).toBe('/users');
      expect(result.request.queryString).toBe('?page=2');
      expect(result.request.hostname).toBe('example.com');
      expect(result.request.protocol).toBe('http');
      expect(result.request.port).toBe(80);
      expect(result.request.ip).toBe('192.168.1.1');
      expect(result.request.isTrustedProxy).toBe(false);
      expect(result.request.ips).toEqual([]);
      expect(result.request.contentType).not.toBeNull();
      expect(result.request.contentType!.mediaType).toBe('text/html');
      expect(result.request.headers.get('x-custom')).toBe('value');
      expect(typeof result.request.requestId).toBe('string');
      expect(result.request.requestId.length).toBeGreaterThan(0);
    }
  });

  it('should return uri-too-long when URL exceeds maxUriLength', () => {
    const longPath = '/' + 'a'.repeat(10_000);
    const raw = new Request(`http://example.com${longPath}`, { method: 'GET' });

    const result = createHttpRequest(raw, '10.0.0.1', false, null, ALLOWED_METHODS, undefined, 8192);

    expect(result.kind).toBe('uri-too-long');
  });

  it('should accept URL at maxUriLength boundary', () => {
    const raw = new Request('http://example.com/ok', { method: 'GET' });

    const result = createHttpRequest(raw, '10.0.0.1', false, null, ALLOWED_METHODS, undefined, raw.url.length);

    expect(result.kind).toBe('ok');
  });
});
