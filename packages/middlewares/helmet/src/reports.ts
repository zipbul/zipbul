import { HttpHeader } from '@zipbul/shared';

import { LIMITS } from './constants';
import { HelmetErrorReason } from './enums';
import { HelmetError } from './interfaces';

export interface CspReportNormalized {
  source: 'legacy' | 'reporting-api';
  blockedUri?: string;
  documentUri?: string;
  effectiveDirective?: string;
  violatedDirective?: string;
  disposition?: 'enforce' | 'report';
  originalPolicy?: string;
  referrer?: string;
  sample?: string;
  statusCode?: number;
  sourceFile?: string;
  lineNumber?: number;
  columnNumber?: number;
}

const ALLOWED_CONTENT_TYPES = new Set<string>([
  'application/csp-report',
  'application/reports+json',
]);

/**
 * Parse a CSP violation report from a Web Fetch Request.
 * Handles both `application/csp-report` (legacy) and `application/reports+json`.
 *
 * @throws {HelmetError} on bad content-type, oversized body, malformed JSON,
 *   or read timeout (10s).
 */
export async function parseCspReport(request: Request): Promise<CspReportNormalized[]> {
  const contentType = (request.headers.get(HttpHeader.ContentType) ?? '').split(';')[0]!.trim().toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new HelmetError([
      {
        reason: HelmetErrorReason.UnsupportedCspReportContentType,
        path: 'request.headers.content-type',
        message: 'CSP report Content-Type must be application/csp-report or application/reports+json',
      },
    ]);
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LIMITS.cspReportTimeoutMs);
  let raw: string;
  try {
    if (request.body === null) raw = await request.text();
    else {
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value !== undefined) {
          total += value.byteLength;
          if (total > LIMITS.cspReportBodyBytes) {
            reader.cancel().catch(() => undefined);
            throw new HelmetError([
              {
                reason: HelmetErrorReason.CspReportTooLarge,
                path: 'request.body',
                message: `CSP report body exceeds ${LIMITS.cspReportBodyBytes} bytes`,
              },
            ]);
          }
          chunks.push(value);
        }
      }
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.byteLength;
      }
      raw = new TextDecoder().decode(merged);
    }
  } catch (err) {
    if (ac.signal.aborted) {
      throw new HelmetError([
        {
          reason: HelmetErrorReason.CspReportTimeout,
          path: 'request.body',
          message: 'CSP report read exceeded 10s timeout',
        },
      ]);
    }
    if (err instanceof HelmetError) throw err;
    throw new HelmetError([
      {
        reason: HelmetErrorReason.InvalidCspReport,
        path: 'request.body',
        message: 'failed to read CSP report body',
      },
    ]);
  } finally {
    clearTimeout(timer);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HelmetError([
      {
        reason: HelmetErrorReason.InvalidCspReport,
        path: 'request.body',
        message: 'CSP report body is not valid JSON',
      },
    ]);
  }

  if (contentType === 'application/csp-report') {
    return [normalizeLegacy(parsed)];
  }
  return normalizeReportingApi(parsed);
}

function pick(obj: Record<string, unknown>, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  return undefined;
}

function asString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  return v.length > 2048 ? v.slice(0, 2048) : v;
}

function asInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) ? v : undefined;
}

function normalizeLegacy(parsed: unknown): CspReportNormalized {
  const safe: CspReportNormalized = Object.assign(Object.create(null), { source: 'legacy' as const });
  if (typeof parsed !== 'object' || parsed === null) return safe;
  const wrapper = parsed as Record<string, unknown>;
  const body = (pick(wrapper, 'csp-report') as Record<string, unknown> | undefined) ?? wrapper;
  const blockedUri = asString(pick(body, 'blocked-uri'));
  const documentUri = asString(pick(body, 'document-uri'));
  const effectiveDirective = asString(pick(body, 'effective-directive'));
  const violatedDirective = asString(pick(body, 'violated-directive'));
  const originalPolicy = asString(pick(body, 'original-policy'));
  const referrer = asString(pick(body, 'referrer'));
  const statusCode = asInt(pick(body, 'status-code'));
  const sourceFile = asString(pick(body, 'source-file'));
  const lineNumber = asInt(pick(body, 'line-number'));
  const columnNumber = asInt(pick(body, 'column-number'));
  if (blockedUri !== undefined) safe.blockedUri = blockedUri;
  if (documentUri !== undefined) safe.documentUri = documentUri;
  if (effectiveDirective !== undefined) safe.effectiveDirective = effectiveDirective;
  if (violatedDirective !== undefined) safe.violatedDirective = violatedDirective;
  safe.disposition = pick(body, 'disposition') === 'report' ? 'report' : 'enforce';
  if (originalPolicy !== undefined) safe.originalPolicy = originalPolicy;
  if (referrer !== undefined) safe.referrer = referrer;
  if (statusCode !== undefined) safe.statusCode = statusCode;
  if (sourceFile !== undefined) safe.sourceFile = sourceFile;
  if (lineNumber !== undefined) safe.lineNumber = lineNumber;
  if (columnNumber !== undefined) safe.columnNumber = columnNumber;
  return safe;
}

function normalizeReportingApi(parsed: unknown): CspReportNormalized[] {
  const out: CspReportNormalized[] = [];
  if (!Array.isArray(parsed)) return out;
  for (let i = 0; i < parsed.length && i < LIMITS.cspReportItems; i++) {
    const item = parsed[i];
    if (typeof item !== 'object' || item === null) continue;
    const body = (item as Record<string, unknown>).body as Record<string, unknown> | undefined;
    if (body === undefined) continue;
    const safe: CspReportNormalized = Object.assign(Object.create(null), { source: 'reporting-api' as const });
    const blockedUri = asString(pick(body, 'blockedURL'));
    const documentUri = asString(pick(body, 'documentURL'));
    const effectiveDirective = asString(pick(body, 'effectiveDirective'));
    const originalPolicy = asString(pick(body, 'originalPolicy'));
    const referrer = asString(pick(body, 'referrer'));
    const sample = asString(pick(body, 'sample'));
    const statusCode = asInt(pick(body, 'statusCode'));
    const sourceFile = asString(pick(body, 'sourceFile'));
    const lineNumber = asInt(pick(body, 'lineNumber'));
    const columnNumber = asInt(pick(body, 'columnNumber'));
    if (blockedUri !== undefined) safe.blockedUri = blockedUri;
    if (documentUri !== undefined) safe.documentUri = documentUri;
    if (effectiveDirective !== undefined) safe.effectiveDirective = effectiveDirective;
    safe.disposition = pick(body, 'disposition') === 'report' ? 'report' : 'enforce';
    if (originalPolicy !== undefined) safe.originalPolicy = originalPolicy;
    if (referrer !== undefined) safe.referrer = referrer;
    if (sample !== undefined) safe.sample = sample;
    if (statusCode !== undefined) safe.statusCode = statusCode;
    if (sourceFile !== undefined) safe.sourceFile = sourceFile;
    if (lineNumber !== undefined) safe.lineNumber = lineNumber;
    if (columnNumber !== undefined) safe.columnNumber = columnNumber;
    out.push(safe);
  }
  return out;
}
