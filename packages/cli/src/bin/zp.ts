#!/usr/bin/env bun
import { parseArgs } from 'util';

import type { CommandOptions } from './types';

import { dev } from './dev.command';
import { build } from './build.command';
import { mcp } from './mcp.command';
import { buildDiagnostic, reportDiagnostics } from '../diagnostics';

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
  console.info('Usage: zp <command>');
  console.info('Commands:');
  console.info('  dev    Generate AOT artifacts and watch');
  console.info('  build  Generate build output');
  console.info('  mcp    Start MCP server (no args)');
  console.info('Options:');
  console.info('  --profile <minimal|standard|full>');
};

const reportInvalidCommand = (value: string | undefined): void => {
  const commandValue = value ?? '(missing)';
  const diagnostic = buildDiagnostic({
    code: 'INVALID_COMMAND',
    severity: 'fatal',
    summary: 'Unknown command.',
    reason: `Unsupported command: ${commandValue}.`,
    file: '.',
  });

  reportDiagnostics({ diagnostics: [diagnostic] });
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
} catch (_error) {
  process.exitCode = 1;
}
