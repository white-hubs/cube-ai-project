# M4 — flow-core

> 渐进式披露：先读 [`../README.md`](../README.md) §4/§5(G2)/§7(1)。事实地基：[`../inventory/flow.md`](../inventory/flow.md)（全篇）、[`../inventory/cube-ai-platform.md`](../inventory/cube-ai-platform.md)（§3 身份 seam、§4 assistant 残留、§9 god-repo/双 DB）、[`../inventory/ghcloud.md`](../inventory/ghcloud.md)（§5 DSL 对表）。

**Goal**：把 flow 整套 copy 进 `flow-core`（本体），把横切（身份/凭据/api-keys 认证）换源到统一平台层，剔净 assistant 残留，并坐实 engine 的 `FlowInvokerPort`/`FlowCatalogPort` in-repo 适配；flow 保留独立 SSE 直达。

**Architecture**：flow-core 本体只读身份上下文（注入式 seam，换源不动本体）；LLM 调用走 `LlmProviderPort`（节点 key 软 fallback）；projects-as-container 留 flow-core；既被 engine 经 port 编排、又有 `/flow/*` 独立 SSE。

**依赖**：M0、M1（LLM 换源）、M2（engine 接线目标）。 **被依赖**：M5（flow 管理面）、M6（数据迁移 + 身份换 host）。

## Entry 准则
- M2 Exit 全绿；M1 的 `LlmProviderPort` + 软 fallback（M1.T8）可用；G2 的 flow 2.3→目标版适配清单（M0.T3 附录 A）就绪。

## Exit 准则
- flow-core typecheck 绿；离线测试 ≈全绿（SQLite 内嵌 + LF mock）。
- assistant 残留剔净且**不伤 playground 落库**（drain* 改名保留）；flow 自带测试夹住。
- engine `flow-handler`/`flow-list-handler` 经 in-repo `FlowInvokerPort`/`FlowCatalogPort` 通（替 M2.T7 占位）。
- flow `/flow/*` 独立 SSE 直达可用。
- DSL v2 对 ghcloud `cube.lf.*` 语义对表完成（逐项，结论入决策记录）。

---

## Task M4.T1 — copy flow → flow-core

> 来源：`inventory/flow.md §2`。

**Files**: Create `packages/flow-core/src/{engine,langflow,custom-component,flows,components,custom-component-templates,run,webhook,guardrails,observability,mcp,http,contracts,projects,middleware,db,mock}/**`

**Steps**
- [ ] copy flow `src/**`（114 文件）+ 19 个 `*.test.ts`。
- [ ] 包名 `@cube-ai/flow` → `@cube-ai/flow-core`；保留 `./mock` 子导出。
- [ ] 暂不动横切（身份/凭据），先求「整包跑绿」（去风险法第一步）。

**验收**：文件就位；先尝试 `bun test packages/flow-core`（部分会因依赖/框架版本红，T4 后复跑）。

## Task M4.T2 — 携构建产物 + 生成脚本

> 来源：`inventory/flow.md §6/§14-8`（components/schema/golden 测试依赖产物）。

**Files**: Create `packages/flow-core/generated/cube-component-catalog.json`、`data/langflow-api-all.json`（或等价路径）、`scripts/sync-components.ts`

**Steps**
- [ ] copy `cube-component-catalog.json` + Langflow `api-all.json` + `sync-components` 脚本。
- [ ] 配置 `componentCatalogPath`/`langflowApiAllPath` 指向新路径（缺则 components 503）。

**验收**：`component-schema.test.ts`/`lf-code-golden.test.ts` 能读到 fixture 跑绿。

## Task M4.T3 — 剔 assistant 残留（保留 playground 落库）

> 来源：`inventory/flow.md §12`、`inventory/cube-ai-platform.md §4`（god-repo 14 方法 + 4 表）。**高风险：牵一发动多处。**

**Steps**
- [ ] **先用 flow 自带测试建立基线**（T1 跑绿后），再逐处删，每删一处复跑测试。
- [ ] 删：`repository-contracts.ts` 的 ~14 assistant 方法 + 类型；sqlite/mysql/placeholder 对应实现；`sqlite.ts` 4 表 DDL（111/124/143/160）+ 重置/迁移清单引用；`init_mysql.sql` 4 表；`flow-crud.service` 的 `ASSISTANT_VISIBLE_CONFIG_KEYS` 等；flow.module 导出注释；`assistant.mock.ts`；test-helper `assistantHelpDocsPath`。
- [ ] **改名保留（非删除）**：`drainCubeSseAccumulateAssistant`/`onAssistantComplete`（服务 playground 落库本体功能）→ 改名为 `drainCubeSseAccumulatePlaygroundReply` 等。
- [ ] grep `assistant`（忽略 playground 语义）应趋零。

