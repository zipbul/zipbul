import { Get, RestController, type HttpContext } from '@zipbul/http-adapter';

/** Query shape for `GET /search` — types the `request.getQuery` result. */
export class SearchQueryDto {
  q?: string;
  city?: string;
}

/**
 * Demonstrates the query-parser middleware end-to-end: the `queryParser`
 * middleware (registered on `BeforeValidate`) parses the request query string
 * and installs a typed `request.getQuery(dto)` accessor, which this handler
 * reads back and returns.
 */
@RestController('search')
export class SearchController {
  @Get()
  search(ctx: HttpContext): SearchQueryDto {
    return ctx.request.getQuery(SearchQueryDto);
  }
}
