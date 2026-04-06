export interface ParsedRequestUrl {
  readonly protocol: string | null;
  readonly host: string | null;
  readonly hostname: string | null;
  readonly port: number;
  readonly path: string;
  readonly queryString: string | null;
}

export interface ParsedRequestTarget {
  readonly protocol: string | null;
  readonly authority: string | null;
  readonly path: string;
  readonly queryString: string | null;
}

export function extractHostname(host: string): string {
  if (host.startsWith('[')) {
    const closeBracket = host.indexOf(']');
    return closeBracket !== -1 ? host.slice(1, closeBracket) : host;
  }

  const colonIndex = host.indexOf(':');
  return colonIndex !== -1 ? host.slice(0, colonIndex) : host;
}

export function extractPort(host: string): string | null {
  if (host.startsWith('[')) {
    const portSeparator = host.indexOf(']:');
    return portSeparator !== -1 ? host.slice(portSeparator + 2) : null;
  }

  const colonIndex = host.indexOf(':');
  return colonIndex !== -1 ? host.slice(colonIndex + 1) : null;
}

export function defaultPortByProtocol(protocol: string | null): number {
  if (protocol === 'https') return 443;
  return 80;
}

export function parseRequestTarget(raw: string): ParsedRequestTarget | null {
  const schemeSeparator = raw.indexOf('://');
  if (schemeSeparator <= 0) return null;

  const protocol = raw.slice(0, schemeSeparator).toLowerCase();
  if (protocol.length === 0) return null;

  const authorityStart = schemeSeparator + 3;
  if (authorityStart >= raw.length) return null;

  const slashIndex = raw.indexOf('/', authorityStart);
  const queryIndex = raw.indexOf('?', authorityStart);
  const hashIndex = raw.indexOf('#', authorityStart);

  let authorityEnd = raw.length;
  if (slashIndex !== -1 && slashIndex < authorityEnd) authorityEnd = slashIndex;
  if (queryIndex !== -1 && queryIndex < authorityEnd) authorityEnd = queryIndex;
  if (hashIndex !== -1 && hashIndex < authorityEnd) authorityEnd = hashIndex;

  const authority = raw.slice(authorityStart, authorityEnd);
  if (authority.length === 0 || authority.includes('@')) {
    return null;
  }

  let pathStart = slashIndex;
  if (pathStart === -1 || pathStart > authorityEnd) {
    pathStart = authorityEnd;
  }

  let pathEnd = raw.length;
  if (queryIndex !== -1 && queryIndex < pathEnd) pathEnd = queryIndex;
  if (hashIndex !== -1 && hashIndex < pathEnd) pathEnd = hashIndex;

  const path = pathStart < pathEnd ? raw.slice(pathStart, pathEnd) : '/';
  const queryEnd = hashIndex !== -1 ? hashIndex : raw.length;
  const queryString = queryIndex !== -1 ? raw.slice(queryIndex, queryEnd) : null;
  return {
    protocol,
    authority,
    path: path.length > 0 ? path : '/',
    queryString,
  };
}

export function parseRequestUrl(raw: string): ParsedRequestUrl | null {
  const target = parseRequestTarget(raw);

  if (target === null || target.authority === null) {
    return null;
  }

  const host = target.authority.toLowerCase();
  const hostname = extractHostname(host).toLowerCase();
  const rawPort = extractPort(host);
  const parsedPort = rawPort !== null ? parseInt(rawPort, 10) : NaN;

  return {
    protocol: target.protocol,
    host,
    hostname,
    port: !Number.isNaN(parsedPort) ? parsedPort : defaultPortByProtocol(target.protocol),
    path: target.path,
    queryString: target.queryString,
  };
}
