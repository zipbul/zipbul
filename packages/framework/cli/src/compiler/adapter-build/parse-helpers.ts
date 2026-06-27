import type { ExpressionCall, ExpressionValue } from '@zipbul/gildash';

import { diag } from './diag';
import type { PipelineRef } from './interfaces';

export function readIdentifierField(call: ExpressionCall, fieldName: string): string | null {
  const firstArg = call.arguments[0];

  if (firstArg === undefined || firstArg.kind !== 'object') return null;

  for (const prop of firstArg.properties) {
    if (prop.kind === 'spread') continue;
    if (prop.key.kind !== 'string' || prop.key.value !== fieldName) continue;

    const value: ExpressionValue = prop.value;

    if (value.kind === 'identifier') return value.name;
  }

  return null;
}

export function readPipelineField(call: ExpressionCall): readonly PipelineRef[] | null {
  const firstArg = call.arguments[0];

  if (firstArg === undefined || firstArg.kind !== 'object') return null;

  for (const prop of firstArg.properties) {
    if (prop.kind === 'spread') continue;
    if (prop.key.kind !== 'string' || prop.key.value !== 'pipeline') continue;

    if (prop.value.kind !== 'array') return null;

    const refs: PipelineRef[] = [];

    for (const element of prop.value.elements) {
      if (element.kind !== 'member') return null;

      refs.push({ qualifier: element.object, name: element.property });
    }

    if (refs.length === 0) return null;

    return refs;
  }

  return null;
}

export function readIdentifierArray(value: ExpressionValue, label: string, filePath: string): readonly string[] {
  if (value.kind !== 'array') {
    throw diag({
      reason: `${label} in ${filePath} must be an array literal of identifier references.`,
      file: filePath,
    });
  }

  const out: string[] = [];

  for (const element of value.elements) {
    if (element.kind !== 'identifier') {
      throw diag({
        reason: `${label} in ${filePath} must contain only identifier references (no spreads, calls, or literals).`,
        file: filePath,
      });
    }
    out.push(element.name);
  }

  return out;
}

export function ensureUnique(names: readonly string[], filePath: string): void {
  const seen = new Set<string>();
  const dupes = new Set<string>();

  for (const name of names) {
    if (seen.has(name)) dupes.add(name);
    seen.add(name);
  }

  if (dupes.size > 0) {
    throw diag({
      reason: `Duplicate decorator name(s) [${[...dupes].join(', ')}] in ${filePath}.`,
      file: filePath,
    });
  }
}
