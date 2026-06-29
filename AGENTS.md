# AGENTS.md — AI 开发入口

本文件是 AI agent 的最小起步上下文。**按需加载，不要预读全部文档。**

## 常用命令

```bash
bun install                  # 安装（workspace + catalog 版本统一）
bun run typecheck            # 全 workspace 类型检查
bun test                     # 离线全量测试（约 10s；testcontainers 用例自动 skip）
bun test <path>              # 跑单个包/文件
bun run build                # SDK dist + ai-sdk-playground 浏览器包
bun run test:containers      # testcontainers 全量矩阵（需 Docker）
bun run dev:up:deps          # compose 起 MySQL/Redis/Qdrant
```

## 渐进式披露路径

| 需要什么            | 去哪里                                                                                                   | 何时读                 |
| ------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------- |
| 领域术语/概念边界   | [CONTEXT.md](./CONTEXT.md)                                                                               | 接触不熟悉的领域词时   |
| 目录布局 + 包依赖图 | [docs/architecture/repo-layout-and-dependencies.md](./docs/architecture/repo-layout-and-dependencies.md) | 跨包改动/新增包前      |
| 某决策为什么这样    | [docs/adr/README.md](./docs/adr/README.md) 索引 → 对应 ADR                                               | 质疑现状设计前         |
| 直连 vendor 例外    | [docs/architecture/direct-vendor-exceptions.md](./docs/architecture/direct-vendor-exceptions.md)         | 涉及 LLM 调用路径时    |
| 未关闭事项          | [docs/backlog.md](./docs/backlog.md)                                                                     | 发现"像没做完"的东西时 |
| 生产切换步骤        | [docs/operations/cutover-runbook.md](./docs/operations/cutover-runbook.md)                               | 运维操作时             |
| 代码结构查询        | codegraph MCP（`codegraph_explore`）                                                                     | 优先于 grep/通读文件   |

## 目录地图（一行式）

```
apps/ai-center            单进程组合根；src/bootstrap.ts 是 DI 装配入口，src/routes/ 领域路由
apps/ai-sdk-playground    SDK 验证沙箱（能力列表 + invoker）
packages/contracts        唯一共享内核：port + wire schema；跨域耦合只能走这里
packages/agent/engine     运行时核心（src/bc/：session·tools·jobs·safety·authz）
packages/agent/sdk-*      agent 前端 SDK 家族（client/vue/assistant/mock）
packages/llm/core         provider BC（chat/stream/embed）+ catalog BC（registry/凭据权威）
packages/flow/core        flow 引擎 + Langflow adapter + DSL 编译
packages/flow/studio      编辑器投影层（editorFlowJson → DSL v2，ADR-0014）
packages/kb/core          文档摄入/检索（modules/{documents,ingestion,vector-store,object-storage}）
packages/embedding        向量化 capability（经 LlmProviderPort.embed）
packages/platform-adapters/ghcloud   平台租户身份（JWT/tenant）
infra/                    bun-server-ext{sse,outbox,nacos}·vector-qdrant·test-infra
descriptors/              声明式资产（agents/tools/skills/rules YAML）
tools/migration           catalog 数据迁移脚本（cutover 后删除）
```

## 硬约束（违反即错）

1. **跨领域只走 contracts port**：能力包之间不得 import 对方实现（ADR-0002）。
2. **持久化统一 MySQL，禁止 SQLite**（ADR-0013）。
3. **租户隔离唯一主键 `tenant_id`，无 project 维度**（ADR-0012 addendum）。
4. **vendor 凭据只住 llm-core catalog**；新增直连 vendor 必须登记例外清单（ADR-0003）。
5. **DI token 保持 `agentic.*` 命名空间**，不要"顺手"改成 `agent.*`（ADR-0015）。
6. **依赖版本走根 package.json catalog**，子包写 `"pkg": "catalog:"`。
7. 临时产物放 `.tmp/`（已 gitignore），不要散落仓库。

## 测试约定

- 测试文件与源文件同目录（`*.test.ts`）；`*.integration.test.ts` / `*.testcontainers.test.ts` 由 env 门控，离线自动 skip。
- 改完代码跑 `bun run typecheck && bun test`，两者全绿才算完成。
