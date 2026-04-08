#!/usr/bin/env bun
import { parseArgs } from 'util';

import type { CommandOptions } from './interfaces';

import { Logger } from '@zipbul/logger';
import { dev } from './dev';
import { build } from './build';
import { DiagnosticError } from '../diagnostics';
import { CliRenderer } from './cli-renderer';

const renderer = new CliRenderer();

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  strict: false,
  options: {
    profile: {
      type: 'string',
    },
    verbose: {
      type: 'boolean',
      short: 'v',
    },
  },
});
const command = positionals[0];
const verbose = values.verbose === true;

const resolveLogLevel = (): 'trace' | 'debug' | 'info' => {
  if (verbose) {
    return 'trace';
  }

  return command === 'dev' ? 'debug' : 'info';
};

const logLevel = resolveLogLevel();
process.env.LOG_LEVEL = logLevel;
Logger.configure({ level: logLevel });

const USAGE_TEXT = [
  'Usage: zb <command>',
  '',
  'Commands:',
  '  dev    Generate AOT artifacts and watch',
  '  build  Generate build output',
  '',
  'Options:',
  '  --profile <minimal|standard|full>',
  '  --verbose, -v  Show detailed build information',
].join('\n');

const printUsage = (): void => {
  renderer.info(USAGE_TEXT);
};

const reportInvalidCommand = (value: string | undefined): void => {
  const commandValue = value ?? '(missing)';
  renderer.error(`Unsupported command: ${commandValue}.`);
};

const createCommandOptions = (): CommandOptions => {
  const profile = typeof values.profile === 'string' ? values.profile : undefined;
  const verbose = values.verbose === true;
  const options: CommandOptions = {};

  if (profile !== undefined) {
    options.profile = profile;
  }

  if (verbose) {
    options.verbose = true;
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
    renderer.diagnostic(error.diagnostic);
  } else {
    renderer.error(error instanceof Error ? error.message : 'Unknown error.');
  }

  process.exitCode = 1;
}
