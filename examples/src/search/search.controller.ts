import { UseMiddlewares } from '@zipbul/common';
import { Get, RestController, type HttpContext } from '@zipbul/http-adapter';
import { queryParser } from '@zipbul/query-parser';

/** Query shape for `GET /search` — types the `request.getQuery` result. */
export class SearchQueryDto {
  q?: string;
  city?: string;
}

/**
 * Demonstrates the query-parser middleware end-to-end: the `queryParser`
 * middleware (attached on `BeforeValidate` via @UseMiddlewares) parses the
 * request query string and installs a typed `request.getQuery(dto)` accessor,
 * which this handler reads back and returns.
 *
 * Registration is on the controller (not a runtime `addMiddlewares`) so the AOT
 * build statically wires it into this handler's pipeline — `BeforeValidate` is a
 * compiledPre phase and only a static @UseMiddlewares is analyzed.
 */
@RestController('search')
@UseMiddlewares('BeforeValidate', [queryParser])
export class SearchController {
  @Get()
  search(ctx: HttpContext): SearchQueryDto {
    return ctx.request.getQuery(SearchQueryDto);
  }
}
