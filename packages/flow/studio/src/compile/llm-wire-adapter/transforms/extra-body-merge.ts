import type { LlmRequestSchema, LlmSchemaField } from "@cube-ai/llm-core";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value);
}

function setPath(target: JsonObject, path: string, value: unknown): void {
  const parts = path
    .split(".")
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return;
  }
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const existing = cursor[part];
    if (!isObject(existing)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as JsonObject;
  }
  cursor[parts.at(-1)!] = value;
}

function readBooleanParameter(parameters: JsonObject, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = parameters[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

const THINKING_FEATURE = "thinking";
const ENABLE_THINKING_KEYS = new Set(["enable_thinking", "enableThinking", "extra_body.enable_thinking", "thinking.type"]);
const ENABLE_THINKING_WIRE_PATHS = new Set(["enable_thinking", "extra_body.enable_thinking", "thinking.type"]);
const KEY_AS_WIRE_PATHS = new Set(["extra_body.enable_thinking", "thinking.type"]);

function normalizeEnableThinkingWirePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "extra_body.enable_thinking") {
    return "enable_thinking";
  }
  if (trimmed === "enableThinking") {
    return "enable_thinking";
  }
  return trimmed;
}

export function resolveEnableThinkingWirePath(field: LlmSchemaField | null | undefined): string {
  const wirePath = typeof field?.wirePath === "string" ? field.wirePath.trim() : "";
  if (wirePath !== "") {
    return normalizeEnableThinkingWirePath(wirePath);
  }
  const key = field?.key.trim() ?? "";
  if (KEY_AS_WIRE_PATHS.has(key)) {
    return normalizeEnableThinkingWirePath(key);
  }
  if (key === "enable_thinking" || key === "enableThinking") {
    return "enable_thinking";
  }
  return "enable_thinking";
}

export function resolveEnableThinkingWireTransform(field: LlmSchemaField | null | undefined): string {
  return typeof field?.wireTransform === "string" ? field.wireTransform.trim() : "";
}

function isThinkingFeature(field: LlmSchemaField): boolean {
  return typeof field.feature === "string" && field.feature.trim() === THINKING_FEATURE;
}

function isEnableThinkingField(field: LlmSchemaField): boolean {
  if (field.type !== "boolean") {
    return false;
  }
  if (isThinkingFeature(field)) {
    return true;
  }
  if (ENABLE_THINKING_KEYS.has(field.key.trim())) {
    return true;
  }
  const wirePath = typeof field.wirePath === "string" ? field.wirePath.trim() : "";
  return wirePath !== "" && ENABLE_THINKING_WIRE_PATHS.has(wirePath);
}

function booleanWireValue(field: LlmSchemaField, value: boolean): unknown {
  if (resolveEnableThinkingWireTransform(field) === "boolean:enabled_disabled") {
    return value ? "enabled" : "disabled";
  }
  return value;
}

export function resolveEnableThinkingField(schema: LlmRequestSchema | null | undefined): LlmSchemaField | null {
  return schema?.extraBodyFields?.find(isEnableThinkingField) ?? null;
}

export function supportsExtraBodyEnableThinking(schema: LlmRequestSchema | null | undefined): boolean {
  return resolveEnableThinkingField(schema) !== null;
}

export function mergeExtraBodyFields(body: JsonObject, parameters: JsonObject, schema: LlmRequestSchema | null | undefined): JsonObject {
  const out: JsonObject = { ...body };
  if (!schema?.extraBodyFields) {
    return out;
  }
  const enableThinking = readBooleanParameter(parameters, ["enableThinking", "enable_thinking"]);
  if (enableThinking === undefined) {
    return out;
  }
  for (const field of schema.extraBodyFields) {
    if (isEnableThinkingField(field)) {
      setPath(out, resolveEnableThinkingWirePath(field), booleanWireValue(field, enableThinking));
    }
  }
  return out;
}
