// Editor-graph DTOs shared by the compile core (flow-runtime-mapper) and the studio service (flow.service).
// Extracted verbatim from ai-application flow.service.ts so the replicated compiler can import them
// without depending on the full service module (ADR-0014).

export interface FlowEditorNode {
  id: string;
  componentKey: string;
  label?: string | null;
  position?: { x?: number; y?: number } | null;
  data?: Record<string, unknown> | null;
}

export interface FlowEditorEdge {
  id: string;
  source: string;
  target: string;
  sourcePort?: string | null;
  targetPort?: string | null;
  data?: Record<string, unknown> | null;
}

export interface FlowEditorGraph {
  schemaVersion?: string;
  nodes: FlowEditorNode[];
  edges: FlowEditorEdge[];
  metadata?: Record<string, unknown> | null;
}
