# ADR-0022: SSE per-turn 作用域（replay + live 过滤）与用户主动取消 turn

- Status: Accepted
- Date: 补档（原决策随 Phase-3/P3-06 落地；本文按现状补写，日期不追溯）
- Deciders: agent-engine 团队
- Tags: sse, session, turn

## Context

`GET /sessions/:sessionId/events` 默认是 **session-scope** 的 SSE 流：replay-on-connect 回放整条 session 的事件缓冲，live 阶段 fan-out 该 session 的全部事件。这在多 turn 并发、或客户端只关心"刚发出去的这一轮"时会有两个问题：

1. 重连时 `Last-Event-ID` 回放会把历史 turn 的事件也吐一遍，客户端要自己按 `eventId` 前缀过滤。
2. session 结束的信号只能靠客户端自行推断（"看到这个 turn 的终态事件后自己 unsubscribe"），服务端不会主动收尾，HTTP 请求也就不会以正常 EOF 结束（浏览器 DevTools 里看起来像连接卡住）。

另外，用户主动停止一次运行中的 turn（"停止生成"）需要一个确定性入口：中断 tachu engine 的运行、把 DB 状态落成 `CANCELLED`、并把这件事经 SSE 广播给所有正在看这条流的客户端——这三件事必须原子地由同一个动作触发，不能让客户端自己拼。

多处代码注释引用 `docs/adr/ADR-0022-...md`（`infra/bun-server-ext/sse` 的 `types.ts`/`sse-handler.ts`/`sse-handler.test.ts`，以及 `session.controller.ts` 的 `streamEvents`/`cancelTurn`），该文件在此之前从未真正存在（迁移残留 L5 核查发现）。

## Decision

**D3 — 用户主动取消 turn**：`POST /sessions/:sessionId/turns/:turnId/cancel` 委派 `TurnService.cancelTurn`，一次调用原子完成三件事：`tachu.Engine.cancel(sessionId)`（中断 LLM/tool 运行）→ DB `turns.status = CANCELLED` → 广播 SSE `turn-cancelled-v1`。幂等语义：若 turn 已非 `RUNNING`，service 抛 `RESOURCE_NOT_FOUND_SESSION`，控制器不吞错，由 HTTP 客户端按错误码判断"已停"还是"已完成"；控制器只拦截路径参数的 SFID 形态非法（`INVALID_ARGUMENT_TURN_ID`/`INVALID_ARGUMENT_SESSION_ID`）。

**D5.1.v2 — per-turn SSE 作用域**：`GET /sessions/:sessionId/events` 新增可选查询参数 `?turnId=<19 位 SFID>`：

- **缺省**（不传 `turnId`）→ session-scope，行为不变（v1 兼容）：replay 整条 session 缓冲，live 阶段 fan-out 该 session 全部事件。
- **传 `turnId`** → per-turn scope：
  - replay 阶段：`ReplayBufferStore.since(scope, lastEventId, turnId)` 只返回 `eventId` 以 `${turnId}:` 为前缀的条目（`eventId` 格式恒为 `{turnId}:{seq6}`）。
  - live 阶段：`SessionSseEmitter.subscribe` 的回调里丢弃 `eventId` 前缀不匹配的事件，不 fan-out 给该连接。
  - **主动收尾**：无论 replay 或 live 阶段，一旦观测到该 turn 的终态事件（`turn-completed-v1` / `turn-failed-v1` / `turn-cancelled-v1`）之一，服务端立即 `controller.close()`，让 HTTP 请求以正常 EOF 结束（对偶 SDK 侧 `sdk-mock` 的 close-on-terminal 行为，DevTools 可保留完整 Response）。若 replay 阶段就已经回放到终态事件（客户端重连时 turn 早已结束），直接收尾、不再进入 live 订阅。

`turnId` 路径参数校验：必须是合法 19 位 SFID（`SfidSchema`），否则 `streamEvents` 抛 `INVALID_ARGUMENT_TURN_ID`。

## Consequences

- **Positive**：客户端可选择只订阅自己刚发起的这一轮，避免历史 turn 噪音；per-turn 流有明确的服务端收尾信号，HTTP 语义（EOF）与业务语义（turn 终态）对齐，不再需要客户端猜测何时该断开。
- **Negative**：`since()` 与 live 订阅回调都需要额外的字符串前缀比较，per-turn 与 session-scope 是两套微妙不同的分支（多一条路径需要测试覆盖）。
- **Neutral**：session-scope（缺省）行为完全不变，v1 客户端不受影响；本文是对既有事实的补档（迁移残留清理），不改变任何现有行为。

## Open Questions

- `turnId` 前缀过滤依赖 `eventId` 格式约定（`{turnId}:{seq6}`）而非结构化字段比较，若未来 `eventId` 格式演进需同步检查本决策的过滤逻辑。
