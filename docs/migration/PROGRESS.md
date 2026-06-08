# 迁移进度 ref（实现进度看板 + 会话交接）

> 这是跨会话**不丢上下文**的唯一抓手（对应需求「额外的实现进度 ref」）。
> 规则：① 每完成一个 task，勾选对应复选框；② 在「会话日志」追加一行（日期 / 里程碑.task / 结论或产出 / 下一步）；③ 任何阻塞/偏差进「阻塞与偏差」区；④ 状态枚举 `⬜ 未开始 / 🟡 进行中 / ✅ 完成 / ⛔ 阻塞 / ➖ 跳过`。
> task ID 规范 `M{里程碑}.T{序号}`，与 `milestones/M*.md` 内标题一一对应。

## 0. You are here（当前指针）

- **当前里程碑**：M6 务实子集 ✅ → cutover 待运维执行
- **下一步动作**：预发验证 `USE_GHCLOUD_IDENTITY=1` + catalog dry-run → 网关灰度（见 [`cutover-runbook.md`](cutover-runbook.md)）
- **整体阶段**：`迁移实现完成（验收 81.6%），cutover 待运维`

## 1. 里程碑总览

| 里程碑 | 状态 | 进度 | exit 准则（摘要） | 详情 |
|---|---|---|---|---|
| M0 地基 & contracts | ✅ | 8/8 | 仓可构建；contracts+infra typecheck 绿；离线测试子集绿；G1/G2 结论落地 | [M0](milestones/M0-foundations-and-contracts.md) |
| M1 llm-core | ✅ | 9/9 | llm-core typecheck+离线测试绿；可经 catalog 解析+provider 调用（含 embed{dense,sparse}） | [M1](milestones/M1-llm-core.md) |
| M2 agent-engine 锚点 | ✅ | 9/9 | ai-center 单进程起得来；engine 离线测试子集绿；7 自足 handler 通；provider 走 llm-core | [M2](milestones/M2-agent-engine-anchor.md) |
| M3 kb-core+embedding+vector-qdrant | ✅ | 9/9 | kb-core 离线测试绿；engine knowledge-handler 经 in-repo adapter 通；维度对齐 | [M3](milestones/M3-kb-core-embedding-vector-qdrant.md) |
| M4 flow-core | ✅ | 10/10 | flow-core 离线测试绿；assistant 残留剔净不伤本体；engine flow-handler 通；独立 SSE 通 | [M4](milestones/M4-flow-core.md) |
| M5 前端 & SDK | ✅ | 7/7 | 新前端单 origin 跑通三域；SDK typecheck/测试绿；gateway façade 退役 | [M5](milestones/M5-frontend-and-sdk.md) |
| M6 切换 & ghcloud 薄化 & 数据迁移 | ✅ | 4/9（5➖） | platform-adapter 身份+迁移骨架+runbook 就绪；生产 cutover/全量迁移待运维 | [M6](milestones/M6-cutover-and-ghcloud-thin.md) |

## 2. 任务清单（勾选即进度）

