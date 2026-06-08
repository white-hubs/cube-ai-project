# ADR-0001: 新建 cube-ai-project 收敛仓，按中台领域划分，迁移用 copy

- **Status**: Accepted
- **Date**: 2026-06-05
- **Deciders**: 架构组（经 `/grill-with-docs` 收敛）
- **Tags**: repo, consolidation, domain-layout, migration

## Context

「跑 agent / 调 LLM / 列模型 / 执行 flow / 检索知识」这套 AI 核心能力当前被实现了 2–3 遍，散在三个仓：

- `cube-agentic-engine`（@cube-ai/* monorepo：engine + agentic-adapters + contracts + sdk-*，port 已就位，27 篇 ADR、CONTEXT.md、deploy/k8s 齐备）
- `cube-ai`（redesign：flow 引擎 / Langflow / kb Qdrant / assistant）
- `ghcloud`（prod：ai-server 壳 + ai-application 的 flow 编译/DSL 映射/kb 转发/llm-catalog）

三仓的目录结构各按自身便利演化，规范不一。收敛目标是把 AI 中台该做的事统一到一处，并**按中台领域**（而非沿用任一旧仓的物理结构）重新划分。

候选：(A) 就地演进 `cube-agentic-engine`；(B) 新建干净仓 `cube-ai-project` 收敛。

## Decision

采用 **(B)**：以新建的干净仓 `cube-ai-project`（`work-ghy/cube-ai-project`，scope 仍为 `@cube-ai/*`）作为单一 AI 中台仓。

- **领域优先布局**：包/目录边界由 AI 中台领域分解决定，不照搬 `cube-agentic-engine` / `cube-ai` / `ghcloud` 任一旧仓的结构。
- **迁移 = copy，不是 move**：从三个旧仓引入实现时一律复制，**不得破坏现有仓库**（`cube-agentic-engine` 等保持可运行）。旧仓在收敛完成、确认替代后另行决定退役，不在本次迁移中删改。
- **决策史与契约继承**：`cube-agentic-engine` 已 Accepted 的 ADR 与 CONTEXT.md 作为输入证据，但在新仓按领域重新组织后再落地，不机械搬运编号。

## Consequences

- **Positive**：一次性获得「按中台理念组织」的干净结构；不被任一旧仓的历史包袱绑定；源仓不受迁移影响，可随时回退参照。
- **Negative**：`cube-agentic-engine` 沉淀的 27 篇 ADR、工装、deploy/k8s 需要重新评估并择优 copy，而非零成本继承；存在「同一决策两处记录」的短期重复，需以本仓 ADR 为新权威。
- **Neutral**：`@cube-ai/*` scope 不变，已迁移包的包名不会因仓库切换而 churn。

## Options Considered

- **(A) 就地演进 cube-agentic-engine**：零迁移成本、决策史天然继承，但结构受 engine 历史布局约束，难以「按中台领域重划」，且会把 engine 仓变成承载一切的杂烩。被否。
- **(B) 新建 cube-ai-project 收敛（采纳）**：用领域分解重做边界，源仓 copy 不破坏；代价是需主动择优搬运既有资产。
