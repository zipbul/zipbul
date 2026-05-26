import { defineMiddleware } from '@zipbul/common';
import { inject } from '@zipbul/core';
import { HttpAdapter } from '@zipbul/http-adapter';
import { Database } from './orm.service';
export const dbContext = defineMiddleware([HttpAdapter], () => { const db = inject(Database); return () => db.enter(); });