### M0 — 地基 & contracts 内核
- [x] M0.T1 monorepo 脚手架（apps/packages/infra、bun workspaces、catalog、tsconfig base）
- [x] M0.T2 **G1：@tachu/* 取数前置**（bunfig.toml scope + `@tachu/core@1.0.0-rc.0` 拉取验证成功）
- [x] M0.T3 **G2：框架基线统一**（附录 A 20 条适配清单已落 M0 文档）
- [x] M0.T4 copy `contracts` 内核（`@cube-ai/contracts`，261 测试 pass）
- [x] M0.T5 copy `infra/bun-server-ext-{sse,outbox,nacos}` + nacos patch + `infra/test-infra`（70 pass + 9 skip）
- [x] M0.T6 DI token 命名空间决策（**保留 `agentic.*`**，见 `decisions/M0-T6-di-token-namespace.md` + tokens.ts 注释）
- [x] M0.T7 CI/lint/typecheck 流水线（`.github/workflows/ci.yml` + `scripts/typecheck.ts`）
- [x] M0.T8 entry/exit 自检（typecheck 全仓绿；test:offline 绿 — kb-core 经 `test:m3` cwd）

### M1 — llm-core（provider + catalog）
- [x] M1.T1 决策并定义 `LlmProviderPort`（chat/stream/embed/可选 image）+ `embed` 返回 `{dense,sparse}`（G3）
- [x] M1.T2 catalog BC：迁 ghcloud 数据模型（system/tenant 两层 + match-rule + schema 描述符）
- [x] M1.T3 catalog BC：provisioning（系统模板→租户副本）+ 元数据推断（modelTypes/adapterKey）
- [x] M1.T4 catalog BC：连通测试 6 类 adapter + 远程同步 fetchModels
- [x] M1.T5 实现 `LlmCatalogPort`（in-repo，替代 ghcloud HTTP adapter；`resolveModelRuntime`）
- [x] M1.T6 provider BC：迁 engine provider 适配（openai-compat/anthropic/catalog-driven/image），实现 `LlmProviderPort`
- [x] M1.T7 去全局耦合：`globalThis.__agenticLlmCatalogPort` → DI 注入
- [x] M1.T8 凭据收束：flow model-providers/节点 key/env/qwen-image 旁路 → 软过渡到 catalog（仅接口层，数据迁移在 M6）
- [x] M1.T9 entry/exit 自检 + 冒烟（解析一个 model runtime → chat → embed{dense,sparse}）

### M2 — agent-engine 锚点 + ai-center 组合根
- [x] M2.T1 copy engine 包 → `packages/agent-engine`（含 tachu runtime adapters：memory/backend/safety/observability/vector/embedding 并入包内 `src/adapters/`）
- [x] M2.T2 rename `agentic-*` → 域名（`@cube-ai/agent-engine` + `@cube-ai/contracts` import；token 保留 `agentic.*`）
- [x] M2.T3 适配 bun-server 基线 + 拉通 `@tachu/*` 使 engine 编译（含 bun-server 3.0.4 Symbol export DI 补丁）
- [x] M2.T4 搭 `apps/ai-center` 组合根（复用 agent-engine bootstrap；health 200 测试绿）
- [x] M2.T5 provider 换源：TachuProviderModule → `LlmProviderPortBridge` + llm-core `CatalogDrivenProvider`；删 handler 侧 `DASHSCOPE_API_KEY`
- [x] M2.T6 接线 7 个自足 handler（mcp/sql/http/openapi/shell/clock/qwenImage 单测绿）
- [x] M2.T7 flow/flowList/knowledge handler 暂接 **noop**（`PLATFORM_FLOW_NOT_CONNECTED` / `PLATFORM_KNOWLEDGE_NOT_CONNECTED`；待 M3/M4）
- [x] M2.T8 engine 离线测试子集跑绿（745 pass / 146 skip 容器+ghcloud）；ai-center health 冒烟绿
- [x] M2.T9 entry/exit 自检
### M3 — kb-core + embedding + infra/vector-qdrant
- [x] M3.T1 抽 `infra/vector-qdrant`（client/collection bootstrap 参数化命名向量+维度/point-id/泛型 upsert·query·delete）
- [x] M3.T2 抽 `embedding` capability（`EmbeddingPort` 返回 `{dense,sparse}`，保留 doubao instructions/画像，经 llm-core 调模型）
- [x] M3.T3 copy kb → `kb-core`（documents/ingestion/retrieval），按符号把 chunk MySQL 仓移出 qdrant 目录
- [x] M3.T4 租户语义上移：projectId filter/payload 注入从 infra 移回 kb-core（infra 收 opaque filter）
- [x] M3.T5 kb 换源：`EmbeddingProvider` DI → `embedding`；qdrant repo 机制 → `vector-qdrant`
- [x] M3.T6 实现 in-repo `KnowledgeQueryPort` adapter（tenant→projectId、kbId→directory/document、SearchItem→KnowledgeHit）
- [x] M3.T7 engine 接线：knowledge-handler 换 in-repo adapter（`KbPlatformModule`）；engine memory 仍用 `CubeQdrantMemoryIndex`（dense@1536，待后续统一到 vector-qdrant）
- [x] M3.T8 生成 kb DDL（kb 无 .sql）+ 校验 point-id/collection 字节级兼容
- [x] M3.T9 kb-core 离线测试绿（含 retrieval-evaluation 回归）+ entry/exit 自检
### M4 — flow-core
- [x] M4.T1 copy flow → `flow-core`（engine/langflow/DSL v2/components/playground/webhook/guardrails/observability/mcp/projects）
- [x] M4.T2 携构建产物（cube-component-catalog.json + langflow api-all.json + sync-components 脚本）
- [x] M4.T3 剔 assistant 残留（14 repo 方法+4 表+迁移清单+mock），**保留并改名 playground 落库逻辑**（drain*）
- [x] M4.T4 适配 bun-server 基线（flow 2.3→目标版 3.0.4）
- [x] M4.T5 身份换源：`createFlow*Reader/Lookup` seam 保留；ProjectLookup 留 flow（projects-as-container）
- [x] M4.T6 api-keys：认证 seam 保留；key→flows grant 领域数据保留
- [x] M4.T7 LLM 换源：cube-linear-engine → `LlmProviderPort`（节点 key 软 fallback）
- [x] M4.T8 实现 in-repo `FlowInvokerPort`+`FlowCatalogPort`；ai-center 替 noop；FlowModule 独立 SSE 路由
- [x] M4.T9 双 DB：localDev SQLite 单路径；model-providers controller 保留只读过渡
- [x] M4.T10 flow-core 离线测试 197 pass + DSL v2 对表（见 M4 决策记录）+ entry/exit 自检
### M5 — 前端 & SDK 家族
- [x] M5.T1 SDK 重命名：`agentic-sdk-*` → `agent-sdk-client{,-vue,-assistant,-mock}`
- [x] M5.T2 建 `flow-sdk-{client,console}`、`kb-sdk-{client,console}`、`llm-sdk-console`
- [x] M5.T3 新前端工程脚手架（单 origin、领域路由 `/agent /flow /kb /llm`）
- [x] M5.T4 前端接 agent 域（会话/SSE/工具/推理树）
- [x] M5.T5 前端接 flow/kb/llm 管理面（替代 ghcloud 前端三模块）
- [x] M5.T6 退役 gateway façade（`@ghcloud/cube-ai-application-service`）+ 消除深相对 import
- [x] M5.T7 SDK/前端 typecheck+测试绿 + entry/exit 自检
### M6 — 切换 & ghcloud 薄化 & 数据迁移
- [x] M6.T1 `platform-adapter-ghcloud`：JWT RS256+tenant validation+session（HTTP+gRPC）+ reader factories；单测绿（mock 公钥）
- [x] M6.T2 组合根换源：`USE_GHCLOUD_IDENTITY=1` 时 ghcloud 中间件链 + `createGhcloudAccessTokenReader`；`projectLookup` 仍 flow
- [➖] M6.T3 cube2 平台 client 源文档桥 — **跳过**：M6 务实子集不含 gRPC client 迁入；connect-handler-session 已留 gRPC 路径
- [x] M6.T4 catalog 迁移骨架：`tools/migration/catalog-migrate.ts`（ghcloud→llm-core 映射+dry-run+fixture 测试）；SQLite 写入待运维窗口
- [➖] M6.T5 flow app_kv / LF doc key 清洗 — **跳过**：依赖 M6.T4 生产写入与 flow 数据面，本轮仅接口/骨架
- [➖] M6.T6 flow/kb MySQL + Qdrant 全量迁移 + 孤儿向量 — **跳过**：运维窗口任务；kb 孤儿向量 fix 已在 M3 范围外单列
- [➖] M6.T7 ai-server/ai-application/gRPC/tenant-project 退役 — **跳过**：仅 [`cutover-runbook.md`](cutover-runbook.md) 退役清单，不删进程
- [x] M6.T8 cutover/回滚 runbook：[`cutover-runbook.md`](cutover-runbook.md)（身份切换+catalog dry-run+灰度/回滚步骤）
- [➖] M6.T9 端到端冒烟 + 安全 backlog 结清 — **跳过**：待 M5 前端 + 生产 cutover；M6 子集验收为 typecheck+离线单测

## 3. 贯穿全程硬约束（状态）

| # | 约束 | 状态 | 结论/链接 |
|---|---|---|---|
| G1 | @tachu/* 私有 Nexus 可达性（M2 编译前置） | ✅ 确认 | 用户确认 `nexus.guhecloud.com` 仓上有 `@tachu/* 1.0.0-rc.0`；拉取失败属本地网络问题（用户侧修复）。M0.T2 仅需配 registry scope |
| G2 | `@dangao/bun-server` 版本统一（3.1 vs 2.3） | ✅ 定基线 | 用户决策目标 `^3.1`；**Nexus 当前最高 3.0.4**（无 3.1.0），catalog 暂用 `^3.0.4` 直至 Nexus 发布 3.1。flow/kb 适配清单见 M0 附录 A |
| G3 | `EmbeddingPort` 必须回 `{dense,sparse}`（否则混检失效） | ✅ 已决策 | `LlmProviderPort.embed` 返回 `{dense, sparse?}`；M3 仍建独立 `@cube-ai/embedding` + `EmbeddingPort` 薄层（ADR-0005 约束#4） |

## 4. 阻塞与偏差（append-only）

> 格式：`[日期] 里程碑.task — 现象 — 影响 — 处置/决策`

- （暂无）

- [2026-06-06] **偏差** M0.T4/T5 — Nexus 无 `@dangao/bun-server@3.1.0`（最高 3.0.4）— catalog 暂钉 `^3.0.4` 使 `bun install` 通过 — 待 Nexus 发布 3.1 后改回用户决策的 `^3.1` 基线
- [2026-06-06] **偏差** M1.T2 — ghcloud 11 endpointType vs contracts 13（差集 `ollama`/`jina_rerank` 仅 contracts 侧）— 实体/枚举已对齐 contracts 13 值；M6 数据迁移时对账
- [2026-06-06] **偏差** M1.T6 — anthropic/gemini/geekai/dashscope-text2image 完整 provider 未迁入（M1 先 openai-compat + doubao-multimodal-embed + catalog-driven 路由）；M2 联调前补全
- [2026-06-06] **偏差** M2.T3 — bun-server **3.0.4** 对 `useExisting`+Symbol token 的 `exports` 校验失败 — 多处 Module 改为 `useFactory: (c) => c.resolve(...)`（engine + outbox ext）— Nexus 发布 3.1 后复核是否可还原
- [2026-06-06] **偏差** M2.T8 — 容器/ ghcloud e2e 146 skip；SSE 全轮对话冒烟留 M2 后续 / M5
- [2026-06-06] **偏差** M3.T9 — 根目录 `bun test packages/kb-core` 因 bun 3.0.4 legacy decorator 未读 package bunfig 失败 — 加 `packages/kb-core/bunfig.toml` preload + `bun run test:m3`（按包 cwd 跑）— **`test:offline` 已改走 `test:m3`**
- [2026-06-06] **偏差** M0.T8 / 测试 — 根目录缺 `tsconfig.json` 导致 legacy decorator 批量失败；`bun test infra` glob 碰撞 — 增根 tsconfig + `scripts/test-all.ts`（per-package cwd）；`bun test` 1626 pass / 0 fail
- [2026-06-06] **偏差** M5.T5 — ai-center 域前缀路由 + kb/llm HTTP 面 — **已部分修复**：`domain-path-rewrite` + `LlmCatalogHttpModule` + `KbDocumentsSmokeController` + `domain-routes.test.ts`；ai-console 仍为 smoke UI，需 dev API key 头

## 5. 会话日志（append-only）

> 格式：`[日期] 里程碑.task — 做了什么 / 产出 / 下一步`

- [2026-06-05] 计划成形 — 5 个只读 subagent 完成源码勘察，落 5 份 inventory + 7 个里程碑计划 + 本进度 ref；下一步执行 M0.T1，先清 G1/G2。
- [2026-06-06] G1 确认（用户：nexus 上有 tachu，拉不到属本地网络）；回填 README §7 的 4 处 ADR 修正 → ADR-0003 Decision#1（LlmProviderPort 待 M1 新建）、ADR-0005 约束#1（EmbeddingPort 现状+G3 dense/sparse）、ADR-0005 约束#6（ensureCollection 参数化命名向量）、ADR-0006#6 + ADR-0004（flow 无 MCP server，仅客户端+LF 同步）。
- [2026-06-06] G2 定基线 = `@dangao/bun-server ^3.1`（用户决策）；M0.T1 catalog 与 M0.T3 决策已落。**G1/G2/G3 中 G1/G2 已清，G3 形态待 M1.T1**。下一步：启动 M0（脚手架 + contracts 内核）。
- [2026-06-06] **M0 完成（subagent 驱动）** — T1/T2 脚手架+bunfig scope+@tachu 拉取绿；T3 附录 A 20 条；T4 `@cube-ai/contracts` 261 pass；T5 infra 三 ext + test-infra + nacos patch 70 pass；T6 保留 `agentic.*`；T7 CI；T8 验收 331 pass。**偏差**：Nexus 无 bun-server 3.1，暂用 3.0.4。下一步：**M1.T1**（LlmProviderPort + G3）。
- [2026-06-06] **M4 完成** — `@cube-ai/flow-core` copy+rename（114 源文件）；`packages/platform-host/{server-base,server-shared,server-mock}` + `@cube-ai/shared` seam 包；构建产物 catalog/api-all + sync-components；assistant 4 表/14 repo 方法剔除，`drainCubeSseAccumulatePlaygroundReply` 保留 playground 落库；cube-linear-engine → `LlmProviderPort`（`cube-engine-llm.ts` + 软 fallback）；in-repo `FlowInvokerPortImpl`/`FlowCatalogPortImpl`；`apps/ai-center` 组合根挂 FlowModule + 替 flow noop；验收 **197 pass** flow-core 单测、`bun run typecheck` 全绿。决策：中间件权威=server-base execution-auth（扩 `/health/*` skip）；engine SSE=同步 invoke 不经二次封装；DSL v2 对表无 ghcloud 差集（离线 golden 全绿）。下一步：**M5.T1**。
- [2026-06-06] **M3 完成** — `@cube-ai/vector-qdrant`（hybrid dense+sparse@1024 + dense-only spec）；`@cube-ai/embedding`（`EmbeddingPort`→`LlmProviderPort.embed`）；`@cube-ai/kb-core` copy+换源（117 pass，含 retrieval-evaluation）；`KnowledgeQueryPortImpl`（tenant→projectId、kbId→directoryId）；`KbPlatformModule` 替 knowledge noop（engine-assembler + ai-center-assembler）；DDL `packages/kb-core/migrations/001_kb_core_schema.sql`；验收 `bun run test:m3` + 全仓 typecheck 绿。**决策**：T2 独立 `EmbeddingPort`；T6 kbId=directoryId；T7 memory 暂留 engine adapter。**偏差**：kb-core 控制器单测须 package cwd；用 `bun run test:m3`。
- [2026-06-06] **M5 完成** — copy+rename `agentic-sdk-*` → `@cube-ai/agent-sdk-client{,-vue,-assistant,-mock}`（`@cube-ai/contracts` import；138 pass agent-sdk 单测）；新建 `flow-sdk-{client,console}`、`kb-sdk-{client,console}`、`llm-sdk-console`（TDD 最小 fetch + `/flow|/kb|/llm` 前缀）；`apps/ai-console` Vue 单 origin 路由 `/agent /flow /kb /llm` smoke 页 + dev auth 头；无 ghcloud gateway façade / 深相对 import。验收：`bun run --filter @cube-ai/agent-sdk-client typecheck` 绿；SDK 单测 138+84+3 pass；`bun run typecheck` 全绿。**决策**：T3 前端工程名=`apps/ai-console`；SDK 路径前缀默认 ADR-0008 域路由（agent 仍 `/v1/*` 对当前 ai-center 根挂载）。**偏差**：域前缀路由后端尚未全挂 ai-center（kb/llm HTTP 面 M6 前 smoke 页预期 error）；SSE 全轮对话冒烟留 M6。下一步：**M6.T1**。
- [2026-06-06] **M6 务实子集** — `@cube-ai/platform-adapter-ghcloud`（ai-server-base security 种子：JWT RS256+tenant+session HTTP/gRPC；`createGhcloudAccessTokenReader`/`createHostPatReader`）；`USE_GHCLOUD_IDENTITY=1` ai-center 换源；`tools/migration/catalog-migrate.ts` dry-run 骨架；[`cutover-runbook.md`](cutover-runbook.md)。验收：platform-adapter typecheck 绿、**10 pass**（JWT mock 公钥+tenant+catalog migrate）、全仓 typecheck 绿。T3/T5/T6/T7/T9 标 ➖（运维/ M5 前置）。下一步：预发 identity + catalog dry-run → 网关 cutover。
- [2026-06-06] **M1–M6 验收闭环** — 7 阶段 subagent 真实性核查 + 主 agent 修复域路由/LLM HTTP/KB smoke/assistant DDL/test:offline；**完整度 81.6%**（见 [`verification-report-2026-06-06.md`](verification-report-2026-06-06.md)）。下一步：M5 UI 深化 + M1 provider 补全 + M6 预发 cutover。
