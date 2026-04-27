import { parseParameters } from '../content-type';

export interface ForwardedDirectives {
  readonly proto: string | null;
  readonly host: string | null;
}

export function validateForwardedHost(value: string): boolean {
  if (value.length === 0 || value.length > 255) return false;
  // IPv6 bracket 쌍 검증
  if (value.startsWith('[') && !value.includes(']')) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x21 || code > 0x7e) return false;
  }
  return true;
}

/**
 * RFC 7239 §4: 마지막 element에서 proto/host만 읽는다.
 * IP 결정은 XFF 역방향 탐색만 사용. Forwarded:for는 사용하지 않는다.
 */
export function parseForwardedLast(value: string): ForwardedDirectives {
  const elements = value.split(',');
  const last = elements[elements.length - 1]!;
  let proto: string | null = null;
  let host: string | null = null;

  for (const pair of parseParameters(last)) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex === -1) continue;

    const key = pair.slice(0, eqIndex).trim().toLowerCase();
    let val = pair.slice(eqIndex + 1).trim();

    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1).replace(/\\(.)/g, '$1');
    }

    if (key === 'proto') proto = val.toLowerCase();
    else if (key === 'host') host = val;
  }

  return { proto, host };
}
