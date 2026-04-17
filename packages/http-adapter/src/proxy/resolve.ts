import type { TrustProxyConfig } from '../types';

import { validateForwardedHost, parseForwardedLast } from './forwarded-parser';
import { isTrustedIp } from './trust-proxy';

export interface ResolvedProxyInfo {
  readonly proto: string | null;
  readonly host: string | null;
  readonly port: number | null;
  readonly clientIp: string | null;
  readonly ipChain: readonly string[];
}

export function resolveProxyInfo(
  headers: Headers,
  trustProxy: TrustProxyConfig,
  socketIp: string | null,
): ResolvedProxyInfo {
  const xffRaw = headers.get('x-forwarded-for');
  const ipChain = xffRaw !== null
    ? xffRaw.split(',').map(ip => ip.trim()).filter(ip => ip.length > 0)
    : [];

  const clientIp = resolveClientIp(ipChain, trustProxy, socketIp);

  // Forwarded (RFC 7239) 우선 — 마지막 element에서 proto/host만 읽는다.
  const forwarded = headers.get('forwarded');
  if (forwarded !== null) {
    const info = parseForwardedLast(forwarded);
    if (info.proto !== null || info.host !== null) {
      const validatedHost = info.host !== null && validateForwardedHost(info.host) ? info.host : null;
      return {
        proto: info.proto,
        host: validatedHost,
        port: null,
        clientIp,
        ipChain,
      };
    }
  }

  // X-Forwarded-* fallback
  const proto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim()?.toLowerCase() ?? null;
  const rawHost = headers.get('x-forwarded-host')?.split(',')[0]?.trim() ?? null;
  const host = rawHost !== null && validateForwardedHost(rawHost) ? rawHost : null;
  const rawPort = headers.get('x-forwarded-port')?.split(',')[0]?.trim() ?? null;
  const port = rawPort !== null ? parseInt(rawPort, 10) : null;

  return {
    proto,
    host,
    port: port !== null && Number.isNaN(port) ? null : port,
    clientIp,
    ipChain,
  };
}

export function resolveClientIp(
  ipChain: readonly string[],
  trustProxy: TrustProxyConfig,
  socketIp: string | null,
): string | null {
  if (ipChain.length === 0) return socketIp;
  if (trustProxy === true) return ipChain[0] ?? socketIp;
  if (trustProxy === false) return socketIp;

  let currentIp = socketIp;
  let hopIndex = 0;

  for (let i = ipChain.length - 1; i >= 0; i--) {
    if (currentIp === null || !isTrustedIp(currentIp, trustProxy, hopIndex)) {
      return currentIp;
    }
    currentIp = ipChain[i] ?? null;
    hopIndex++;
  }
  return currentIp;
}
