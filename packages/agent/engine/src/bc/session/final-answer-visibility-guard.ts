import type { EngineOutput } from "@tachu/core";

const SAFE_BLOCKED_ANSWER =
  "业务问数结果已返回，但最终回答包含不应展示的内部查询细节。系统已阻止直接展示，请重新提问或联系管理员查看受控诊断信息。";

const FINAL_ANSWER_FORBIDDEN_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: "sql_fenced_block", pattern: /```sql[\s\S]*?```/i },
  { code: "mcp_uri", pattern: /mcp:\/\//i },
  { code: "legacy_biz_ontology_tool", pattern: /\bmcp\.biz-ontology\.query_database\b|\bquery_database\s*\(/i },
  { code: "sql_select", pattern: /\bselect\b[\s\S]{0,500}\bfrom\b/i },
  { code: "sql_mutation", pattern: /\b(insert|update|delete|drop|alter|create|truncate)\b/i },
  { code: "tool_args_json", pattern: /"(sql|connection|purpose|session_id|round_num|arguments)"\s*:/i },
  { code: "raw_context_field", pattern: /\b(tenant_id|tenant|deleted|traceId|nodeId)\b\s*[:=]/i },
  { code: "provider_internal_error", pattern: /\b(UPSTREAM_[A-Z_]+|Traceback|Api key|Bearer|token|stack)\b/i },
];

function engineOutputText(output: EngineOutput): string {
  const raw = output.content;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item && typeof (item as { text?: unknown }).text === "string") {
          return (item as { text: string }).text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (raw && typeof raw === "object" && "text" in raw && typeof (raw as { text?: unknown }).text === "string") {
    return (raw as { text: string }).text;
  }
  return "";
}

function replaceEngineOutputText(output: EngineOutput, text: string): EngineOutput {
  return {
    ...output,
    content: text,
  };
}

export interface FinalAnswerGuardResult {
  output: EngineOutput;
  blocked: boolean;
  reasons: string[];
}

export function detectFinalAnswerVisibilityViolations(text: string): string[] {
  return FINAL_ANSWER_FORBIDDEN_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ code }) => code);
}

export function guardFinalAnswerEngineOutput(output: EngineOutput, options: { sensitiveToolUsed: boolean }): FinalAnswerGuardResult {
  if (!options.sensitiveToolUsed) return { output, blocked: false, reasons: [] };
  const reasons = detectFinalAnswerVisibilityViolations(engineOutputText(output));
  if (reasons.length === 0) return { output, blocked: false, reasons: [] };
  return {
    output: replaceEngineOutputText(output, SAFE_BLOCKED_ANSWER),
    blocked: true,
    reasons,
  };
}

export const __finalAnswerVisibilityGuardForTest = {
  SAFE_BLOCKED_ANSWER,
  engineOutputText,
};
