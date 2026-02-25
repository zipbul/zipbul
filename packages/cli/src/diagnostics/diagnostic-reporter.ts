import { Logger } from '@zipbul/logger';

import type { Diagnostic } from './types';

const logger = new Logger('Diagnostic');

export function reportDiagnostic(diagnostic: Diagnostic): void {
  if (diagnostic.severity === 'error') {
    logger.error(diagnostic.why, { diagnostic });
  } else {
    logger.warn(diagnostic.why, { diagnostic });
  }
}
