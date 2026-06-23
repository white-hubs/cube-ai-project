export type CapabilityKind = 'json' | 'sse' | 'form-data' | 'text-plain' | 'composable' | 'mock';

export interface CapabilityParam {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'json' | 'form-data' | 'file';
  required?: boolean;
  description?: string;
  /** Positional index when invoking the SDK method. */
  position?: number;
  /** HTTP placement hint for playground UI. */
  placement?: 'path' | 'query' | 'body' | 'positional';
}

export interface CapabilityEntry {
  id: string;
  package: string;
  domain: 'agent' | 'flow' | 'kb' | 'llm';
  face: 'client' | 'console' | 'vue' | 'assistant' | 'mock';
  factory: string;
  /** Nested API on client, e.g. `sessions` for `sessions.list`. */
  apiPath?: string;
  method: string;
  kind: CapabilityKind;
  params: CapabilityParam[];
  description?: string;
}

export interface CapabilitiesManifest {
  generatedAt: string;
  entries: CapabilityEntry[];
}

export interface ConnectionProfile {
  /** User-defined same-origin path prefix for SDK requests (e.g. `/api`, `/api/ai-center`). */
  sdkPathPrefix: string;
  /** Upstream origin only — path is forwarded from the browser request as-is. */
  proxyTarget: string;
  headers: Record<string, string>;
  pathPrefixOverrides: Record<string, string>;
}

export interface InvokeResult {
  ok: boolean;
  kind: CapabilityKind;
  data?: unknown;
  error?: string;
  sseEvents?: Array<{ event: string; data: unknown }>;
}
