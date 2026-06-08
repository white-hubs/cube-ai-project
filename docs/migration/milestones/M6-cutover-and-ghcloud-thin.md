# M6 — 整体切换 + ghcloud 薄化 + 数据迁移

> 渐进式披露：先读 [`../README.md`](../README.md) §4。事实地基：[`../inventory/ghcloud.md`](../inventory/ghcloud.md)（§2 ai-server 退役、§8 security→platform-adapter、§9 gRPC、§11 凭据、§12 调用链）、[`../inventory/cube-ai-platform.md`](../inventory/cube-ai-platform.md)（§3 身份换源）、[`../inventory/kb.md`](../inventory/kb.md)（§8/§12-3 数据/孤儿向量）、[`../inventory/flow.md`](../inventory/flow.md)（§7 凭据迁移）。权威：ADR-0009/0010。

**Goal**：把 host 身份权威落到 `platform-adapter-ghcloud`（仅鉴权/租户），完成各域数据迁移，退役 ai-server/ai-application AI 逻辑/gRPC/tenant-project，最终把流量整体切到 ai-center 单 origin，旧系统只留鉴权旁路。

**Architecture**：身份 = host 注入（platform-adapter 实现 contracts 平台身份 port，替换 flow 自带 reader/lookup）；保留 cube2 平台 gRPC client 作源文档桥；凭据收归 llm-core catalog；cube-ai 项目 key 这类远程拆分产物**删除**。

**依赖**：M1–M5。 **被依赖**：无（终态）。

## Entry 准则
- M1–M5 Exit 全绿；新前端单 origin 已能跑通三域（开发态身份）。

## Exit 准则
- platform-adapter 提供 JWT RS256 + tenant validation + session（HTTP+gRPC）身份；ai-center 经它注入身份，三域本体未改。
- 数据迁移脚本可重复执行且通过校验（catalog/flow/kb 数据完整、检索质量回归通过）。
- ai-server 进程、ai-application AI 逻辑、gRPC FlowService、tenant-project 退役；新系统承载全部 AI 流量；回滚预案就绪。

---

## Task M6.T1 — platform-adapter-ghcloud（身份）

