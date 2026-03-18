import type { FileAnalysis, ParseResult } from '../compiler/analyzer';

/**
 * Converts a {@link ParseResult} into a {@link FileAnalysis} by copying only
 * the defined optional fields. This avoids the repetitive `undefined` check
 * pattern duplicated across `build.command.ts` and `dev.command.ts`.
 *
 * @param filePath - Absolute path of the analysed source file
 * @param parseResult - Output of {@link AstParser.parse}
 * @returns A fully populated {@link FileAnalysis}
 *
 * @public
 */
export function buildFileAnalysis(filePath: string, parseResult: ParseResult): FileAnalysis {
  const analysis: FileAnalysis = {
    filePath,
    classes: parseResult.classes,
    reExports: parseResult.reExports,
    exports: parseResult.exports,
  };

  if (parseResult.createApplicationCalls !== undefined) {
    analysis.createApplicationCalls = parseResult.createApplicationCalls;
  }

  if (parseResult.defineModuleCalls !== undefined) {
    analysis.defineModuleCalls = parseResult.defineModuleCalls;
  }

  if (parseResult.injectCalls !== undefined) {
    analysis.injectCalls = parseResult.injectCalls;
  }

  if (parseResult.imports !== undefined) {
    analysis.imports = parseResult.imports;
  }

  if (parseResult.importEntries !== undefined) {
    analysis.importEntries = parseResult.importEntries;
  }

  if (parseResult.exportedValues !== undefined) {
    analysis.exportedValues = parseResult.exportedValues;
  }

  if (parseResult.localValues !== undefined) {
    analysis.localValues = parseResult.localValues;
  }

  if (parseResult.moduleDefinition !== undefined) {
    analysis.moduleDefinition = parseResult.moduleDefinition;
  }

  return analysis;
}
