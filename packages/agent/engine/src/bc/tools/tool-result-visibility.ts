const BUSINESS_DATA_TOOL_PATTERN = /^mcp\.[^.]+\.ask_business_data$/;

const BLOCKED_KEYS = new Set([
  "_meta",
  "meta",
  "diagnostics",
  "routing_trace",
  "sql",
  "querySql",
  "rawSql",
  "connectionString",
  "arguments",
  "argumentsPreview",
  "toolArgs",
  "raw",
  "rawRows",
  "raw_rows",
  "rawColumns",
  "raw_columns",
  "traceId",
  "nodeId",
  "session_id",
  "round_num",
  "tenant",
  "tenant_id",
  "deleted",
  "apiKey",
  "api_key",
  "authorization",
  "token",
  "password",
  "secret",
  "stack",
]);

const BLOCKED_KEY_SUFFIXES = ["_id", "_code"];

const SENSITIVE_TEXT_PATTERNS = [
  /mcp:\/\//i,
  /\bmcp\.biz-ontology\.query_database\b/i,
  /\bquery_database\s*\(/i,
  /```sql[\s\S]*?```/i,
  /\bselect\b[\s\S]{0,400}\bfrom\b/i,
  /\b(insert|update|delete|drop|alter|create|truncate)\b/i,
  /\b[A-Za-z0-9]+_(id|code)\b/i,
  /\b(api[_-]?key|authorization|bearer|token|password|secret)\b/i,
  /\b(UPSTREAM_[A-Z_]+|Traceback|stack)\b/,
];

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (isPlainRecord(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isBlockedKey(key: string): boolean {
  if (BLOCKED_KEYS.has(key)) return true;
  return BLOCKED_KEY_SUFFIXES.some((suffix) => key.endsWith(suffix));
}

function sanitizeString(value: string): string {
  return SENSITIVE_TEXT_PATTERNS.some((pattern) => pattern.test(value)) ? "[redacted]" : value;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!isPlainRecord(value)) return undefined;

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (isBlockedKey(key)) continue;
    const sanitized = sanitizeValue(nested);
    if (sanitized !== undefined) out[key] = sanitized;
  }
  return out;
}

function structuredContentOf(output: unknown): unknown {
  const record = parseJsonRecord(output);
  if (!record) return output;
  if (record.structuredContent !== undefined) return record.structuredContent;
  return record;
}

function safeConfirmationToken(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const token = value.trim();
  if (!token || token.length > maxLength || sanitizeString(token) !== token) return undefined;
  return token;
}

/** Preserve only server-owned clarification capabilities; ordinary raw IDs stay blocked. */
function restoreBusinessClarificationTokens(source: unknown, projected: unknown): unknown {
  if (!isPlainRecord(source) || !isPlainRecord(projected)) return projected;
  const rawClarification = isPlainRecord(source.clarification) ? source.clarification : null;
  const safeClarification = isPlainRecord(projected.clarification) ? projected.clarification : null;
  if (!rawClarification || !safeClarification || source.status !== "needs_clarification") return projected;

  const questionId = safeConfirmationToken(rawClarification.question_id, 200);
  const slot = safeConfirmationToken(rawClarification.slot, 80);
  const rawOptions = Array.isArray(rawClarification.options) ? rawClarification.options.slice(0, 12) : [];
  const safeOptions = Array.isArray(safeClarification.options) ? safeClarification.options : [];
  const options = safeOptions.map((safeOption, index) => {
    if (!isPlainRecord(safeOption)) return safeOption;
    const rawOption = isPlainRecord(rawOptions[index]) ? rawOptions[index] : null;
    const optionId = rawOption ? safeConfirmationToken(rawOption.option_id ?? rawOption.id ?? rawOption.value, 200) : undefined;
    return { ...safeOption, ...(optionId ? { option_id: optionId } : {}) };
  });
  return {
    ...projected,
    clarification: {
      ...safeClarification,
      options,
      ...(questionId ? { question_id: questionId } : {}),
      ...(slot ? { slot } : {}),
    },
  };
}

export function isBusinessDataTool(toolName: string): boolean {
  return BUSINESS_DATA_TOOL_PATTERN.test(toolName);
}

export function projectToolResultForModel(toolName: string, output: unknown): unknown {
  const source = isBusinessDataTool(toolName) ? structuredContentOf(output) : output;
  const projected = sanitizeValue(source);
  return isBusinessDataTool(toolName) ? restoreBusinessClarificationTokens(source, projected) : projected;
}
