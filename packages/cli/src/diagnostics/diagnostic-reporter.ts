import { Logger } from '@zipbul/logger';

import type { Diagnostic } from './types';

const logger = new Logger('Diagnostic');

export function reportDiagnostic(diagnostic: Diagnostic): void {
  const parts: string[] = [diagnostic.why];

  if (diagnostic.where !== undefined) {
    const loc = diagnostic.where.symbol !== undefined
      ? `${diagnostic.where.file} (${diagnostic.where.symbol})`
      : diagnostic.where.file;
    parts.push(`  at ${loc}`);
  }

  if (diagnostic.how !== undefined) {
    parts.push(`  fix: ${diagnostic.how}`);
  }

  const message = parts.join('\n');

  logger.fatal(message);
}
