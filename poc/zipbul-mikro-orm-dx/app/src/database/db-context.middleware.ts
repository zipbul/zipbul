import { defineMiddleware } from '@zipbul/common';
import { HttpAdapter } from '@zipbul/http-adapter';
import { enterRequestContext } from '@zipbul/mikro-orm';
export const dbContext = defineMiddleware([HttpAdapter], () => enterRequestContext());
