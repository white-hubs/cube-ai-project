import type { NormalizedRunBody } from "../contracts/cube-run";

/** 单条输入的最大字符数（超出时截断并附加省略提示）。0 表示不限制。运行时读取以支持测试覆盖。 */
function getMaxInputChars(): number {
  return parseInt(process.env["CUBE_GUARDRAIL_MAX_INPUT_CHARS"] ?? "0", 10) || 0;
}

/** 正则黑名单：来自环境变量 CUBE_GUARDRAIL_BLOCKLIST（分号分隔的正则字符串）。 */
let blocklistPatterns: RegExp[] | null = null;

function getBlocklistPatterns(): RegExp[] {
  if (blocklistPatterns) {
    return blocklistPatterns;
  }
  const raw = process.env["CUBE_GUARDRAIL_BLOCKLIST"]?.trim() ?? "";
  if (!raw) {
    blocklistPatterns = [];
    return blocklistPatterns;
  }
  blocklistPatterns = raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => {
      try {
        return [new RegExp(s, "iu")];
      } catch {
        return [];
      }
    });
  return blocklistPatterns;
}

/**
 * 对输入文本应用 Guardrails：
 * 1. 正则黑名单：命中时抛出 403 错误对象（由调用方决定如何传递给用户）。
 * 2. 长度截断：超过限制时截断，追加省略提示。
 */
export function applyInputGuardrails(text: string, _body: NormalizedRunBody): string {
  if (!text) {
    return text;
  }

  const patterns = getBlocklistPatterns();
  for (const pat of patterns) {
    if (pat.test(text)) {
      const err = Object.assign(new Error("Input blocked by content policy"), {
        code: "GUARDRAIL_BLOCKLIST",
        statusCode: 403,
      });
      throw err;
    }
  }

  const maxChars = getMaxInputChars();
  if (maxChars > 0 && text.length > maxChars) {
    return `${text.slice(0, maxChars)}…[truncated]`;
  }

  return text;
}

/** 将 max_iterations 等传入运行时 metadata（LF 侧未必消费，供观测与后续引擎使用）。 */
export function runtimeMetadataForUpstream(body: NormalizedRunBody): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    max_iterations: body.runtime_config.max_iterations,
    timeout_ms: body.runtime_config.timeout_ms,
  };
  if (body.metadata) {
    meta["client_metadata"] = body.metadata;
  }
  if (body.user_context?.trace_id) {
    meta["trace_id"] = body.user_context.trace_id;
  }
  return meta;
}

/** 重置内部黑名单缓存（用于测试中修改环境变量后刷新）。 */
export function resetGuardrailCache(): void {
  blocklistPatterns = null;
}
