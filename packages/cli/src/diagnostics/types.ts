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
  why: string;
  where?: Location;
  how?: string;
  cycles?: Cycle[];
}

export interface BuildDiagnosticParams {
  severity: DiagnosticSeverity;
  reason: string;
  file?: string;
  symbol?: string;
  how?: string;
}