**验收**：flow-core 离线测试绿；playground 落库测试（`playground-sqlite.test.ts`/`flow-crud.service.test.ts`）仍绿（证明没伤本体）。

## Task M4.T4 — 接 bun-server 基线（flow 2.3→目标版）

> 来源：G2（M0.T3 附录 A）。

**Steps**
- [ ] 按附录 A 逐条改 flow-core 的 break 点（装饰器/中间件 `app.use`/DI token/`DatabaseModule.forRootAsync` 形参）。
- [ ] `bun run --filter @cube-ai/flow-core typecheck`。

**验收**：flow-core 在目标 bun-server 版本下编译通过 + 离线测试复跑绿。

## Task M4.T5 — 身份换源（注入式 seam）

> 来源：`inventory/flow.md §8`、`inventory/cube-ai-platform.md §3`（换源不动本体的代码级铁证）。**真正换 host 源在 M6.T2；本里程碑只把 seam 接到组合根、并保证本体只读上下文不变。**

**Steps**
- [ ] 确认 flow-core 本体只经 `currentProjectId()`/`isGlobalAccessEnabled()`/`developerApiAls`/`authenticatedUserAls` 读身份（不持源）。
- [ ] `createFlow*Reader/Lookup` 三工厂保留为 seam；ai-center 组合根此刻仍可注入 flow 自带实现（M6 换 platform-adapter）。
- [ ] `ProjectLookup` 长期留 flow（projects-as-container）。
- [ ] 裁定中间件权威版（server-base vs flow 自带，`inventory/cube-ai-platform.md §9-2`），归 `infra/bun-server-ext` 或 host；逐字比对 skipPrefixes。

**验收**：flow-core 本体无直接持有身份源的代码（grep `verifyAccessToken` 实现只在 seam 工厂）；组合根注入后管理面/执行面路由可用。

## Task M4.T6 — api-keys（认证收 host / grant 留 flow）

> 来源：`inventory/flow.md §9`。

**Steps**
- [ ] 认证（key→principal/租户）：seam（`DeveloperApiKeyReader`）保留，实现在 M6 换 host PAT。
- [ ] **保留 key→flows grant 领域数据**（`flow_id`/`scopes_json`/`allowed_tools_json`）于 flow-core；`lf-sse-stream.ts:applyToolCallPolicy` 的流内拦截逻辑保留。

**验收**：api-keys 的 grant 数据与 tool-call policy 测试绿。

## Task M4.T7 — LLM 换源（cube-linear-engine → LlmProviderPort）

> 来源：`inventory/flow.md §3/§7`、M1.T8 软 fallback。

**Steps**
- [ ] `engine/openai-compat-chat.ts` 的裸 fetch 调用 → 改走 `LlmProviderPort`（经 `modelRef`）。
- [ ] 凭据优先级改为：catalog（modelRef）优先；节点 `config['api_key']` 字面量走 **软 fallback**（M1.T8，记 deprecation）。env `OPENAI_*` 兜底降级为 fallback 之一。
- [ ] graph-translator 把 key 焊进 LF flow doc 的行为（`normalizeLoadFromDbInlineLiteralsDeep`）保留运行、但标注「历史 flow doc 清洗在 M6.T5」。
- [ ] 双后端开关 `EXP_USE_CUBE_FLOW_ENGINE` + 窄回退 `shouldFallbackCubeEngine` 行为保持不变。

**验收**：`flow-execution.service.test.ts`（mock deps + env 切换）绿；cube-linear 路径经 LlmProviderPort（mock）跑通；带/不带节点 key 两路都不报错。

## Task M4.T8 — in-repo FlowInvokerPort/FlowCatalogPort + 独立 SSE

> 来源：`inventory/flow.md §11`、`inventory/agent-engine.md §3.1/§5`、`inventory/ghcloud.md §5`（engine→flow 调用边）。

**Files**: Create `packages/flow-core/src/port/{flow-invoker.port-impl.ts,flow-catalog.port-impl.ts}`

