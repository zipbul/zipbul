export interface SourceRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface Location {
  file: string;
  symbol?: string;
  range?: SourceRange;
}

export interface Diagnostic {
  why: string;
  where?: Location;
  how?: string;
  cause?: unknown;
}

export interface BuildDiagnosticParams {
  reason: string;
  file?: string;
  symbol?: string;
  how?: string;
  cause?: unknown;
}
