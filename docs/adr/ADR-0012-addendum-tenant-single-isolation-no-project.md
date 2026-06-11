# ADR-0012 Addendum: project 概念整体退役 — tenant 为单一隔离主键、能力包无自有鉴权

- **Status**: Accepted
- **Date**: 2026-06-09
- **Parent**: [ADR-0012 — 运行时单一真源 + 三域平级下游 + host 身份权威](./ADR-0012-runtime-single-source-and-three-domain-topology.md)
- **Deciders**: 架构组（经 `/grill-with-docs` 收敛；project 去留由用户裁决）
- **Tags**: identity, tenant, project, migration-scope, flow, kb, auth

## Context

ADR-0012 在 project 维度上保留了 cube-ai 的玩法：D3 写「**projects-as-container 留 flow**」「flow 只留 key→flows 的 grant」「换源**不动本体**（本体只读 `currentProjectId()`）」。其前提是「合并后仍存在独立于 tenant 的 cube-ai project 层」。

合并落地阶段重新裁决时，这一前提被否定：**cube-ai、ai-server、agentic-engine 合并为单进程后，不再存在 cube-ai 独立的 `project` 概念**。project 原是「服务分离时代」的产物——

- ghcloud 侧 `ai_application_tenant_project` + `ai_center_api_key`（远程 cube-ai 项目 key，ADR-0012/runbook 已判删除）；
- flow 侧 `projects` 容器表 + 自助建 project/key 流程 + `TenantProjectService.initTenantProject`（RocketMQ `tenant-init` 触发）。

二者都是为「跨进程把租户投影成一个远程 project」而生。进程合并后该投影消失，**唯一需要的隔离语义就是 tenant**（来自鉴权中心 JWT，经 `platform-adapter-ghcloud` 解析）。

同时厘清：flow 现存的 `auth`（OAuth2 用户登录）、`api-keys`（PAT 签发/校验）、`allowed_tools` 工具白名单，**均为 cube-ai server 外壳概念，非 flow 本体概念**；flow 调 Langflow 用的 key 是 Langflow 的鉴权（外部依赖，见直连 vendor 例外清单）。agent 运行时调工具的授权/consent 是 agent-engine 自带 `bc/authz`，与 flow `allowed_tools` 是两套。

## Decision

### D1 — project 概念整体退役，tenant 为单一隔离主键

- 系统**唯一隔离主键 = tenant**；删除 cube-ai project 概念的全部载体：
  - flow `projects` 表 / CRUD / `ProjectsService` / `projectLookup` 机制 / `project-lookup-cache`；
  - `TenantProjectService` / `TenantProjectSyncService` / `tenant-init` RocketMQ runner；
  - ghcloud `ai_center_api_key`（早已判删）。
- flow/kb 本体物理列 `project_id` **全量改名 `tenant_id`**（含 Qdrant payload 键、`server-shared` 读符号 `currentProjectId()`→`currentTenantId()`、access-scope）。
- 租户合法性由 JWT `tenants[]`（`platform-adapter-ghcloud` 的 tenant-validation 中间件）校验，不再经 `projectLookup.hasProject`。
- `tenantToProjectId(_tenant)→'default'` 占位映射删除；host 直接以 tenant 注入隔离上下文。

### D2 — 覆盖 ADR-0012 D3 的 project 相关条款

本 addendum **有意覆盖** ADR-0012 D3 中三条：

1. 「projects-as-container 留 flow」→ **作废**：projects 整体退役。
2. 「flow 只留 key→flows 的 grant」→ **作废**：flow 无自有鉴权（见 D3）。
3. 「换源不动本体」→ **在 project 维度作废**：`project_id→tenant_id` 改名是对本体的有意改动（其余非身份维度仍遵循「不动本体」）。

ADR-0012 D1（运行时单一真源、assistant 不迁）、D2（身份权威在 host、三域平级）保持不变；本 addendum 只收紧 project 维度。

### D3 — 能力包无自有鉴权

- `flow-core` / `kb-core` **不承载任何自己的鉴权概念**，只管核心功能。
- flow 的 `auth`（OAuth2/users）、`api-keys`（PAT 签发）、`allowed_tools` **整套弃**（皆 cube-ai 外壳概念）。
- 编程式访问（含 webhook 之外的直达）由 host PAT/JWT 鉴权；`webhook` + HMAC 验签作 flow 功能保留。
- agent 经 engine 调工具的授权由 agent-engine `bc/authz`（consent/grant）兜底，不受影响。

### D4 — fresh-start，不迁历史数据

- 切换采用 **fresh-start**：不迁移任何历史 flow / kb / 向量 / **catalog** 数据；`project_id→tenant_id` 仅体现在新建 schema，无存量数据迁移。
- `catalog-migrate` 工具降级为可选 dry-run 对账，不在上线路径。
- 因 catalog 亦 fresh-start，需提供**权威系统级 catalog seed**（provider types / providers / models / match-rules）替代 dev 占位种子，使租户首访 lazy provisioning 能复制出真实模型模板（vendor key 仍由各租户自录）。

## Consequences

- **Positive**：隔离语义单一（tenant 贯穿三域），无 project 中间层；删除 RocketMQ 依赖与 `TenantProjectService`；flow/kb 鉴权零自持、权威唯一在 host；fresh-start 免去存量迁移复杂度与风险。
- **Negative**：`project_id→tenant_id` 改名触及 flow/kb 本体与 Qdrant payload 契约（违反原「不动本体」，但一次性）；失去「一个租户下多 project 分组」与「对 flow 直达的 per-key 工具白名单」两项 cube-ai 能力；切换后各租户需重新录入 vendor key（catalog fresh-start）。
- **Neutral**：lazy provisioning 取代 eager MQ 触发，租户 catalog 改首访时备好；historical 数据留旧系统，按 ADR-0010「回退=继续用老系统」。

## Options Considered

- **S1 tenant≡project 别名**（保留 `project_id` 物理列、host 注入 `projectId=String(tenant)`，不动本体）：最低 churn，但保留了已被否定的 project 概念躯壳。否。
- **S3 保留 project**（一个 tenant 下多 project + host 侧 tenant→project 目录）：维持分离时代玩法，与「合并后无独立 project」冲突。否。
- **S2 整体删 + 改名**（本 addendum）：tenant 单一隔离、概念最干净，代价是一次性改本体。是。

## References

- [ADR-0012](./ADR-0012-runtime-single-source-and-three-domain-topology.md) — 父决策
- [ADR-0003](./ADR-0003-llm-gateway-and-credential-boundary.md) — 凭据边界（vendor key 归 catalog）
- [ADR-0010](./ADR-0010-consolidation-roadmap.md) — 收编路线图（fresh-start 切换、回退=用老系统）
- `CONTEXT.md` — 词条「租户隔离主键 (tenant)」「能力包无自有鉴权」
- 能力补充清单 `docs/migration/capability-supplement-plan.md`（已随迁移收尾移除，git 历史可溯）