> 来源：`inventory/ghcloud.md §8`（ai-server-base/src/security/* 是种子）。

**Files**: Create `platform-adapter-ghcloud/src/{jwt-auth.ts,tenant-validation.ts,session-context.ts,connect-handler-session.ts,readers.ts}`

**Steps**
- [ ] copy ai-server-base security：`createJwtAuthMiddleware`+`jwt-key-loader`+`jwt-crypto`（`verifyJwtRs256`，公钥来自 `jwtKeyUrl`）、`createTenantValidationMiddleware`（header tenant ∈ JWT tenants[]）、`session-context`（ALS）。
- [ ] copy gRPC 路径身份（`buildSessionContextFromConnectHeaders`/`validateConnectInnerInvoke`）。
- [ ] 实现 contracts 平台身份 port + `AccessTokenReader`/`DeveloperApiKeyReader(host PAT)`/`ProjectLookup` 的 host 实现（`createGhcloudAccessTokenReader`/`createHostPatReader`）。

**验收**：platform-adapter typecheck 绿；JWT 校验/租户校验单测绿（用 mock 公钥）。

## Task M6.T2 — 组合根换源（host 身份注入）

> 来源：`inventory/cube-ai-platform.md §3b`（换源不动本体的铁证）、`inventory/flow.md §8`。

**Steps**
- [ ] ai-center 把 `createExecutionAuthMiddleware` 的 `accessTokenReader`/`apiKeyReader` 换成 platform-adapter（host 源）；`projectLookup` 仍用 flow（projects-as-container）。
- [ ] 等价实现 `isSuperAdmin`→`bypassProjectIsolation`/全局视图语义（`inventory/cube-ai-platform.md §9-5`）。
- [ ] **三域本体（agent-engine/flow-core/kb-core）一行不改**——验证它们仍只读 `currentProjectId()` 等。

**验收**：换源后端到端鉴权/租户隔离正确；三域本体无 diff（git 证明）。

## Task M6.T3 — 保留 cube2 平台 client（源文档桥）+ 拆 grpc-gen

> 来源：`inventory/ghcloud.md §6/§9`。

**Steps**
- [ ] 保留 cube2 gRPC client（ouaa/file/dictionary/content）作 platform-adapter 能力：kb 源文档从 cube 平台取（`inventory/ghcloud.md §6`）。
- [ ] 拆 `ai-application-grpc-gen`：AI 自有契约（FlowServiceGrpc）退役；平台 client 契约留 platform-adapter。

**验收**：源文档桥经 platform-adapter 可取文件字节；FlowServiceGrpc 不再被新系统引用。

## Task M6.T4 — 数据迁移：ghcloud catalog → llm-core

> 来源：`inventory/ghcloud.md §4/§14-7`。

**Files**: Create `tools/migration/catalog-migrate.ts`

**Steps**
- [ ] 迁 `ai_system_llm_*`（type/provider/model/match_rule）+ `ai_application_tenant_llm_*`（provider 含 `api_key`/model）→ llm-core catalog 表。
- [ ] 保真 `system_model_id`/`match_rule` 关联与 `request/response/dsl schema_json`。
- [ ] 幂等可重跑；迁移后抽样校验若干租户的 `resolveModelRuntime` 与旧 `/runtime-config` 一致。

**验收**：迁移脚本跑完，抽样租户模型解析结果与旧系统一致。

## Task M6.T5 — 数据迁移：flow 凭据 + LF doc 清洗

> 来源：`inventory/flow.md §7/§14-3`。

**Steps**
- [ ] flow `app_kv` 的 `model_provider:*` → llm-core catalog（或废弃，视 catalog 是否已覆盖；`inventory/flow.md §7a` 实测无服务端耦合，主要是前端预填来源切换）。
- [ ] 清洗历史 flow doc / LF flow doc 中焊死的字面量 `api_key`（`normalizeLoadFromDbInlineLiteralsDeep` 产物）→ 改为 `modelRef`，遗留 key 入 catalog 或软 fallback。

**验收**：抽样 flow 运行时凭据经 catalog 解析；LF doc 不再含明文 key（抽样）。

## Task M6.T6 — 数据迁移：flow/kb 存储 + 修孤儿向量

> 来源：`inventory/kb.md §8/§12-3/§12-5`、`inventory/flow.md §10`。

**Steps**
- [ ] flow MySQL（16 表去 assistant 4 表）迁移；kb MySQL（4 表）按 M3.T8 DDL 建表迁移。
- [ ] Qdrant：**保持 collection 名（`ai_server_documents`）/维度（1024）/point-id（sha256→UUIDv4）/命名向量（dense/sparse）不变**→ 历史向量零重算（`inventory/kb.md §12-5`）。
- [ ] 修 kb reindex 孤儿向量 bug（`indexDocumentChunks` 补 `deleteByDocument`，`inventory/kb.md §12-3`）；或迁移期重建 collection 顺带清理。

**验收**：迁移后检索质量回归（retrieval-evaluation）通过；孤儿向量校验通过。

## Task M6.T7 — 退役旧 AI 链路

> 来源：`inventory/ghcloud.md §2/§3/§5/§9/§11`。

**Steps**
- [ ] 退役 ai-server 进程（宿主→ai-center）；ai-application 的 flow/kb/agent/catalog AI 逻辑（已收编）；gRPC FlowService；`TenantProjectService`（**cube-ai 项目 key `ai_center_api_key` 删除，不迁**，`inventory/ghcloud.md §11-6/§13-3`）。
- [ ] RocketMQ 租户初始化/catalog 同步：决定改平台身份 port 主动拉取 还是保留 MQ adapter（`inventory/ghcloud.md §14-6`）。
- [ ] 确认 ai-agent 表无生产依赖再退（`inventory/ghcloud.md §13-9`）。

**验收**：新系统不依赖任何退役组件；旧仓只剩鉴权旁路（bff-gw 非 AI 流量不动）。

## Task M6.T8 — 整体 cutover + 回滚预案

> 来源：`inventory/ghcloud.md §12`（4 跳→1 跳）。

**Steps**
- [ ] 流量从 `${BASE_API}/aiApplication/...`（多跳）切到 ai-center 单 origin（`/agent /flow /kb /llm`）。
- [ ] 回滚预案：保留旧链路一段时间（feature flag / 网关路由开关），数据迁移用幂等脚本支持回切窗口。
- [ ] 监控：错误率/延迟/检索质量 dashboard。

**验收**：灰度切流稳定；可一键回滚。

## Task M6.T9 — 收尾校验 + entry/exit

**Steps**
- [ ] 端到端冒烟：agent 经 port 调 flow 与 kb；flow 独立 SSE 直达；kb 检索质量回归；llm catalog 管理。
- [ ] 安全复核 backlog（M2.T6 的 sql/shell/http handler）结清。
- [ ] 勾选 `PROGRESS.md` M6 + 整体；写会话日志；标记迁移完成。

---

## 本里程碑风险
- **租户隔离贯穿 HTTP+gRPC**（`inventory/ghcloud.md §13-6`）：换身份源时两条上下文构建都要接 platform port，漏 gRPC 路径会丢租户。
- **两类凭据：一类迁、一类删**（`inventory/ghcloud.md §13-3`）：vendor key→catalog（迁）；cube-ai 项目 key→删除。混淆会把"将死的远程拆分产物"误迁。
- **平台耦合是硬依赖**（`inventory/ghcloud.md §13-7`）：cube-ai 系统配置在 cube2 dictionary、源文档在 cube2 content/file——保留 platform-adapter，别连根拔。
- **历史数据零重算依赖隐式契约**（`inventory/kb.md §12-5`）：collection 名/维度/point-id/命名向量必须字节级不变。
- **明文口令**（`inventory/ghcloud.md §13-10`）：迁移/复制配置勿把 `mysqlPassword` 等明文带入版本库。
- **回滚窗口**：数据迁移须幂等，cutover 须可回切，避免单向不可逆。

## 决策记录
- （T7）RocketMQ 事件：改 port 主动拉取 / 保留 MQ adapter：________
- （T8）cutover 灰度策略与回滚开关：________
