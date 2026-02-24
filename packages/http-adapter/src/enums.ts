export enum HttpProtocol {
  Http,
  Https,
}

export enum HeaderField {
  SetCookie = 'set-cookie',
  ContentType = 'content-type',
  Location = 'location',
  Forwarded = 'forwarded',
  XForwardedFor = 'x-forwarded-for',
  XRealIp = 'x-real-ip',
  Origin = 'origin',
  Vary = 'vary',
  AccessControlAllowOrigin = 'access-control-allow-origin',
  AccessControlAllowMethods = 'access-control-allow-methods',
  AccessControlAllowHeaders = 'access-control-allow-headers',
  AccessControlExposeHeaders = 'access-control-expose-headers',
  AccessControlAllowCredentials = 'access-control-allow-credentials',
  AccessControlMaxAge = 'access-control-max-age',
  AccessControlRequestMethod = 'access-control-request-method',
  AccessControlRequestHeaders = 'access-control-request-headers',
}

export enum ContentType {
  Text = 'text/plain',
  Json = 'application/json',
}

export enum HttpMethod {
  Get = 'GET',
  Post = 'POST',
  Put = 'PUT',
  Patch = 'PATCH',
  Delete = 'DELETE',
  Head = 'HEAD',
  Options = 'OPTIONS',
}

export enum HttpMiddlewarePhase {
  BeforeRequest = 'BeforeRequest',
  AfterRequest = 'AfterRequest',
}
