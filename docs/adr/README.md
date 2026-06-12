# 架构决策记录（ADR）索引 —— 统一 AI 中台 (cube-ai-project)

本目录收录 `cube-ai-project`（统一 AI 中台收敛仓）的**架构决策记录**。每篇 ADR 记录一次 load-bearing 决策的 Context / Decision / Consequences，作为本仓的唯一决策权威（ADR-0007）。

> 词汇见 [`../../CONTEXT.md`](../../CONTEXT.md)。
> 本仓为 `cube-agentic-engine` / `cube-ai` / `ghcloud` 三仓 AI 核心能力的收敛落点（ADR-0001）；迁移已完成，未关闭事项见 [`../backlog.md`](../backlog.md)。

## 模板（MADR 精简版）

```markdown
# ADR-NNNN: 标题
- Status / Date / Deciders / Tags
## Context  ## Decision  ## Consequences  ## Options Considered（可选）  ## Open Questions（可选）
```

## 决策索引

| 编号 | 标题 | Status |
|---|---|---|
| ADR-0001 | [新建 cube-ai-project 收敛仓，按中台领域划分，迁移用 copy](./ADR-0001-convergence-repo-and-domain-layout.md) | Accepted |
| ADR-0002 | [领域包边界与依赖方向（contracts 唯一共享内核，port 唯一跨域 seam）](./ADR-0002-package-boundaries-and-dependency-direction.md) | Accepted |
| ADR-0003 | [LLM 一核两面（进程内 Port + OpenAI 兼容网关），凭据与 catalog 权威收束于 llm-core](./ADR-0003-llm-gateway-and-credential-boundary.md) | Accepted |
| ADR-0004 | [Flow 整套收编为 @cube-ai/flow-core（FlowInvokerPort + 独立 SSE 直达），横切收归，双后端内化](./ADR-0004-flow-consolidation-and-deployment-coupling.md) | Accepted |
| ADR-0005 | [kb 收编 @cube-ai/kb-core；向量化下沉 @cube-ai/embedding（capability）；向量存储归 infra/vector-qdrant（不设 VectorStorePort）](./ADR-0005-kb-and-embedding-consolidation.md) | Accepted |
| ADR-0006 | [Tool/MCP 是 engine 编排域，非第四能力包；Handler 为可复制薄适配](./ADR-0006-tool-mcp-engine-owned.md) | Accepted |
| ADR-0007 | [迁移期 @cube-ai/* 权威治理（workspace 内部包、按包单一权威、旧仓冻结）](./ADR-0007-migration-authority-and-package-governance.md) | Done（迁移期） |
| ADR-0008 | [前端消费 seam —— 单一 origin、按领域命名空间路由、按「领域×面」SDK 家族（client/console）](./ADR-0008-frontend-consumption-seam.md) | Accepted |
| ADR-0008 addendum | [Agent 消费面 `/v1/*` canonical；ai-console `/agent` 仅 UI](./ADR-0008-addendum-agent-consumption-face.md) | Accepted |
| ADR-0009 | [运行时拓扑 —— 单进程 AI-center + compose 中间件；ghcloud 退化为薄平台 adapter](./ADR-0009-runtime-topology-and-ghcloud-thin-adapter.md) | Accepted |
| ADR-0010 | [收编路线图 —— 另起并行新系统，copy 实现串联，C1 先行验证 port seam](./ADR-0010-consolidation-roadmap.md) | Done（迁移期） |
| ADR-0011 | [包命名哲学 —— 包边界=seam 非 responsibility，路径派生包名，SDK 按「面」命名](./ADR-0011-package-naming-philosophy.md) | Accepted |
| ADR-0012 | [运行时单一真源（agent-engine）+ 三域平级下游 + host 身份；assistant 弃迁、flow/kb 整套收编](./ADR-0012-runtime-single-source-and-three-domain-topology.md) | Accepted |
| ADR-0012 addendum | [tenant 单一隔离主键；project 概念整体退役](./ADR-0012-addendum-tenant-single-isolation-no-project.md) | Accepted |
| ADR-0013 | [领域关系型持久化统一 MySQL —— 绝对禁止 SQLite](./ADR-0013-unified-mysql-persistence-no-sqlite-runtime.md) | Accepted |
| ADR-0014 | [flow-editor 投影层临时复刻为 `packages/flow/studio`（B→C 北极星）](./ADR-0014-flow-editor-projection-layer-studio.md) | Accepted |
| ADR-0015 | [DI token 保留 `agentic.*` 命名空间](./ADR-0015-di-token-namespace.md) | Accepted |
| ADR-0016 | [agent 管理面（console face）与 descriptor 双层权威 —— 租户 MySQL + 系统文件，前缀 id 命名空间，draft/publish 版本模型](./ADR-0016-agent-console-and-descriptor-dual-authority.md) | Accepted |
| ADR-0017 | [Schema Migration —— 域自持 migrations/ + 独立 history 表 + 共享 infra runner，ai-center 启动时协调](./ADR-0017-schema-migration-per-domain-runner.md) | Accepted |

## 未决问题（贯穿）

- Langflow 何时从「直连 vendor 例外清单」收口（候选：LF `base_url` 指向 LLM 网关）—— ADR-0003 / 0004
- Cube 线性引擎 与 Langflow 的终局归属（自研取代 / LF 长期主引擎 / 双轨）—— ADR-0004
- 是否需要 `ToolInvokerPort` 把工具执行暴露给外部消费者 —— ADR-0006
- 整体切换时新旧系统的有状态数据迁移/双写方案（MySQL / Redis / Qdrant）—— ADR-0010 / ADR-0013（kb MySQL cutover）
- assistant 产品价值是否以 agent-engine preset 重建 —— ADR-0012
