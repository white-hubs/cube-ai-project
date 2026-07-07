# 下游升级指南：正文气泡真流式 + `message-reset-v1`

> 状态：已在本仓落地（contracts / engine mapper / `@cube-ai/agent-sdk-client-assistant` / mock）。
> 影响面：**所有实时渲染 `message-delta-v1` 的 SSE 消费方**（ghcloud 前端、自建客户端）。
> 适用引擎：tachu rc.14。
> 决策记录：[ADR-0035](../adr/ADR-0035-final-answer-live-streaming-and-message-reset.md)。

## 1. 一句话

最终答案气泡以前是**假流式**（整段在 `done` 才出现）。现在改为**乐观流式 + 事后回溯清空**：正文逐字 live 流出，新增一条 `message-reset-v1` 用来"撤回"非最终答案的片段。**消费方必须处理 `message-reset-v1`，否则会把已被撤回的中间叙述残留在气泡里。**

## 2. 背景：为什么以前是假流式

tachu rc.14 契约下，agent 只要具备工具能力，**所有** assistant 正文（中间叙述、失败恢复草稿、最终答案）都统一经 `tool-loop-delta` 逐块吐出；判别"这一步是不是最终答案"的信号 `tool-loop-step-end.reason` **总在正文流完之后**才到达（见 tachu `packages/core/src/engine/subflows/tool-use.ts` 的 `emitStepEnd` 时序，`reason: "terminal"` 是唯一代表最终答案的取值）。

旧 mapper 因此把 `tool-loop-delta` 只投进 reasoning 思考区，正文气泡等到 `done` 才用 `terminalDraft` 兜底补一段——气泡永远不流式。要让气泡真流式，只能"先乐观发、事后不对再撤回"。这是 tachu 契约决定的，**上游无需改动**（详见分析：判别信号只能事后拿到，模型自己在生成前也不知道要不要调工具）。

## 3. 契约变更

### 3.1 新增事件 `message-reset-v1`

```jsonc
{
  "schema": "message-reset-v1",
  "turnId": "<sfid>",
  "messageId": "<sfid>",
  "reason": "tool-calls-completed" // 透传 tachu step-end 判别值 / mapper 自愈标记 final-reconcile
}
```

语义：**丢弃当前进行中的正文气泡增量**（回到空气泡）。`reason` 仅供观测/调试，消费方不据此分支——**收到即清空**。定义见 `packages/contracts/src/sse/events.ts` `MessageResetEventSchema`，已注册进 `SseEventSchema` 判别 union。

### 3.2 `message-delta-v1` 的行为变化（无 schema 变更）

| | 旧行为 | 新行为 |
| --- | --- | --- |
| 到达时机 | 基本只在 `done` 时一次性/兜底补发 | **turn 进行中逐块 live 到达**（含中间叙述） |
| 内容 | 只含最终答案 | 可能先流出中间叙述/草稿，随后被 `message-reset-v1` 撤回，再流出最终答案 |
| `seqInTurn` | 从 1 起 | 仍单调递增，**跨 reset 不回退**（如叙述 1..3，reset，终答 4..）|

### 3.3 不变量（升级后必须依然成立）

live 流出并经 reset 清洗后的气泡内容，**恒等于** `terminalDraft`（即 `listMessages` 持久化正文）。刷新页面（走 `listMessages`）与不刷新（走 SSE）看到的最终气泡一致；SSE replay 亦成立。

## 4. 消费方必须做的两件事

1. **注册新 schema**：若你自建了 SSE 解析/校验（基于 `SseEventSchema` 判别 union），拉取新版 `@cube-ai/contracts` 即可；未注册的 schema 会被 `safeParse` 静默丢弃（见 `packages/agent/sdk-client/src/session.ts` 的 soft-skip）。
2. **处理 `message-reset-v1`**：收到即把"当前进行中 assistant 消息"的**正文**清空（回到空串），**不要动 reasoning 思考树**（叙述/过程仍留在思考区）。随后的 `message-delta-v1` 会重新逐字流入最终答案。

### 参考实现（本仓已落地）

`@cube-ai/agent-sdk-client-assistant` 的 `AssistantStore`：

```618:623:packages/agent/sdk-client-assistant/src/store.ts
      case "message-reset-v1": {
        // Option B：上游判定刚才乐观流进气泡的那段不是最终答案（叙述 / 失败恢复草稿 /
        // 工具轮），清空进行中的正文气泡；叙述仍保留在 reasoning 思考树。终答随后重新流入。
        this.resetInProgressAssistantContent(sessionId);
        return;
      }
```

`resetInProgressAssistantContent` 只把最后一条 assistant 消息的 `content` 置空，不触碰 `reasoning`。

## 5. 分消费方迁移清单

### A. 用 `@cube-ai/agent-sdk-client-assistant`（推荐路径）
- 升级到含本次改动的版本即可，`AssistantStore` 已内置 reset 消费与 live append。**无需业务改动**。
- Vue 侧 `@cube-ai/agent-sdk-client-vue` 直接投影 store 状态，同样零改动。

### B. ghcloud 前端 / 自建 SSE 客户端
1. 升级 `@cube-ai/contracts`（拿到 `message-reset-v1` union 成员）。
2. 在事件 reducer 里新增 `message-reset-v1` 分支：清空进行中气泡的 `content`，保留 reasoning。
3. 确认 `message-delta-v1` 是"追加"语义且能在 turn 进行中实时渲染（多数已如此）。
4. 自测：多工具轮问题下，气泡应看到"叙述闪现→清空→最终答案逐字"，刷新后气泡只剩最终答案。

### C. mock / 联调
- `@cube-ai/agent-sdk-client-mock` 新增场景 `tool_loop_reset`，完整演示"乐观流→reset→终答"，可用于前端联调回归。

## 6. 部署顺序（重要）

**先客户端、后服务端**（expand-then-migrate）：

- 客户端处理 `message-reset-v1` 是**向后兼容**的——旧服务端不发 reset 时，该分支永不触发，行为与今天一致。
- 一旦服务端（engine mapper）开始 live 流 + 发 reset，**未升级的客户端会把被撤回的中间叙述残留在气泡里**（直到刷新才由 `listMessages` 纠正）。

因此：先把所有渲染 `message-delta-v1` 的客户端升级到能处理 reset，再上线服务端。

## 7. 回滚

服务端行为集中在 `packages/agent/engine/src/bc/session/tachu-sse-mapper.ts`（`tool-loop-delta` 乐观发 / `tool-loop-step-end` 发 reset / `done` 对账）。回滚该文件即恢复"仅 done 兜底"的旧行为；已升级的客户端因 reset 分支不再触发而自动退化为旧表现，无需回滚客户端。`message-reset-v1` schema 可保留（未使用的 union 成员无副作用）。

## 8. 验收

- `bun run typecheck && bun test` 全绿。
- 关键用例：
  - engine：`packages/agent/engine/src/bc/session/tachu-sse-mapper.test.ts` → `describe("… Option B optimistic bubble streaming")`。
  - contracts：`packages/contracts/src/sse/events.test.ts` → `MessageResetEventSchema` + union 路由。
  - SDK：`packages/agent/sdk-client-assistant/src/store.test.ts` → `message-reset-v1 清空进行中气泡` / `不影响 reasoning 思考树`。
