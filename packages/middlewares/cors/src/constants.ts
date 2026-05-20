import { HttpMethod, HttpStatus } from '@zipbul/http-adapter';

export const CORS_DEFAULT_METHODS = [
  HttpMethod.Get,
  HttpMethod.Head,
  HttpMethod.Put,
  HttpMethod.Patch,
  HttpMethod.Post,
  HttpMethod.Delete,
] as const satisfies readonly HttpMethod[];

export const CORS_DEFAULT_OPTIONS_SUCCESS_STATUS = HttpStatus.NoContent;