**Steps**
- [ ] 实现 `FlowInvokerPort.invoke(req)`：内部调 flow-core 执行（同步路径返回 `FlowInvokeSyncResponse`；LONG_RUNNING 由 engine 侧 job 语义处理）。
- [ ] 实现 `FlowCatalogPort.list(req)`：返回可调 flow 列表（受 grant 约束）。
- [ ] ai-center 组合根绑这两个 port（替 M2.T7 flow/flowList 占位）。
- [ ] flow `/flow/*` 独立 SSE 直达路由（`run.controller`/playground/webhook）在组合根挂载——与 engine 编排正交（ADR-0004 双消费）。
- [ ] 决策：engine 经 port 编排 flow 时，SSE 是透传还是二次封装（`inventory/flow.md §15-3`）。

**验收**：engine flow-handler 经 in-repo FlowInvokerPort 跑通一条 flow；flow 独立 `/flow/run/:id` SSE 直达跑通。

## Task M4.T9 — 双 DB 路径统一 + model-providers UI 退役（接口层）

> 来源：`inventory/cube-ai-platform.md §5/§9-4`、`inventory/flow.md §7/§10`。

**Steps**
- [ ] 统一 DB 初始化：flow `getSharedRepositories()` 模块级单例 → 改吃组合根 DI 的 `DatabaseService`（避免双连接/双 pool）。确认 MySQL 仓储真伪（`mysql-repositories.ts` vs placeholder，`inventory/flow.md §14-2`）。
- [ ] `settings/model-providers` controller 标记退役（前端切 llm console 在 M5；app_kv 数据迁移在 M6.T5）。本里程碑只断开服务端任何潜在注入（实测无服务端耦合，`inventory/flow.md §7a`），保留只读以兼容过渡。

**验收**：单进程内 flow 只有一条 DB 连接路径；MySQL 仓储覆盖度确认（记入偏差区）。

## Task M4.T10 — DSL v2 语义对表 + 离线测试 + entry/exit

> 来源：`inventory/ghcloud.md §5/§13-1/§14-1`（ai-application 的 cube.lf.* 编译语义）。

**Steps**
- [ ] 逐项对表 flow-core DSL v2 是否覆盖 ghcloud 的：伴侣 LLM 节点注入（smart-router/agent）、agent MCP 节点注入、multimodal-merge、knowledge-retrieval DSL、`enable_thinking` 透传、smart-router routes 补行。差集记入决策记录（缺的需在 flow-core 补，否则功能回退）。
- [ ] 修正 README §7-1 的 ADR 措辞（flow 无对外 MCP server）：回填 ADR-0004/0006。
- [ ] flow-core 全量离线测试绿（graph-translator 2760、dsl-v2 494 等）。
- [ ] 勾选 `PROGRESS.md` M4；写会话日志；指针移 M5。

**验收**：对表表格成文；离线测试绿。

---

## 本里程碑风险
- **god-repo 牵连广**（`inventory/cube-ai-platform.md §9-3`）：T3 必须「先跑绿基线→逐处删→每步复跑」，否则误删伤本体。
- **assistant vs playground 落库**（`inventory/flow.md §12`）：drain* 是本体功能，**改名保留**不可删。
- **凭据三处散落 + LF 焊死**（`inventory/flow.md §14-3`）：节点 key 软 fallback 是接口层；历史 LF flow doc 里焊死的字面量 key 清洗属 M6.T5。
- **DSL v2 双源**（`inventory/ghcloud.md §13-2`）：flow-core 原生 DSL v2 须覆盖 ghcloud 投影语义，否则功能回退——T10 逐项对表是硬门槛。
- **MySQL 仓储真伪**（`inventory/flow.md §14-2`）：若生产走 placeholder，则 playground/auth/api-keys/kv 在 MySQL 下报错——T9 必须确认。
- **observability 仅内存**（`inventory/flow.md §14-7`）：迁移后多副本语义变化，按需在 M5/M6 评估是否升级 OTel。

## 决策记录
- （T5）中间件权威版（server-base / flow / infra-ext）：**server-base `createExecutionAuthMiddleware`**（flow 仅 re-export seam 工厂）；`/health/*` skip 已扩
- （T8）engine 编排 flow 的 SSE 透传 vs 二次封装：**同步 `FlowInvokerPort.invoke` 返回结构化 result**（无 SSE 二次封装；playground/run 仍独立 SSE 直达）
- （T10）DSL v2 对 ghcloud cube.lf.* 的覆盖差集：**无阻塞差集**（graph-translator + dsl-v2 + lf-code-golden 197 项离线测试全绿；历史 LF doc 焊 key 清洗仍属 M6.T5）
