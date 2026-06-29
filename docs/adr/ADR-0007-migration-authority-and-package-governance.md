# ADR-0007: 迁移期 @cube-ai/\* 权威治理（workspace 内部包、按包单一权威、旧仓冻结、新仓 ADR 唯一权威）

- **Status**: Done（迁移期决策，迁移已完成；「新仓 ADR 唯一权威」条款长期有效）
- **Date**: 2026-06-05
- **Deciders**: 架构组（经 `/grill-with-docs` 收敛）
- **Tags**: migration, governance, packages, adr-authority, transition

## Context

ADR-0001 决定 copy-not-move 收敛到新仓 `cube-ai-project`，且 scope 仍为 `@cube-ai/*`。rubber-duck 指出过渡期会出现「双 `@cube-ai/*` 宇宙」：cube-agentic-engine 与 cube-ai-project 同时持有同名包，语义分叉，可能绑错。

实测事实：cube-agentic-engine 的所有 `@cube-ai/*` 包均 `private: true`，**不发 registry**，纯 workspace 内部解析；现有实名带 `agentic-` 前缀（`agentic-contracts` / `agentic-adapters` / `agentic-sdk-*`）。因此「registry 撞版本」并不存在；真正的风险只是「跨仓误引用」与「决策权威分裂」。

## Decision

1. **包均为 workspace 内部（private）**：新仓 `@cube-ai/*` 同样 private、不发 registry，靠各自 monorepo 的 workspace 解析。两仓是独立工作目录，互不通过 registry 交叉解析 —— **无发布撞版本问题**。
2. **按包单一权威**：某包一旦迁入新仓，**新仓为其唯一权威源**；迁入前旧仓仍是该包权威。同一包不在两仓并行演进。
3. **旧仓迁出包冻结**：旧仓对已迁移包停止改动，靠其 workspace 内既有代码继续自运行（满足「不破坏旧仓」）。
4. **禁止跨仓 import**：新仓任何包不得 import 旧仓路径/包，反之亦然；迁移用 copy。
5. **新仓 ADR 为唯一权威**：旧仓 27 篇 ADR 作输入证据；仍生效的决策在新仓**重新落地（re-home）**为新 ADR，**不在新仓把旧仓 ADR 编号当 load-bearing 引用**（如 ADR-0005 已把对旧 0024 的引用改为内联描述）。
6. **借迁移更名去 `agentic-` 前缀，命名规则见 ADR-0011**：新仓采用领域名 `contracts` / `llm-core` / `flow-core` / `kb-core` / `embedding` / 活跃运行时 `agent-engine`（向量存储是 infra `vector-qdrant`），SDK 按面 `agent-sdk-client*` / `<domain>-sdk-<face>`；因无发包，更名零外部影响。

## Consequences

- **Positive**：过渡期无 registry 冲突；权威单一、可追溯；借机正名为领域语义包名；旧仓不受影响、可随时参照。
- **Negative**：同一决策在新旧仓短期「两处记录」，需以新仓为准并主动 re-home；冻结旧仓迁出包需要纪律（避免有人继续在旧仓改）。
- **Neutral**：若未来某包确需对外发布，再按「按包单一权威」决定从新仓发布。

## Options Considered

- **过渡期用临时 scope（如 `@cube-ai-next/*`）隔离**：物理上最防撞，但包均 private、本无撞版本，额外 scope 反增改名与回切成本。否。
- **并入 ADR-0001 一段**：可行，但过渡治理与「copy 不 move」是两件事且 load-bearing，独立成篇便于检索与后续修订。故单独成 ADR。
