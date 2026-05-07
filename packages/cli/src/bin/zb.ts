import { parseArgs } from 'util';

import type { CommandOptions } from './interfaces';

import { Logger } from '@zipbul/logger';
import { dev } from './dev';
import { build } from './build';
import { buildAdapter } from '../compiler/adapter-build';
import { DiagnosticError } from '../diagnostics';
import { CliRenderer } from './cli-renderer';
import { JsonRenderer } from './json-renderer';
import type { CliRendererLike } from './interfaces';

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
    json: {
      type: 'boolean',
    },
  },
});

const jsonMode = values.json === true;
const commandLabel = (() => {
  if (positionals[0] === 'build') {
    if (positionals[1] === 'adapter') return 'build adapter';
    if (values.lib === true) return 'build --lib';
    return 'build';
  }
  return positionals[0] ?? 'unknown';
})();

const renderer: CliRendererLike = jsonMode ? new JsonRenderer(commandLabel) : new CliRenderer();
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
  '  --json           Emit NDJSON log events (one JSON object per line) for ingestion',
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
      await dev(commandOptions, renderer);
      break;
    case 'build': {
      const subCommand = positionals[1];

      if (subCommand === 'adapter') {
        try {
          const result = await buildAdapter({ renderer });

          if (jsonMode) {
            renderer.success(`adapter ${result.adapterId} -> ${result.manifestPath}`);
          } else {
            // Preserve legacy non-JSON output contract — single-line ok blob.
            process.stdout.write(`${JSON.stringify({
              ok: true,
              adapterId: result.adapterId,
              manifestPath: result.manifestPath,
            })}\n`);
          }
        } catch (error) {
          if (jsonMode) {
            if (error instanceof DiagnosticError) {
              renderer.diagnostic(error.diagnostic);
            } else {
              renderer.error(error instanceof Error ? error.message : String(error));
            }
          } else {
            const why = error instanceof DiagnosticError ? error.diagnostic.why : (error instanceof Error ? error.message : String(error));
            const where = error instanceof DiagnosticError ? error.diagnostic.where : undefined;
            process.stderr.write(`${JSON.stringify({ ok: false, why, where: where ?? null })}\n`);
          }
          process.exitCode = 1;
        }

        break;
      }

      await build(commandOptions, renderer);
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
