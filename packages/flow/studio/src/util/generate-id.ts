import { SnowflakeUtil } from "@cube-ai/ai-center/platform/server-base";

/**
 * 生成十进制雪花 ID 字符串（与 BIGINT 主键 `string` 对齐）。
 *
 * 复刻自原仓库 `ai-application/src/util/generate-id.ts`，换源到本仓库统一的
 * `@cube-ai/ai-center/platform/server-base` `SnowflakeUtil`（与 flow-core 同源），避免重复实现。
 */
export function generateNumericId(): string {
  return SnowflakeUtil.nextId();
}
