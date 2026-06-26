import type { FileAnalysis } from '../graph/interfaces';
import type { AnalyzerValue } from '../types';
import type { Result } from '@zipbul/result';
import type { Diagnostic } from '../../../diagnostics';

import { ZIPBUL_REF, ZIPBUL_IMPORT_SOURCE } from '@zipbul/common';
import { err } from '@zipbul/result';
import { buildDiagnostic } from '../../../diagnostics';
import { AstParser } from '../parser';
import { toRecord } from '../type-guards';
import { resolveEnumMemberMap } from './enum-type-resolver';

/**
 * Resolves a single phase-key expression to its concrete string value.
 *
 * A phase key — the key of a `middlewares` config object, or the phase argument
 * of `@UseMiddlewares` — may be authored as:
 *
 * - a string literal (`'OnRequest'`) — returned unchanged;
 * - a phase-enum member reference (`HttpAdapterPhase.OnRequest`), captured as
 *   `{ [ZIPBUL_REF]: 'HttpAdapterPhase.OnRequest' }` — resolved to the enum
 *   member's **value** via {@link resolveEnumMemberMap} (chasing barrel
 *   re-exports to the declaring file).
 *
 * The runtime keys an adapter's `validPhases` by enum value, so this always
 * resolves to the value, never the member name. An enum member that cannot be
 * resolved is a hard error rather than a silent passthrough — silently keeping
 * the member name would only happen to work for value-identical enums and
 * would mask a real resolution gap.
 *
 * @param keyValue - The analyzed phase-key expression (string or ref record).
 * @param fileMap - File analyses, for enum resolution + on-demand parsing.
 * @param parser - Parser used to load enum-declaring files not yet analyzed.
 * @returns The resolved phase string, or a diagnostic on an unresolvable member.
 * @public
 */
export async function resolvePhaseId(
  keyValue: AnalyzerValue,
  fileMap: Map<string, FileAnalysis>,
  parser: AstParser,
): Promise<Result<string, Diagnostic>> {
  if (typeof keyValue === 'string') {
    return keyValue;
  }

  const record = toRecord(keyValue);
  const ref = record !== null && typeof record[ZIPBUL_REF] === 'string' ? record[ZIPBUL_REF] : null;

  if (ref === null) {
    return err(buildDiagnostic({
      reason: 'A middleware phase key must be a string literal or a phase-enum member (e.g. `HttpAdapterPhase.OnRequest`).',
      how: 'Use the adapter\'s phase enum member or its string value as the key.',
    }));
  }

  const dotIndex = ref.indexOf('.');

  if (dotIndex === -1) {
    return err(buildDiagnostic({
      reason: `Cannot use \`${ref}\` as a middleware phase key — a bare identifier is not a phase-enum member.`,
      how: 'Reference a phase-enum member (`HttpAdapterPhase.OnRequest`) or pass the phase string literal.',
    }));
  }

  const enumName = ref.slice(0, dotIndex);
  const memberName = ref.slice(dotIndex + 1);
  const importSource = typeof record?.[ZIPBUL_IMPORT_SOURCE] === 'string' ? record[ZIPBUL_IMPORT_SOURCE] : null;

  const members = await resolveEnumMemberMap(enumName, importSource, fileMap, parser);
  const value = members?.get(memberName);

  if (value === undefined) {
    return err(buildDiagnostic({
      reason: `Cannot resolve phase-enum member \`${ref}\` to a value.`,
      how: `Verify \`${enumName}\` is the adapter's phase enum and \`${memberName}\` is one of its members. The enum must be reachable from the import so the compiler can read its values.`,
    }));
  }

  return value;
}
