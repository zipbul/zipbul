import { parseArgs } from 'util';

import type { CommandOptions } from './interfaces';

import { Logger } from '@zipbul/logger';
import { dev } from './dev';
import { build } from './build';
import { buildAdapter } from '../compiler/adapter-build';
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
    lib: {
      type: 'boolean',
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
  '  dev              Generate AOT artifacts and watch',
  '  build            Generate build output',
  '  build adapter    Compile an adapter package (zipbul.kind === "adapter")',
  '',
  'Common options:',
  '  --profile <minimal|standard|full>',
  '  --lib            Build as library (inject __augments metadata for npm packages)',
  '  --verbose, -v    Show detailed build information',
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

  if (values.lib === true) {
    options.lib = true;
  }

  return options;
};

const commandOptions = createCommandOptions();

try {
  switch (command) {
    case 'dev':
      await dev(commandOptions);
      break;
    case 'build': {
      const subCommand = positionals[1];

      if (subCommand === 'adapter') {
        try {
          const result = await buildAdapter();

          process.stdout.write(`${JSON.stringify({
            ok: true,
            adapterId: result.adapterId,
            manifestPath: result.manifestPath,
          })}\n`);
        } catch (error) {
          const why = error instanceof DiagnosticError ? error.diagnostic.why : (error instanceof Error ? error.message : String(error));
          const where = error instanceof DiagnosticError ? error.diagnostic.where : undefined;
          process.stderr.write(`${JSON.stringify({ ok: false, why, where: where ?? null })}\n`);
          process.exitCode = 1;
        }

        break;
      }

      await build(commandOptions);
      break;
    }
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
