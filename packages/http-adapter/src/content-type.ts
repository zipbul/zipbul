import type { ContentTypeInfo } from './types';

/**
 * RFC 9110 parameter parsing.
 * Splits on semicolons while preserving quoted-string contents.
 */
export function parseParameters(input: string): string[] {
  const pairs: string[] = [];
  let current = '';
  let inQuotes = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\' && inQuotes) {
      current += char;
      escaped = true;
      continue;
    }

    if (char === '"') {
      current += char;
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ';' && !inQuotes) {
      pairs.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    pairs.push(current);
  }

  return pairs;
}

export function parseContentTypeInfo(raw: string | null): ContentTypeInfo | null {
  if (raw === null || raw.length === 0) return null;

  const semicolonIndex = raw.indexOf(';');
  const mediaType = (semicolonIndex === -1 ? raw.trim() : raw.slice(0, semicolonIndex).trim()).toLowerCase();

  if (mediaType.length === 0) return null;

  const params = new Map<string, string>();

  if (semicolonIndex !== -1) {
    const paramString = raw.slice(semicolonIndex + 1);

    for (const pair of parseParameters(paramString)) {
      const eqIndex = pair.indexOf('=');
      if (eqIndex === -1) continue;

      const key = pair.slice(0, eqIndex).trim().toLowerCase();
      let value = pair.slice(eqIndex + 1).trim();

      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1).replace(/\\(.)/g, '$1');
      }

      params.set(key, value);
    }
  }

  return {
    mediaType,
    charset: params.get('charset')?.toLowerCase() ?? null,
    boundary: params.get('boundary') ?? null,
    params,
  };
}
