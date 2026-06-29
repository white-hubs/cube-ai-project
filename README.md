# Cube AI Platform（统一 AI 中台）

单进程统一 AI 中台，对外提供 **agent · LLM · flow · kb · embedding · tool/MCP** 等 AI 基础能力。组合根为 `apps/ai-center`，单 origin 领域路由（`/v1/*` `/flow/*` `/kb/*` `/llm/*`）。

## 快速开始

```bash
bun install
bun run build        # SDK dist + ai-sdk-playground 浏览器包
bun run typecheck    # 全 workspace 类型检查
bun test             # 离线全量测试（约 10s）
```

启动 ai-center（需外部或 compose 提供 MySQL / Redis / Qdrant）：

```bash
bun run dev:up:deps                  # compose 起依赖栈
cd apps/ai-center && bun run dev
```

本地依赖栈详情见 [deploy/docker-compose/README.md](./deploy/docker-compose/README.md)。

## 仓库布局

```
apps/ai-center          # ★ 单进程组合根（DI 装配全部能力包）
apps/ai-sdk-playground  # 内部 SDK 验证沙箱（bun run dev:playground）
packages/contracts      # 唯一共享内核（port + wire schema，零依赖）
packages/agent          # engine（运行时）+ sdk-client 家族
packages/llm            # llm-core（provider + catalog 凭据权威）+ sdk-console
packages/flow           # flow-core + studio（编辑器投影层）+ sdk
packages/kb             # kb-core（ingestion/retrieval）+ sdk
packages/embedding      # 向量化 capability
packages/platform-adapters/ghcloud   # 平台租户身份适配
infra/                  # bun-server-ext{sse,outbox,nacos} · vector-qdrant · test-infra
descriptors/            # 声明式资产：agents · tools · skills · rules
deploy/docker-compose/  # 本地 MySQL / Redis / Qdrant
```

依赖铁律：跨领域耦合只允许 contracts port；详见[布局与依赖图](./docs/architecture/repo-layout-and-dependencies.md)。

## 文档导航

| 想了解                      | 看                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| AI 开发入口（渐进式披露）   | [AGENTS.md](./AGENTS.md)                                                                                 |
| 领域术语                    | [CONTEXT.md](./CONTEXT.md)                                                                               |
| 架构决策（ADR-0001 … 0015） | [docs/adr/](./docs/adr/README.md)                                                                        |
| 目录布局与包依赖图          | [docs/architecture/repo-layout-and-dependencies.md](./docs/architecture/repo-layout-and-dependencies.md) |
| 生产切换 runbook            | [docs/operations/cutover-runbook.md](./docs/operations/cutover-runbook.md)                               |
| 未关闭事项                  | [docs/backlog.md](./docs/backlog.md)                                                                     |

## 测试

```bash
bun test                      # 离线全量（单元 + env 门控自动 skip 的集成）
bun run test:integration      # testcontainers：MySQL/Redis/Qdrant 单链路
bun run test:containers       # testcontainers 全量矩阵
```

## 工程约定

- 外部依赖版本统一在根 `package.json` 的 `catalog` / `catalogs`，子包用 `"pkg": "catalog:"` 引用。
- 领域持久化统一 MySQL，禁止 SQLite（ADR-0013）。
- 租户隔离唯一主键 `tenant_id`，无 project 维度（ADR-0012 addendum）。
- SDK 发布：`bun run publish:sdk`（Nexus npm-hosted，详见 `scripts/publish.sh`）。
