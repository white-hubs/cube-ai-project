export type LlmSchemaFieldType = 'string' | 'boolean' | 'integer' | 'number' | 'enum';

export interface LlmSchemaFieldOption extends Record<string, unknown> {
  label: string;
  value: string;
}

export interface LlmSchemaField extends Record<string, unknown> {
  key: string;
  label?: string;
  type: LlmSchemaFieldType;
  required?: boolean;
  description?: string;
  defaultValue?: string | number | boolean | null;
  options?: LlmSchemaFieldOption[];
  feature?: string;
  wirePath?: string;
  wireTransform?: string;
}

export interface LlmRequestSchema extends Record<string, unknown> {
  requestShape: string;
  endpointPath?: string;
  method?: 'GET' | 'POST';
  modelField?: string;
  inputContainer?: string;
  parameterContainer?: string;
  inputMapping?: Record<string, string>;
  fields?: LlmSchemaField[];
  extraBodyFields?: LlmSchemaField[];
}

export interface LlmResponsePollingSchema extends Record<string, unknown> {
  enabled: boolean;
  taskIdPath?: string;
  taskStatusPath?: string;
  queryPathTemplate?: string;
  terminalStatuses?: string[];
}

export interface LlmResponseSchema extends Record<string, unknown> {
  responseShape: string;
  polling?: LlmResponsePollingSchema;
  resultMapping?: Record<string, string>;
  errorMapping?: Record<string, string>;
}

export type LlmDslNodeKind = 'language_model' | 'image_generation';

export interface LlmDslField extends Record<string, unknown> {
  key: string;
  label?: string;
  type: LlmSchemaFieldType;
  required?: boolean;
  description?: string;
}

export interface LlmDslSchema extends Record<string, unknown> {
  nodeKind: LlmDslNodeKind;
  interactionMode?: 'sync' | 'async';
  primaryInput?: string;
  inputs?: LlmDslField[];
  parameters?: LlmDslField[];
  outputs?: LlmDslField[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function safeParseJsonObject<T extends Record<string, unknown>>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isObject(parsed) ? (parsed as T) : null;
  } catch {
    return null;
  }
}

export function splitModelTypes(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
