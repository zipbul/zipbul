import { HttpStatus } from './enums/http-status';

export const HTTP_STATUS_REASON: Readonly<Record<HttpStatus, string>> = Object.freeze({
  [HttpStatus.Continue]: 'Continue',
  [HttpStatus.SwitchingProtocols]: 'Switching Protocols',
  [HttpStatus.Processing]: 'Processing',
  [HttpStatus.EarlyHints]: 'Early Hints',

  [HttpStatus.Ok]: 'OK',
  [HttpStatus.Created]: 'Created',
  [HttpStatus.Accepted]: 'Accepted',
  [HttpStatus.NonAuthoritativeInformation]: 'Non-Authoritative Information',
  [HttpStatus.NoContent]: 'No Content',
  [HttpStatus.ResetContent]: 'Reset Content',
  [HttpStatus.PartialContent]: 'Partial Content',
  [HttpStatus.MultiStatus]: 'Multi-Status',
  [HttpStatus.AlreadyReported]: 'Already Reported',
  [HttpStatus.ImUsed]: 'IM Used',

  [HttpStatus.MultipleChoices]: 'Multiple Choices',
  [HttpStatus.MovedPermanently]: 'Moved Permanently',
  [HttpStatus.Found]: 'Found',
  [HttpStatus.SeeOther]: 'See Other',
  [HttpStatus.NotModified]: 'Not Modified',
  [HttpStatus.UseProxy]: 'Use Proxy',
  [HttpStatus.TemporaryRedirect]: 'Temporary Redirect',
  [HttpStatus.PermanentRedirect]: 'Permanent Redirect',

  [HttpStatus.BadRequest]: 'Bad Request',
  [HttpStatus.Unauthorized]: 'Unauthorized',
  [HttpStatus.PaymentRequired]: 'Payment Required',
  [HttpStatus.Forbidden]: 'Forbidden',
  [HttpStatus.NotFound]: 'Not Found',
  [HttpStatus.MethodNotAllowed]: 'Method Not Allowed',
  [HttpStatus.NotAcceptable]: 'Not Acceptable',
  [HttpStatus.ProxyAuthenticationRequired]: 'Proxy Authentication Required',
  [HttpStatus.RequestTimeout]: 'Request Timeout',
  [HttpStatus.Conflict]: 'Conflict',
  [HttpStatus.Gone]: 'Gone',
  [HttpStatus.LengthRequired]: 'Length Required',
  [HttpStatus.PreconditionFailed]: 'Precondition Failed',
  [HttpStatus.ContentTooLarge]: 'Content Too Large',
  [HttpStatus.UriTooLong]: 'URI Too Long',
  [HttpStatus.UnsupportedMediaType]: 'Unsupported Media Type',
  [HttpStatus.RangeNotSatisfiable]: 'Range Not Satisfiable',
  [HttpStatus.ExpectationFailed]: 'Expectation Failed',
  [HttpStatus.ImATeapot]: "I'm a teapot",
  [HttpStatus.MisdirectedRequest]: 'Misdirected Request',
  [HttpStatus.UnprocessableContent]: 'Unprocessable Content',
  [HttpStatus.Locked]: 'Locked',
  [HttpStatus.FailedDependency]: 'Failed Dependency',
  [HttpStatus.TooEarly]: 'Too Early',
  [HttpStatus.UpgradeRequired]: 'Upgrade Required',
  [HttpStatus.PreconditionRequired]: 'Precondition Required',
  [HttpStatus.TooManyRequests]: 'Too Many Requests',
  [HttpStatus.RequestHeaderFieldsTooLarge]: 'Request Header Fields Too Large',
  [HttpStatus.UnavailableForLegalReasons]: 'Unavailable For Legal Reasons',

  [HttpStatus.InternalServerError]: 'Internal Server Error',
  [HttpStatus.NotImplemented]: 'Not Implemented',
  [HttpStatus.BadGateway]: 'Bad Gateway',
  [HttpStatus.ServiceUnavailable]: 'Service Unavailable',
  [HttpStatus.GatewayTimeout]: 'Gateway Timeout',
  [HttpStatus.HttpVersionNotSupported]: 'HTTP Version Not Supported',
  [HttpStatus.VariantAlsoNegotiates]: 'Variant Also Negotiates',
  [HttpStatus.InsufficientStorage]: 'Insufficient Storage',
  [HttpStatus.LoopDetected]: 'Loop Detected',
  [HttpStatus.NotExtended]: 'Not Extended',
  [HttpStatus.NetworkAuthenticationRequired]: 'Network Authentication Required',
});

export const FORBIDDEN_HTTP_METHODS = ['TRACE', 'CONNECT'] as const;

export const HTTP_STATUS_MIN = 100;
export const HTTP_STATUS_MAX = 599;

export const DEFAULT_HTTP_PORT = 5000;
export const DEFAULT_BODY_LIMIT_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_URI_LENGTH = 8192;
export const DEFAULT_IDLE_TIMEOUT_SECONDS = 30;

export const HTTP_DEFAULT_PORT = 80;
export const HTTPS_DEFAULT_PORT = 443;

export const DEFAULT_CHARSET = 'utf-8';

export const REQUEST_ID_MIN_LENGTH = 1;
export const REQUEST_ID_MAX_LENGTH = 256;
export const FORWARDED_HOST_MIN_LENGTH = 1;
export const FORWARDED_HOST_MAX_LENGTH = 255;

export const ASCII_PRINTABLE_MIN = 0x20;
export const ASCII_PRINTABLE_MAX = 0x7e;
export const FORWARDED_HOST_BYTE_MIN = 0x21;
export const FORWARDED_HOST_BYTE_MAX = 0x7e;

export const IPV4_PREFIX_MAX = 32;
export const IPV6_PREFIX_MAX = 128;
export const IPV6_GROUP_MAX = 0xffff;

export const SSE_DATA_PREFIX = 'data: ';
export const SSE_EVENT_PREFIX = 'event: ';
export const SSE_ID_PREFIX = 'id: ';
export const SSE_RETRY_PREFIX = 'retry: ';
export const SSE_FRAME_TERMINATOR = '\n\n';

export const CACHE_CONTROL_NO_CACHE = 'no-cache';
export const CONNECTION_KEEP_ALIVE = 'keep-alive';
export const X_ACCEL_BUFFERING_OFF = 'no';

export const TEXT_ENCODER = new TextEncoder();

export const HTTP_CONTEXT_TYPE = 'http';
