# ADR-0035: 正文气泡真流式 —— 乐观转发 tool-loop-delta + `message-reset-v1` 事后回溯清空（Option B）

- **Status**: Accepted
- **Date**: 2026-07-07
- **Deciders**: 架构组（经 `/grill-with-docs` 逐项收敛 + `/tdd` 落地）
- **Tags**: sse, session, streaming, contracts, frontend-consumption

## Context

tachu rc.14 契约下，只要 agent 具备工具能力，**所有** assistant 正文（中间叙述、失败恢复草稿、最终答案）都统一经 `tool-loop-delta` 逐块吐出。判别"这一块正文是不是最终答案"的信号是 `tool-loop-step-end.reason`（`"terminal"` 是唯一代表最终答案的取值），而它**总在该步正文流完之后**才到达——模型在生成前自己也不知道要不要调工具、要不要终止（见 tachu `packages/core/src/engine/subflows/tool-use.ts` 的 `emitStepEnd` 时序；`tool-loop-step` 不预告工具调用）。

旧 `tachu-sse-mapper` 因此把 `tool-loop-delta` **只**投进 `reasoning.delta`（思考区），正文气泡要等到 `done` 事件才用 `terminalDraft`（净化后的最终答案）兜底补一段 `message-delta-v1`。后果是**正文气泡假流式**：整段答案在整轮结束时一次性出现，首字延迟 = 整轮时长；"流式打字机"效果只存在于思考面板，用户主视线的正文气泡是死的。

产品要求正文气泡本身必须真流式。但 tachu 的信号时序决定了：要在"正文流出的当下"就渲染，就**不可能**同时知道它是不是最终答案。唯一出路是"先乐观发、事后按 `step-end.reason` 判定不对再撤回"。这需要一条契约里原本没有的"撤回"信号。

（本决策由一次 handoff 复盘触发，配套下游升级指南见 `docs/migration/2026-07-07-final-answer-live-streaming-message-reset-v1.md`；扩展 ADR-0022 的 SSE 语义与 ADR-0008 的前端消费 seam。）

## Decision

### 1. 采用 Option B —— 分离模型 + flash-and-clear（乐观流 + 事后清空）

`tachu-sse-mapper` 把 `tool-loop-delta` 变为**双通道**：既发 `reasoning.delta`（思考区留全过程叙述），又**乐观**发 `message-delta-v1`（正文气泡当即逐字流出）。随后：

- `tool-loop-step-end.reason !== "terminal"`（叙述 / 工具轮 / 失败恢复）→ 发 `message-reset-v1` **撤回**刚乐观流进气泡的那段（仅当气泡有内容才发，避免噪音）；被撤回的叙述仍完整保留在 reasoning 思考树。
- `reason === "terminal"` → 不发 reset，气泡内容即最终答案。
- `done` → 用 `terminalDraft` 与当前气泡内容**对账**：一致则不重发；不一致则先 reset 再补发净化正文（自愈兜底）。

### 2. 新增 wire 事件 `message-reset-v1`（contracts）

在 `packages/contracts/src/sse/events.ts` 定义 `MessageResetEventSchema`（`{ schema, turnId, messageId, reason }`）并注册进 `SseEventSchema` 判别 union（未注册的 schema 会被客户端 `safeParse` 静默丢弃）。语义：**收到即清空进行中的正文气泡**（回空串），**不触碰 reasoning**；`reason` 仅供观测，消费方不据此分支。

### 3. 一致性不变量

live 流出并经 reset 清洗后的气泡内容，**恒等于** `terminalDraft`（即 `listMessages` 持久化正文）。刷新（走 `listMessages`）与不刷新（走 SSE）看到的最终气泡一致，SSE replay 亦成立。由 `done` 对账（第 1 条）保证。

### 4. tachu 零改动；部署先客户端后服务端

所需信号（`tool-loop-delta` 内容、`tool-loop-step-end.reason` 判别、`done.output.terminalDraft` 持久化）tachu 均已发出，**上游无需改动**。客户端处理 `message-reset-v1` 向后兼容（旧服务端不发则分支永不触发），故按 expand-then-migrate：先升级所有渲染 `message-delta-v1` 的客户端，再上线服务端 mapper。

## Consequences

- **Positive**：正文气泡真流式，首字延迟从"整轮结束"降到"首个 `tool-loop-delta` 到达"；一致性不变量由 `done` 对账兜底，刷新前后恒等；tachu 零改动；`message-delta-v1` schema 不变（仅到达时机提前，非破坏性）；纯对话/单工具轮（走 `delta` 通道或单个 terminal 步）无 flash。
- **Negative**：**flash-and-clear 视觉抖动**——多工具轮场景用户会看到中间叙述在气泡里闪现后被清空（tachu 不预告工具意图，无法消除，只能前端做过渡缓解）；契约多一个事件、**消费方必须处理 reset**，否则被撤回的叙述会残留在气泡直到刷新；per-turn 的乐观流 + reset 是一条新的分支路径，需额外测试覆盖。
- **Neutral**：reasoning 思考树行为不变（叙述始终全量留档）；`message-reset-v1` 若被回滚可作为未使用 union 成员保留，无副作用。

## Options Considered

- **A（乐观直接转发 + `done` 时整体替换气泡）**：正文乐观流，`done` 时用 `terminalDraft` 整段替换。中间叙述会在气泡里停留**整轮**才被替换，且替换是整段跳变（非流式收敛），体验差。用户明确排除。否。
- **B（分离模型 + flash-and-clear，本决策）**：乐观流 + `message-reset-v1` 撤回非终答片段。真流式且一致性可保，代价是可见的 flash-and-clear。是。
- **C（交错部分模型 / 分段气泡）**：把每段叙述与答案渲染成正文区内的独立"段"，不清空。无 flash，但需前端把消息模型重构为"多段有序片段"，且叙述与最终答案在正文主区混排，违背"正文气泡只沉淀最终答案、过程归思考区"的产品语义。否（产品语义 + 前端改造成本）。

## Open Questions

- flash-and-clear 的视觉抖动是否需要前端加淡出/占位过渡缓解（纯 UI 层，不影响契约）。
- 若 tachu 未来提供"工具调用/终止前预告"信号，可改为"确认非终答才不发"从而消除 flash；届时 `message-reset-v1` 可退化为纯 `done` 对账兜底或整体弃用。
