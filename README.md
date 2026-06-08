# Cube AI Platform（统一 AI 中台）

单一收敛仓，对外提供 LLM · flow · kb · embedding · tool/MCP 等 AI 基础能力。组合根为单进程 `apps/ai-center`。

## 文档

- [CONTEXT.md](./CONTEXT.md) — 领域术语表
- [docs/adr/](./docs/adr/) — 架构决策（ADR-0001 … ADR-0012）
- [docs/architecture/repo-layout-and-dependencies.md](./docs/architecture/repo-layout-and-dependencies.md) — v6 目录与依赖图
- [docs/migration/ADR-VERIFICATION.md](./docs/migration/ADR-VERIFICATION.md) — ADR 验收跟踪板

## 本地开发

```bash
bun install
bun run build        # SDK dist + ai-console 浏览器包
bun run typecheck
bun run test
```

外部依赖版本统一在根 `package.json` 的 `catalog` / `catalogs`（workspace 子包用 `"pkg": "catalog:"` 引用）。

启动 ai-center（需外部或 compose 提供 MySQL / Redis / Qdrant）：

```bash
cd apps/ai-center && bun run dev
```

本地依赖栈见 [deploy/docker-compose/README.md](./deploy/docker-compose/README.md)。

## 仓库布局（v6 摘要）

```
apps/ai-center          # 单进程组合根
packages/{agent,llm,flow,kb,embedding,contracts,platform-adapters}
infra/{bun-server-ext,vector-qdrant,test-infra}
descriptors/            # agents · tools · skills · rules
deploy/docker-compose/  # 本地 MySQL / Redis / Qdrant
```
