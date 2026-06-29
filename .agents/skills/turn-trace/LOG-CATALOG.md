# Turn Trace — Log Catalog

cube-agentic-engine stdout JSON（pino）。`ns` 常见前缀：`agentic.engine.session.turn`、`agentic.engine.provider.bridge`、`agentic.engine.tools.invoke`、`agentic.engine.adapter.observability`。

## Enable full I/O

```bash
AGENTIC_ENGINE_LOG_LEVEL=debug   # 或 trace
# 等价回退：LOG_LEVEL=debug
```

实现：`packages/agent/engine/src/infra/observability/turn-debug-log.ts`  
单字段上限 50k 字符 → `*Truncated: true`。

字段名 **刻意避开** logger redaction：`promptBody`、`requestBody`、`responseBody`、`argsBody`、`resultBody`、`answerBody`（不用 `*.message.content` / `*.tool.result`）。

---

## Correlation keys

| 字段 | 说明 |
|------|------|
| `turnId` | 本轮主键；多数 LLM / tool 行携带 |
| `traceId` | 常与 turnId 相同（`turn.llm.phase.start` 起） |
| `sessionId` | 会话 |
| `tenant` | 租户 id |

Grep 模板：

```bash
grep '"turnId":"<ID>"' logs | jq -r '[.time,.msg,.phase?,.eventType?] | @tsv'
```

---

## Phase → log messages

### Turn lifecycle (`agentic.engine.session.turn`)

| msg | level | Body fields (debug) |
|-----|-------|---------------------|
| `turn.started` | debug | `promptBody`, `promptCharCount`, `modelCode`, `sessionId`, `turnId` |
| `turn.llm.phase.start` | debug | `promptBody`, `intentRoutingBody`, `traceId`, `resolvedModel`, `routeReason` |
| `turn.llm.phase.completed` | debug | `answerBody`, `engineOutputBody`, `usage`, `engineOutputBody.metadata.toolCalls` |
| `turn.llm.phase.unhandledRejection` | error | `err` |

### LLM bridge (`agentic.engine.provider.bridge`)

| msg | mode | Body fields (debug) |
|-----|------|---------------------|
| `llm.bridge.chat.start` | chat | `requestBody`（messages 含 system/user） |
| `llm.bridge.chat.done` | chat | `responseBody`（content, reasoningContent, usage） |
| `llm.bridge.chatStream.start` | chatStream | `requestBody` |
| `llm.bridge.chatStream.done` | chatStream | `responseBody`（含 toolCalls 累积） |

Intent 用 `chat`；tool loop + final answer 用 `chatStream`。

### Tool invoke (`agentic.engine.tools.invoke`)

| msg | Body fields (debug) |
|-----|---------------------|
| `tool.invoke.start` | `argsBody`, `toolName`, `handlerKind`, `executeRef` |
| `tool.invoke.completed` | `resultBody`, `resultSummary` |

### Observability events (`engine.event.*`, often level 30 info)

| eventType | 用途 |
|-----------|------|
| `phase_enter` / `phase_exit` | 引擎阶段边界（payload 常为空） |
| `llm_call_start` / `llm_call_end` | 阶段内 LLM；final-answer 带 `purpose` |
| `tool_activation` | visibleTools + 策略命中 |
| `skill_activation` | 技能候选 / pin |
| `tool_loop_step_start` / `tool_loop_step_end` | step 序号、selectedTools |
| `tool_call_start` / `tool_call_end` | info 档；**无**完整 I/O，仅 `argumentsPreview` / `outputLength` |

---

## info vs debug（链路还原差距）

| 数据 | info (30) | debug (20) |
|------|-----------|------------|
| 工具参数 | `argumentsPreview` 截断 | `tool.invoke.start.argsBody` 全文 |
| 工具结果 | `outputLength` | `tool.invoke.completed.resultBody` |
| LLM 请求/响应 | 无 | `llm.bridge.*.requestBody/responseBody` |
| 用户 prompt | 仅 char count | `promptBody` |
| 最终答案 | SSE 流 | `answerBody` + `engineOutputBody` |

**结论**：问题定位默认要求 **debug 档** 日志；仅 info 档 → 报告 verdict=`INSUFFICIENT_LOGS`。

---

## Expected turn shape (complex + tool-use)

1. `turn.started`
2. `turn.llm.phase.start`
3. Intent: `llm.bridge.chat.start` → `chat.done`（JSON complexity/intent）
4. `engine.event.progress` decision=`tool-use`
5. `engine.event.tool_activation`
6. Loop: `tool_loop_step_start` → `chatStream.start` → tool calls → `tool.invoke.*` → `tool_loop_step_end`（repeat)
7. Terminal step: `chatStream.done` finishReason=`stop`, no toolCalls
8. `llm_call_start` purpose=`final-answer` → `chatStream` → `llm_call_end`
9. `turn.llm.phase.completed`

Direct-answer（complexity=simple）跳过 5–7，仅 intent 或直接答复路径。

---

## Common anomalies

| 现象 | 日志线索 |
|------|----------|
| 未调工具却答业务数 | 无 `tool.invoke`；intent 可能 simple；或 tool loop 未触发 |
| 工具成功但答案空/幻觉 | 对比 `resultBody` vs `answerBody` |
| 技能未激活 | `skill_activation_strategy_failed`（如 embedding catalog miss） |
| Agent 指令矛盾 | system[0] 含「不接入工具」但 routing=tool-use |
| 中途失败 | `turn.llm.phase.unhandledRejection`；tool `phase=error` |

---

## Code map

| 模块 | 文件 |
|------|------|
| Debug body helpers | `packages/agent/engine/src/infra/observability/turn-debug-log.ts` |
| Turn logs | `packages/agent/engine/src/bc/session/turn.service.ts` |
| LLM bridge logs | `packages/agent/engine/src/adapters/provider/llm-provider-port-bridge.ts` |
| Tool logs | `packages/agent/engine/src/bc/tools/tool.service.ts` |
