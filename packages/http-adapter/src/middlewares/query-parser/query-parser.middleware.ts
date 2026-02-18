import { Middleware, ZipbulMiddleware, type Context } from '@zipbul/common';

import type { QueryParserOptions } from './interfaces';

import { ZipbulHttpContext } from '../../adapter';
import { QueryParser } from './query-parser';

@Middleware()
export class QueryParserMiddleware extends ZipbulMiddleware<QueryParserOptions> {
  private readonly parser: QueryParser;

  constructor(options: QueryParserOptions = {}) {
    super();

    this.parser = new QueryParser(options);
  }

  public handle(context: Context): void {
    const http = this.assertHttpContext(context);
    const req = http.request;
    const questionIndex = req.url.indexOf('?');

    if (questionIndex === -1) {
      req.query = {};

      return;
    }

    const queryString = req.url.slice(questionIndex + 1);

    if (queryString.length === 0) {
      req.query = {};

      return;
    }

    req.query = this.parser.parse(queryString);
  }

  private assertHttpContext(context: Context): ZipbulHttpContext {
    if (context instanceof ZipbulHttpContext) {
      return context;
    }

    throw new Error('Expected ZipbulHttpContext');
  }
}
