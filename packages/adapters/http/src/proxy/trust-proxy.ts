import type { TrustProxyConfig } from '../types';

import { isInCidrRange, normalizeIp } from './cidr';

/**
 * @param ip - IPv4 정규화 완료된 소켓 IP. fetch()에서 ::ffff: 접두사를 제거한 후 전달한다.
 */
export function evaluateTrustProxy(ip: string | null, config: TrustProxyConfig): boolean {
  if (config === false) return false;
  if (config === true) return true;
  if (ip === null) return false;

  if (typeof config === 'number') return true;
  if (typeof config === 'string') return isInCidrRange(ip, [config]);
  if (Array.isArray(config)) return isInCidrRange(ip, config);
  if (typeof config === 'function') return config(ip, 0);
  return false;
}

/**
 * XFF 체인의 IP를 평가한다. XFF 값은 클라이언트/프록시가 설정한 원본 값이므로
 * ::ffff: 접두사가 포함될 수 있다. 이 함수 내부에서 정규화한다.
 */
export function isTrustedIp(ip: string, config: TrustProxyConfig, hopIndex: number): boolean {
  if (config === true) return true;
  if (config === false) return false;

  const normalized = normalizeIp(ip) ?? ip;

  if (typeof config === 'number') return hopIndex < config;
  if (typeof config === 'string') return isInCidrRange(normalized, [config]);
  if (Array.isArray(config)) return isInCidrRange(normalized, config);
  if (typeof config === 'function') return config(normalized, hopIndex);
  return false;
}
