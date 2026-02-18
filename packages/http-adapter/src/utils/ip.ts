import type { ZipbulValue } from '@zipbul/common';
import type { Server } from 'bun';

import type { ClientIpsResult } from './interfaces';

import { HeaderField } from '../enums';

function getIps(request: Request, server: Pick<Server<ZipbulValue>, 'requestIP'>, trustProxy?: boolean): ClientIpsResult {
  const shouldTrustProxy = trustProxy ?? false;
  const headers = request.headers;
  const socketAddress = server.requestIP(request) ?? undefined;
  const forwardedIps = shouldTrustProxy ? collectForwardedFor(headers.get(HeaderField.Forwarded)) : [];
  const xForwardedForIps = shouldTrustProxy ? collectXForwardedFor(headers.get(HeaderField.XForwardedFor)) : [];
  const dedupedForwardChain = dedupePreserveOrder([...forwardedIps, ...xForwardedForIps]);
  const xRealIp = shouldTrustProxy ? extractHeaderIp(headers.get(HeaderField.XRealIp)) : undefined;
  const socketIp = sanitizeIpCandidate(socketAddress?.address);
  const ipCandidates: Array<string | undefined> = [
    dedupedForwardChain[0],
    xRealIp,
    socketIp !== undefined && isIpAddress(socketIp) ? socketIp : undefined,
  ];
  const ip = ipCandidates.find(candidate => Boolean(candidate));

  return {
    ip,
    ips: dedupedForwardChain.length > 0 ? dedupedForwardChain : undefined,
  };
}

function collectForwardedFor(headerValue: string | null): string[] {
  if (headerValue === null || headerValue.trim().length === 0) {
    return [];
  }

  const results: string[] = [];

  for (const entry of headerValue.split(',')) {
    const element = entry.trim();

    if (element.length === 0) {
      continue;
    }

    for (const segment of element.split(';')) {
      const separator = segment.indexOf('=');

      if (separator === -1) {
        continue;
      }

      const key = segment.slice(0, separator).trim().toLowerCase();

      if (key !== 'for') {
        continue;
      }

      const value = segment.slice(separator + 1);
      const ip = extractHeaderIp(value);

      if (ip !== undefined) {
        results.push(ip);
      }
    }
  }

  return results;
}

function collectXForwardedFor(headerValue: string | null): string[] {
  if (headerValue === null || headerValue.trim().length === 0) {
    return [];
  }

  const results: string[] = [];

  for (const token of headerValue.split(',')) {
    const ip = extractHeaderIp(token);

    if (ip !== undefined) {
      results.push(ip);
    }
  }

  return results;
}

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
}

function extractHeaderIp(raw: string | undefined | null): string | undefined {
  const candidate = sanitizeIpCandidate(raw);

  if (candidate === undefined || !isIpAddress(candidate)) {
    return undefined;
  }

  return candidate;
}

function sanitizeIpCandidate(raw: string | undefined | null): string | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }

  let value = raw.trim();

  if (value.length === 0) {
    return undefined;
  }

  const isPlaceholder = (candidate: string): boolean => {
    const lower = candidate.toLowerCase();

    return lower === 'unknown' || lower === 'obfuscated' || lower === 'none' || candidate.startsWith('_');
  };

  value = stripOptionalQuotes(value);

  if (value.length === 0 || isPlaceholder(value)) {
    return undefined;
  }

  if (value.startsWith('[')) {
    const closing = value.indexOf(']');

    if (closing > 0) {
      value = value.slice(1, closing);
    } else {
      value = value.slice(1);
    }
  }

  if (value.toLowerCase().startsWith('::ffff:')) {
    value = value.slice(7);
  }

  value = stripPortSuffix(value);
  value = stripOptionalQuotes(value);
  value = value.trim();

  if (value.length === 0 || isPlaceholder(value)) {
    return undefined;
  }

  return value;
}

function stripOptionalQuotes(value: string): string {
  let result = value.trim();

  while (result.length >= 2) {
    const first = result[0];
    const last = result[result.length - 1];

    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      result = result.slice(1, -1);
      result = result.replace(/\\([\\"'])/g, '$1');
      result = result.trim();

      continue;
    }

    break;
  }

  return result;
}

function stripPortSuffix(value: string): string {
  const colonMatches = value.match(/:/g);
  const colonCount = colonMatches ? colonMatches.length : 0;

  if (value.includes('.') && colonCount === 1) {
    return value.slice(0, value.lastIndexOf(':'));
  }

  if (colonCount > 1) {
    const idx = value.lastIndexOf(':');
    const trailing = value.slice(idx + 1);

    if (/^\d+$/.test(trailing)) {
      const candidate = value.slice(0, idx);

      if (!isIpv6(value) && isIpv6(candidate)) {
        return candidate;
      }
    }
  }

  return value;
}

function isIpAddress(value: string): boolean {
  return isIpv4(value) || isIpv6(value);
}

function isIpv4(value: string): boolean {
  const parts = value.split('.');

  if (parts.length !== 4) {
    return false;
  }

  return parts.every(part => {
    if (part.length > 3) {
      return false;
    }

    if (!/^[0-9]+$/.test(part)) {
      return false;
    }

    const number = Number(part);

    if (number < 0 || number > 255) {
      return false;
    }

    if (part.length > 1 && part.startsWith('0')) {
      return false;
    }

    return true;
  });
}

function isIpv6(value: string): boolean {
  if (!value.includes(':')) {
    return false;
  }

  const validChars = /^[0-9a-fA-F:]+$/;

  if (!validChars.test(value)) {
    return false;
  }

  const segments = value.split(':');

  if (segments.length > 8) {
    return false;
  }

  let emptyBlocks = 0;

  for (const segment of segments) {
    if (segment.length === 0) {
      emptyBlocks += 1;

      continue;
    }

    if (segment.length > 4) {
      return false;
    }
  }

  if (emptyBlocks > 2) {
    return false;
  }

  return true;
}

export const __internals = {
  collectForwardedFor,
  collectXForwardedFor,
  dedupePreserveOrder,
  extractHeaderIp,
  sanitizeIpCandidate,
  stripOptionalQuotes,
  stripPortSuffix,
  isIpAddress,
  isIpv4,
  isIpv6,
};

export { getIps };
