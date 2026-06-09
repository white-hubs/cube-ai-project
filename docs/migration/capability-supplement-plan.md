# 能力补充清单（终稿）— 新系统 vs 原系统对齐

> 经 `/grill-with-docs` 与用户逐项裁决（2026-06-09）。标尺：**真实租户生产切换可用**；ADR 已判退役者不做；其余分「上线阻断 / 可后补 / 不做」。
> 对比源：`ghcloud/ai-server`+`ai-application`、`cube-agentic-engine`、`cube-ai/server/{flow,kb}`；前端 `ai-application/app` 仅辅助参考（本项目不含前端 UI）。
> 关联决策：[ADR-0012 addendum](../adr/ADR-0012-addendum-tenant-single-isolation-no-project.md)、`CONTEXT.md`（租户隔离主键 / 能力包无自有鉴权）。

## 0. 裁决要点（grill 结论）

| # | 议题 | 裁决 |
|---|---|---|
| Q1 | 对齐标尺 | C：生产切换可用 + 显式登记不做/后补 |
| Q2 | 多租户 | 上线阻断必补 |
| Q2' | project | **整体退役**，tenant 为单一隔离主键，`project_id→tenant_id` 改名 |
| Q3 | 运行时 provider | 搬原仓实现过的：anthropic + dashscope-text2image + geekai-image；gemini 原生 / jina_rerank 运行时不在范围 |
| Q4 | flow 鉴权 | flow 无自有鉴权概念，`auth`/`api-keys`/`allowed_tools` 整套弃 |
| Q5 | cube2 桥 | content/KB 源文档桥**必补**；dictionary/ouaa-tenant 弃；file 保留现状 |
| Q6 | 前端 | 不做 UI；旧 app 改指向新后端经 SDK 消费；SDK 覆盖面需对齐 |
| Q7 | RocketMQ | 两 runner 全弃（tenant-init 为 project 驱动；catalog-sync 被 lazy provisioning 覆盖） |
| Q8/Q9 | 数据迁移 | fresh-start，历史数据（含 catalog）**全不迁** |

## 1. ✅ 上线阻断必补

### 1.1 多租户身份落地
- tenant = 唯一隔离主键；`platform-adapter-ghcloud` = 唯一鉴权权威。
- `USE_GHCLOUD_IDENTITY` 转默认（Mock 仅 dev）。
- 删 `projects` 表 / CRUD / `ProjectsService` / `projectLookup` / `project-lookup-cache`；租户合法性走 JWT `tenants[]`。
- `tenantToProjectId(_tenant)→'default'`（`flow-platform-ports.ts`）删除，host 直接以 tenant 注入隔离上下文。
- `project_id`→`tenant_id` 全量改名（flow/kb 本体 + Qdrant payload 键 + `currentProjectId()`→`currentTenantId()`）。

### 1.2 剔除 flow 自有鉴权
- 删 flow `auth`（OAuth2/users）、`api-keys`（PAT 签发）、`allowed_tools` 工具白名单、`settings/model-providers`。
- 编程式访问走 host PAT/JWT；`webhook` + HMAC 作 flow 功能保留。
- agent 工具授权由 engine `bc/authz` 兜底（不受影响）。

### 1.3 LLM 运行时 provider 补全
- 迁入 `llm-core`：`anthropic-provider`、`dashscope-text2image-provider`、`geekai-nano-banana-image-provider`（原 `cube-agentic-engine` 实现过）。
- 修 `catalog-driven-provider.ts` 路由：`dashscope_text2image` 不再错路由到 openai-compat、`geekai` 不再抛 `not yet supported`。
- 文生图凭据经 catalog 解析（`qwen-image-handler` 已 catalog 解析，env 仅 dev fallback，属已登记例外）。

### 1.4 KB 平台源文档桥
- 补 cube2 `content/KnowledgeBaseService` gRPC client（置于 `platform-adapter-ghcloud`，复用现有 cube2 file client 模式）。
- kb 摄入侧消费：从 cube 平台知识库取源文档 → kb 摄入流水线。

### 1.5 权威系统级 catalog seed
- 提供权威系统级 catalog seed（provider types / providers / models / match-rules）替代 dev 占位种子。
- 使 fresh-start 租户首访 lazy provisioning 能复制出真实模型模板（vendor key 仍由各租户自录）。

## 2. ❌ 明确不做 / 退役

| 项 | 出处 | 理由 |
|---|---|---|
| cube-ai **project** 概念（表/CRUD/远程建 key）、`TenantProjectService` | cube-ai/ghcloud | 进程合并后无独立 project，tenant 即隔离主键 |
| flow `auth`/`users`/`oauth`/`api-keys 签发`/`allowed_tools`/`model-providers` | cube-ai 外壳 | 非 flow 本体概念；鉴权权威唯一在 host |
| **RocketMQ** `tenant-init` + `catalog-sync` runner | ghcloud | tenant-init 为 project 驱动；catalog-sync 被 llm-core lazy provisioning 覆盖、非外部同步 |
| `gemini` 原生 provider、`jina_rerank` 运行时 provider | — | 原仓未实现 / 运行时无消费者（kb 用规则 rerank）；catalog 注册+连通测试保留 |
| cube2 `dictionary` / `ouaa-tenant` gRPC | ghcloud | 配置内化无远程 cube-ai；租户来自 JWT |
| **前端 UI**（`ai-console` 作交付） | — | 本项目不含前端；旧 `ai-application/app` 改指向新后端 |
| engine memory 统一 `vector-qdrant` | — | ADR-0005 本不要求；memory(dense@1536) 与 kb(hybrid@1024) 维度/用途不同 |
| **历史数据迁移**（flow/kb/向量/catalog） | — | fresh-start，历史数据不管；`catalog-migrate` 降级为可选 dry-run |

## 3. 🕒 可后补 + 触发条件

| 项 | 触发条件 |
|---|---|
| SDK 覆盖面对齐旧 app 消费需求 | 旧 `ai-application/app` 重新接线时发现缺操作 |
| cube2 `file_ref` gRPC | provider icon 引用确需 file_ref 时 |

## 4. 📄 文档动作（已/待）

- [x] `CONTEXT.md`：新增「租户隔离主键 (tenant)」「能力包无自有鉴权」；移除 host 权威条里的 `currentProjectId()` 表述。
- [x] [ADR-0012 addendum](../adr/ADR-0012-addendum-tenant-single-isolation-no-project.md)：project 退役 / tenant 单一隔离 / 能力包无鉴权 / fresh-start。
- [ ] `PROGRESS.md`「遗留 TODO」区按本清单刷新（多租户=必补、vector 统一=不做、project 退役新增）。
