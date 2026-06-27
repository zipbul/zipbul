import type { Router } from '@zipbul/router';
import type { Logger } from '@zipbul/logger';
import type { MatchedRouteMetadata } from '../interfaces';

export function addWithHeadAlias(args: {
  router: Router<MatchedRouteMetadata>;
  method: string;
  path: string;
  entry: MatchedRouteMetadata;
  registeredMethods: Set<string>;
  logger: Logger;
  sourceLabel: string;
}): void {
  const { router, method, path, entry, registeredMethods, logger, sourceLabel } = args;

  router.add(method, path, entry);
  registeredMethods.add(method);
  logger.debug(`${method} ${path}${sourceLabel}`);

  if (method === 'GET') {
    router.add('HEAD', path, entry);
    registeredMethods.add('HEAD');
    logger.debug(`HEAD ${path} (auto from GET)${sourceLabel}`);
  }
}
