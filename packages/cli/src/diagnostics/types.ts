export type DiagnosticSeverity = 'error' | 'warning';

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

export interface DiagnosticHint {
  title: string;
  details?: string;
}

export interface CycleNode {
  id: string;
  location?: Location;
}

export interface CycleEdge {
  from: string;
  to: string;
  label?: string;
  location?: Location;
}

export interface Cycle {
  kind: string;
  nodes: CycleNode[];
  edges: CycleEdge[];
}

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  summary: string;
  why: string;
  where: Location[];
  how: DiagnosticHint[];
  cycles?: Cycle[];
}

export interface ReportDiagnosticsParams {
  diagnostics: Diagnostic[];
}

export interface BuildDiagnosticParams {
  code: string;
  severity: DiagnosticSeverity;
  summary: string;
  reason: string;
}
