#!/usr/bin/env bun
import { parseArgs } from 'util';

import type { CommandOptions } from './types';

import { Logger } from '@zipbul/logger';
import { dev } from './dev.command';
import { build } from './build.command';
import { mcp } from './mcp.command';
import { DiagnosticError, reportDiagnostic } from '../diagnostics';

Logger.configure({ level: 'info' });

const logger = new Logger('CLI');

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  strict: false,
  options: {
    profile: {
      type: 'string',
    },
  },
});
const command = positionals[0];

const printUsage = (): void => {
  logger.info('Usage: zb <command>');
  logger.info('Commands:');
  logger.info('  dev    Generate AOT artifacts and watch');
  logger.info('  build  Generate build output');
  logger.info('  mcp    Start MCP server (no args)');
  logger.info('Options:');
  logger.info('  --profile <minimal|standard|full>');
};

const reportInvalidCommand = (value: string | undefined): void => {
  const commandValue = value ?? '(missing)';
  logger.error(`Unsupported command: ${commandValue}.`);
};

const createCommandOptions = (): CommandOptions => {
  const profile = typeof values.profile === 'string' ? values.profile : undefined;
  const options: CommandOptions = {};

  if (profile !== undefined) {
    options.profile = profile;
  }

  return options;
};

const commandOptions = createCommandOptions();

try {
  switch (command) {
    case 'dev':
      await dev(commandOptions);
      break;
    case 'build':
      await build(commandOptions);
      break;
    case 'mcp':
      await mcp(positionals.slice(1), commandOptions);
      break;
    case undefined:
      reportInvalidCommand(command);
      printUsage();
      process.exitCode = 1;
      break;
    default:
      reportInvalidCommand(command);
      printUsage();
      process.exitCode = 1;
  }
} catch (error) {
  if (error instanceof DiagnosticError) {
    reportDiagnostic(error.diagnostic);
  } else {
    logger.fatal(error instanceof Error ? error.message : 'Unknown error.');
  }

  process.exitCode = 1;
}
