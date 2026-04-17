interface OptionEntry {
  readonly name: string;
  readonly arguments?: readonly unknown[];
}

interface RedirectSpec {
  readonly url: string;
  readonly status?: 301 | 302 | 303 | 307 | 308;
}

export interface ParsedDecoratorOptions {
  readonly rawBody: boolean;
  readonly sse: boolean;
  readonly bodyLimit: number | undefined;
  readonly status: number | undefined;
  readonly redirect: RedirectSpec | undefined;
  readonly contentType: string | undefined;
  readonly headers: readonly (readonly [string, string])[];
}

export function parseDecoratorOptions(options: readonly OptionEntry[] | undefined): ParsedDecoratorOptions {
  let rawBody = false;
  let sse = false;
  let bodyLimit: number | undefined;
  let status: number | undefined;
  let redirect: RedirectSpec | undefined;
  let contentType: string | undefined;
  const headers: Array<readonly [string, string]> = [];

  if (options === undefined) {
    return { rawBody, sse, bodyLimit, status, redirect, contentType, headers };
  }

  for (const option of options) {
    switch (option.name) {
      case 'RawBody':
        rawBody = true;
        break;
      case 'Sse':
        sse = true;
        break;
      case 'BodyLimit':
        if (typeof option.arguments?.[0] === 'number') {
          bodyLimit = option.arguments[0];
        }
        break;
      case 'Status':
        if (typeof option.arguments?.[0] === 'number') {
          status = option.arguments[0];
        }
        break;
      case 'Redirect':
        if (typeof option.arguments?.[0] === 'string') {
          redirect = {
            url: option.arguments[0],
            ...(option.arguments?.[1] !== undefined ? { status: option.arguments[1] as 301 | 302 | 303 | 307 | 308 } : {}),
          };
        }
        break;
      case 'ContentType':
        if (typeof option.arguments?.[0] === 'string') {
          contentType = option.arguments[0];
        }
        break;
      case 'Header':
        if (typeof option.arguments?.[0] === 'string' && typeof option.arguments?.[1] === 'string') {
          headers.push([option.arguments[0], option.arguments[1]] as const);
        }
        break;
    }
  }

  return { rawBody, sse, bodyLimit, status, redirect, contentType, headers };
}
