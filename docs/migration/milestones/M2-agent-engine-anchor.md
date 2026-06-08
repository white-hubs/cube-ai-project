# M2 — agent-engine 锚点 + ai-center 组合根

> 渐进式披露：先读 [`../README.md`](../README.md) §4/§5(G1,G2)。事实地基：[`../inventory/agent-engine.md`](../inventory/agent-engine.md)（§4 engine 结构、§5 handlers、§8 重命名、§11 暗坑）、[`../inventory/cube-ai-platform.md`](../inventory/cube-ai-platform.md)（§2 组合根装配范式）。

**Goal**：把**最成熟、port 就位**的 engine 包整体 copy 进 `packages/agent-engine`，并立起单进程组合根 `apps/ai-center`，使运行时先跑起来，作为后续 kb/flow 能力插入的锚点。provider 换源到 M1 的 llm-core；flow/kb 相关 handler 先占位。

**Architecture**：`agent-engine` = `@tachu/core` 的 host（session/turn/tool/mcp/jobs/outbox 等 BC + tachu runtime adapters）；`apps/ai-center` 按 ADR-0018 固定顺序装配 contracts→infra→llm-core(provider)→agent-engine→(占位 flow/kb)。

**依赖**：M0（contracts/infra/G1/G2）、M1（provider）。 **被依赖**：M3/M4（handler 换 in-repo）、M5（前端接 agent）、M6（cutover）。

## Entry 准则
- M0/M1 Exit 全绿；**G1（@tachu 可达）必须已通过**，否则本里程碑无法编译。

## Exit 准则
- `apps/ai-center` 单进程能启动（`bun run dev`）并响应 health。
- agent-engine 离线测试子集 `bun test` 绿（contracts 已在 M0，engine 各 BC 单测此处绿）。
- 7 个自足 handler（mcp/sql/http/openapi/shell/clock/qwenImage）可用；llm-handler 经 llm-core 通；一轮 SSE 对话冒烟通过。
- flow/flowList/knowledge handler 以 noop 或 ghcloud 适配占位、不报错。

---

## Task M2.T1 — copy engine 包 → packages/agent-engine

> 来源：`inventory/agent-engine.md §2/§4/§6`。注意：随 engine 一起带的 tachu runtime adapters（memory/backend/safety/observability）属 engine 内置。

**Files**
- Create: `packages/agent-engine/`（从 `cube-agentic-engine/packages/engine/` copy src + test）
- Create: `packages/agent-engine/src/adapters/*`（从 `agentic-adapters` 中**只取** memory/backend/safety/observability/vector + embedding 运行时；provider/image **不取**——归 M1 llm-core）

**Steps**
- [ ] copy engine `src/**`（bc/ infra/ assembler/ bootstrap.ts main.ts）+ co-located 单测。
- [ ] 从 `agentic-adapters` 拆取 engine 内置部分（memory/backend/safety/observability + tachu vector/embedding 运行时）放入 agent-engine（或保留独立 `packages/agent-adapters`——记录决策，默认并入 agent-engine 以减包数）。
- [ ] vector 适配先保留 engine 自带的 tachu `QdrantVectorIndexAdapter`；M3 再决定是否改走 `infra/vector-qdrant`。

**验收**：文件就位；暂不要求编译（依赖未接，T3 处理）。

## Task M2.T2 — rename agentic-* → 域名

> 来源：`inventory/agent-engine.md §8`。

**Steps**
- [ ] 包名 `@cube-ai/agent-engine` → `@cube-ai/agent-engine`；内部 import 从 `@cube-ai/agentic-contracts` → `@cube-ai/contracts`。
- [ ] DI token：按 M0.T6 决策（默认保留 `agentic.*` 字符串，仅改包名/导入路径）。
- [ ] engine 对 `@cube-ai/platform-adapters-ghcloud` 的硬依赖：token 改从 `@cube-ai/contracts` 直引（`inventory/agent-engine.md §11.7`）；ghcloud 适配在 T7 作为占位之一可选保留。

**验收**：全仓无 `@cube-ai/agentic-contracts`/`@cube-ai/agent-engine` 残留引用（grep=0）。

## Task M2.T3 — 接 bun-server 基线 + 拉通 @tachu，使 engine 编译

> 来源：G1/G2（M0.T2/T3）。

**Steps**
- [ ] 按 M0.T3 基线，agent-engine 用目标 `@dangao/bun-server` 版本（engine 本就 ^3.1，若基线=3.1 则无需改）。
- [ ] 按 M0.T2 方案安装 `@tachu/{core,extensions,host-defaults}@1.0.0-rc.0`（registry 或 vendoring）。
- [ ] 携带 nacos 补丁（M0.T5 已配）。
- [ ] `bun run --filter @cube-ai/agent-engine typecheck`。

**验收**：agent-engine **编译通过**（这是 G1/G2 的真正验收点）。

## Task M2.T4 — 搭 apps/ai-center 组合根

> 来源：`inventory/agent-engine.md §4.3`（EngineAssembler 固定顺序 + bootstrap 中间件链 + main 的 worker/relay 开关）；`inventory/cube-ai-platform.md §2`（cube-ai 组合根范式）。

**Files**: Create `apps/ai-center/src/{main.ts,bootstrap.ts,assembler.ts,app.module.ts}`

