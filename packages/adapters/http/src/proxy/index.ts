export { ipv4ToNumber, ipv6ToBytes, matchesPrefix, isInCidrRange, matchesCidr, normalizeIp } from './cidr';
export { validateForwardedHost, parseForwardedLast } from './forwarded-parser';
export { evaluateTrustProxy, isTrustedIp } from './trust-proxy';
export { resolveProxyInfo, resolveClientIp } from './resolve';
export type { ResolvedProxyInfo } from './resolve';
