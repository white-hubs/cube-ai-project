import type {
  ResourceDemandContext,
  ResourceDemandRouter,
  ResourceDemandSelector,
} from '@tachu/core';

/**
 * Host 注入的 token 级 Resource Demand 路由（ADR-0026 / 下游 ADR-0025 amendment §6.5）。
 *
 * 当前为**保守全保真**实现：恒返回 `{ mode: 'all' }`，与未注入 router 行为完全一致，
 * 零行为变更。本函数是 §6.5「LLM 决定 token 级需求」的唯一落点——后续可在此读取
 * `ctx.candidateTools[].consumes` 与 `ctx.supportedKinds`、或意图/路由 LLM 的结构化输出，
 * 收紧到 `{ mode: 'select', kinds/keys, required }` 或 `{ mode: 'none' }`。
 *
 * 约束（ADR-0026）：
 * - 任何 `< all` 的裁剪必须由 host 在此显式 opt-in；默认全保真是安全网。
 * - 若返回 `select`，必须结合 `ctx.supportedKinds`，避免选中模型不支持的 kind。
 * - `consumes` 仅作输入参考，描述「工具执行需要什么」，不等于「推理 LLM 选该工具时需看到什么」。
 */
export function createResourceDemandRouter(): ResourceDemandRouter {
  return (_ctx: ResourceDemandContext): ResourceDemandSelector => {
    return { mode: 'all' };
  };
}