**Steps**
- [ ] 移植 `EngineAssembler.assemble()` 的固定注册顺序：Foundations(Sfid/TenantGuard/Errors)→Nacos/Secrets→Mysql→Observability→SseExt→Lifecycle→OutboxExt→Audit→Platform→6×Tachu adapter→(M1 provider 取代 TachuProvider)→(占位 Flow/Knowledge/LlmCatalog)→7×BC→Idempotency/RateLimit。
- [ ] 移植 bootstrap 中间件链：`traceId→versionNegotiation→http-metrics→oauth2-introspection→idempotency→tenant-context→rateLimit→errorResponse`（身份此处用 engine 自带 mock/oauth2，M6 换 host）。
- [ ] 移植 main.ts：OTel 最先 import；env 开关 BullMQ workers / memory-projection relay / outbox relay。
- [ ] LlmCatalogPort 绑定改为 DI（用 M1 的 in-repo impl 或先 ghcloud 占位）。

**验收**：`bun run dev` 起进程；`GET /health` 200。

## Task M2.T5 — provider 换源到 llm-core

> 来源：`inventory/agent-engine.md §7/§11.3/§11.6`。

**Steps**
- [ ] engine `TachuProviderModule` 的 provider 来源换成 M1 的 `LlmProviderPort`（经 catalog-driven），去掉 `globalThis` 与模块级 env 常量（配合 M1.T7）。
- [ ] 删 `qwen-image-handler` 的 `DASHSCOPE_API_KEY` env 旁路，改走 M1.T8 的统一 `modelRef` 入口（软 fallback）。
- [ ] llm-handler/vector-handler/memory-handler 的 embedding 走 llm-core `embed`（dense 路径即可，sparse 在 M3 kb 用）。

**验收**：llm-handler 经 llm-core 完成一次（mock vendor）调用；engine 无 vendor key 旁路（grep `DASHSCOPE_API_KEY` 在 handler=0）。

## Task M2.T6 — 接线 7 个自足 handler

> 来源：`inventory/agent-engine.md §5`（这 7 个 M2 即可接线）。

**Steps**
- [ ] 验证 mcp/sql/http/openapi/shell/clock/qwenImage handler 在新组合根可注册、可调。
- [ ] sql/shell/http/openapi 的安全面（白名单/黑名单/SSRF/脱敏）随之入账——记入「安全复核 backlog」（`inventory/agent-engine.md §11.12`），M6 前由 host/authz 复核。

**验收**：对每个 handler 跑一条最小调用（clock 最简，sql 用本地库，mcp 用 mock server）；engine handler 单测绿。

## Task M2.T7 — flow/flowList/knowledge handler 占位

> 来源：`inventory/agent-engine.md §5`（这 3 个需 M3/M4 能力）。

**Steps**
- [ ] 给 `FlowInvokerPort`/`FlowCatalogPort`/`KnowledgeQueryPort` 绑 **noop 实现**（返回明确「未接入」错误码）或**临时 ghcloud HTTP 适配**（若 README G 决定过渡期可用）。默认 noop，避免引回 ghcloud 依赖。
- [ ] 在 `PROGRESS.md` 标注这 3 个 handler 待 M3（knowledge）/M4（flow）换 in-repo。

**验收**：组合根装配不因这 3 个 port 缺实现而崩；调用它们返回可识别的「未接入」错误。

## Task M2.T8 — 离线测试 + SSE/turn 冒烟

> 来源：`inventory/agent-engine.md §9`（离线子集）。

**Steps**
- [ ] 跑 engine co-located 单测（turn/session/tool/mcp-bridge/handlers/tachu/authz/auth…）离线子集绿。
- [ ] 冒烟：起 ai-center → 建 session → 发一轮消息 → 经 llm-core(mock) 产 SSE → 收到 turn.completed。
- [ ] 容器测试（mysql/redis/qdrant）按 G1/CI 决定是否在此跑。

**验收**：离线单测绿；SSE 冒烟通过。

## Task M2.T9 — entry/exit 自检

**Steps**
- [ ] Exit 准则逐条核对。
- [ ] 勾选 `PROGRESS.md` M2；写会话日志；指针移 M3。

---

## 本里程碑风险
- **@tachu 编译前置（G1）**：T3 不过则全停——这是 M2 的命门。
- **engine→ghcloud 包硬依赖**（`inventory/agent-engine.md §11.7`）：T2 必须把 token 引用切到 contracts，避免把 ghcloud 适配连根带进运行时。
- **组合根装配顺序敏感**（ADR-0018）：Idempotency/RateLimit 依赖 Session 的 Redis client，必须最后注册；OTel 必须 main 最先 import。顺序错会运行期崩。
- **多副本暗坑**（`inventory/agent-engine.md §11.14`）：qwen-image 落盘需粘滞/单实例；relay 靠 Redis 选主。单进程开发期无碍，部署期注意。
- **安全面随 copy 入账**：sql/shell handler 能力强，纳入安全复核 backlog（M6 前处理）。

## 决策记录
- （T1）engine 内置 adapters 是否独立成 `packages/agent-adapters`：________
- （T7）flow/kb handler 占位策略（noop / ghcloud 过渡）：________
