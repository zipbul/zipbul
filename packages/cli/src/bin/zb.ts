import { parseArgs } from 'util';

import pkgJson from '../../package.json' with { type: 'json' };

import type { CommandOptions } from './interfaces';

import { Logger } from '@zipbul/logger';
import { dev } from './dev';
import { build } from './build';
import { buildAdapter } from '../compiler/adapter-build';
import { reportDiagnosticError } from './report-diagnostic';

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  strict: false,
  options: {
    verbose: { type: 'boolean', short: 'v' },
    lib: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean' },
  },
});

if (values.version === true) {
  const version = typeof pkgJson.version === 'string' ? pkgJson.version : '0.0.0';
  // Direct stdout — `--version` is program output, not a log event, so it
  // bypasses LOG_LEVEL filtering and the `info: [zb]` prefix.
  process.stdout.write(`zb ${version}\n`);
  process.exit(0);
}

const command = positionals[0];
const verbose = values.verbose === true;

const resolveLogLevel = (): 'trace' | 'debug' | 'info' => {
  if (verbose) return 'trace';
  return command === 'dev' ? 'debug' : 'info';
};

const logLevel = resolveLogLevel();
process.env.LOG_LEVEL = logLevel;
Logger.configure({ level: logLevel });

const USAGE_TEXT = [
  'Usage: zb <command>',
  '',
  'Commands:',
  '  dev              Generate AOT artifacts and watch for changes',
  '  build            Generate build output',
  '  build adapter    Compile an adapter package (zipbul.kind === "adapter")',
  '',
  'Common options:',
  '  --lib            Build as library (inject __augments metadata for npm packages)',
  '  --verbose, -v    Show detailed build information',
  '  --help, -h       Show this help',
  '  --version        Print zb version',
].join('\n');

if (values.help === true) {
  process.stdout.write(USAGE_TEXT + '\n');
  process.exit(0);
}

const log = new Logger('zb');

const reportInvalidCommand = (value: string | undefined): void => {
  log.error('unsupported command: %s', value ?? '(missing)');
  process.stdout.write(USAGE_TEXT + '\n');
};

const createCommandOptions = (): CommandOptions => {
  const options: CommandOptions = {};
  if (verbose) options.verbose = true;
  if (values.lib === true) options.lib = true;
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
          const result = await buildAdapter({
            ...(commandOptions.verbose === true ? { verbose: true } : {}),
          });
          new Logger('adapter').info('built %s manifest=%s', result.adapterId, result.manifestPath);
        } catch (error) {
          reportDiagnosticError(error, 'adapter');
          process.exitCode = 1;
        }
        break;
      }

      await build(commandOptions);
      break;
    }
    case undefined:
      reportInvalidCommand(command);
      process.exitCode = 1;
      break;
    default:
      reportInvalidCommand(command);
      process.exitCode = 1;
  }
} catch (error) {
  reportDiagnosticError(error, 'zb');
  process.exitCode = 1;
}
