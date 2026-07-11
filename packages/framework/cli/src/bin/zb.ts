import { parseArgs } from 'util';

import pkgJson from '../../package.json' with { type: 'json' };

import type { CommandOptions } from './interfaces';

import { Logger } from '@zipbul/logger';
import { dev } from './dev';
import { build, buildMiddleware } from './build';
import { buildAdapter } from '../compiler/adapter-build';
import { createMiddleware, CreateError } from './create';
import { reportError } from './report-diagnostic';

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  strict: false,
  options: {
    verbose: { type: 'boolean', short: 'v' },
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
  '  dev                 Generate AOT artifacts and watch for changes',
  '  build               Build the user app (default — produces dist/entry.js + runtime)',
  '  build adapter       Compile an adapter package (package.json#zipbul.kind === "adapter")',
  '  build middleware    Compile a middleware library package (package.json#zipbul.kind === "middleware")',
  '  create middleware   Scaffold a new middleware package (<name>, kebab-case)',
  '',
  'Common options:',
  '  --verbose, -v      Show detailed build information',
  '  --help, -h         Show this help',
  '  --version          Print zb version',
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
          reportError(error, 'adapter');
          process.exitCode = 1;
        }
        break;
      }

      if (subCommand === 'middleware') {
        try {
          await buildMiddleware();
        } catch (error) {
          reportError(error, 'build/middleware');
          process.exitCode = 1;
        }
        break;
      }

      if (subCommand !== undefined) {
        log.error('unsupported subcommand: build %s', subCommand);
        process.stdout.write(USAGE_TEXT + '\n');
        process.exitCode = 1;
        break;
      }

      await build(commandOptions);
      break;
    }
    case 'create': {
      const kind = positionals[1];

      if (kind !== 'middleware') {
        if (kind === 'adapter' || kind === 'provider') {
          log.error('create %s is not yet supported — only `create middleware` is available', kind);
        } else {
          log.error('usage: zb create middleware <name>');
        }
        process.stdout.write(USAGE_TEXT + '\n');
        process.exitCode = 1;
        break;
      }

      const name = positionals[2];

      try {
        const result = await createMiddleware(name ?? '');
        // Program output (paths + next step) goes to stdout, not the log stream.
        process.stdout.write(`Created ${result.name} (${result.files.length} files) at ${result.targetDir}\n`);
        for (const file of result.files) {
          process.stdout.write(`  ${file}\n`);
        }
        process.stdout.write(
          `\nNext: add \`${result.camelName}Middleware()\` to your defineModule middlewares.\n`,
        );
      } catch (error) {
        if (error instanceof CreateError) {
          log.error('%s', error.message);
          process.exitCode = 1;
          break;
        }
        throw error;
      }
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
  reportError(error, 'zb');
  process.exitCode = 1;
}
