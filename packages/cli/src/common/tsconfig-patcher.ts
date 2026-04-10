import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const ZIPBUL_DTS_GLOB = '.zipbul/**/*.d.ts';

/**
 * Ensures the project tsconfig.json includes the zipbul declaration glob so
 * that IDEs recognize generated declaration files (e.g. context.d.ts).
 *
 * Reads tsconfig.json from projectRoot, parses it (stripping single-line
 * comments and trailing commas), adds the glob to include if missing, and
 * writes the file back only if a change was made.
 *
 * @param projectRoot - Absolute path to the project root directory.
 * @returns true if tsconfig.json was modified, false otherwise.
 * @public
 */
export async function ensureTsconfigIncludesZipbul(projectRoot: string): Promise<boolean> {
  const tsconfigPath = join(projectRoot, 'tsconfig.json');

  let raw: string;

  try {
    raw = await readFile(tsconfigPath, 'utf-8');
  } catch {
    return false;
  }

  const parsed = parseJsonWithComments(raw);

  if (!isRecord(parsed)) {
    return false;
  }

  let include = parsed.include;

  if (!Array.isArray(include)) {
    include = [];
    parsed.include = include;
  }

  const includeArray = include satisfies unknown[];

  if (includeArray.some((entry) => entry === ZIPBUL_DTS_GLOB)) {
    return false;
  }

  includeArray.push(ZIPBUL_DTS_GLOB);

  const updated = JSON.stringify(parsed, null, 2) + '\n';

  await writeFile(tsconfigPath, updated, 'utf-8');

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Parses JSON content that may contain single-line comments and trailing commas.
 * Returns null if parsing fails.
 */
function parseJsonWithComments(raw: string): unknown {
  const stripped = raw
    .replace(/\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');

  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}
