# ADR-0010: 收编路线图 —— 另起并行新系统，copy 实现串联，C1 先行验证 port seam

- **Status**: Done（路线图 M0–M6 已全部走完，仅存历史价值；生产 cutover 待办见 docs/backlog.md）
- **Date**: 2026-06-05
- **Deciders**: 架构组（经 `/grill-with-docs` 收敛）
- **Tags**: migration, roadmap, sequencing, greenfield, consolidation

## Context

终态（方案 A）：单一 AI-center 仓 + 前端走 SDK，与 agentic-engine 现有 engine+adapters+contracts+sdk-* 形状天然吻合，port 已就位。

本次收编不是在旧系统上「就地灰度迁移」，而是**另起一套并行新系统**：copy 各处实现进新仓串起来，前端也新开独立项目，与现网不冲突、不动旧系统；新系统就绪后**整体切换**，旧系统在此之前照常运行。这把过渡复杂度挡在新仓之外——无需在新仓里维护「转发回老系统」的过渡桥或逐 port 灰度。

约束前提：copy-not-move（ADR-0001）、新仓权威（ADR-0007）、port-only seam（ADR-0002）。

## Decision

### 手法：并行 greenfield 构建，不做过渡桥

- 新仓 AI-center 作为**独立新系统**从零搭起；各能力实现从源仓 **copy** 进来（ADR-0001），经 contracts port 串联（ADR-0002）。
- **不在新仓内维护 legacy HTTP adapter / 转发回老 ghcloud 的过渡桥，也不做逐 port 灰度**。每个 port 在新仓只有一个 in-repo adapter（真实现）。
- 旧系统（ghcloud ai-server/ai-application、cube-ai）在新系统就绪前**原样运行、不改动**；回退手段是「不切流量、继续用老系统」，而非新仓内的双路径。
- 前端是**全新独立项目**，消费领域 SDK（ADR-0008），与现网前端并存、互不冲突。

### 顺序（构建与验证次序，非灰度次序）

1. **C1（先行，最高收益/最低风险）**：把多处 LLM 实现（engine provider / cube-ai flow 的「节点 config 焊 key」+ `model-providers`〔assistant 玩具**不迁**，见 ADR-0012〕/ ghcloud llm-catalog）收敛成单一 `LlmProviderPort` + `@cube-ai/llm-core`。它**最高频、最独立**，先做即一次性消除最重复的能力，并**验证 contracts port 作为唯一跨包 seam 的可行性**，为后续能力定调。
2. **C2 / C3**：把 cube-ai flow / kb 的实现 copy 进新仓、抽为经 `FlowInvokerPort` / `KnowledgeQueryPort` 暴露的能力包；向量化独立成 capability 包 `embedding`、向量存储提取为 infra `vector-qdrant`（kb/engine 直连、不设 port）（ADR-0005）。
3. **C4**：搭新前端项目，收口到「领域×面」SDK（`agent-sdk-client*` / `flow-sdk-{client,console}` / `kb-sdk-{client,console}` / `llm-sdk-console`），不复用现网前端的 gateway façade 与深相对 import（ADR-0008/0011）。
4. **C5**：整体切换上线；ghcloud 退化为薄平台 adapter、ai-server 退役（ADR-0009）。

### 验证手法

每个能力收编时用「删除测试」判断源仓各层去留：删掉某层若复杂度不重现（纯壳）→ 不 copy、直接弃；若复杂度搬回别处 → 它在空转、应收编进能力包；若复杂度在 N 个调用点重现 → 它是深模块、值得在新仓固化为 port 实现。这是**源码分析工具**，不是运行时灰度开关。

## Consequences

- **Positive**：新仓全程干净，无过渡桥/双路径包袱；旧系统零改动、零风险；C1 先行即验证 port seam 并兑现最高频能力的去重；前端独立项目可与现网并行演进。
- **Negative**：切换是「整体切」，回退粒度粗（回退=继续用老系统，而非 port 级灰度）；新旧系统并存期需保证数据/中间件兼容或迁移方案（MySQL/Redis/Qdrant 的归属与迁移另议）。
- **Neutral**：顺序是构建/验证次序而非不可逆架构决策；某步受阻可在不破坏终态前提下调整次序。

## Open Questions

- 整体切换时新旧系统的**有状态数据迁移/双写**方案（MySQL / Redis / Qdrant）——本 ADR 未定，留待切换计划。
- Langflow 从 **直连 vendor 例外清单** 收口的时点（候选：LF `base_url` 指向 LLM 网关）——见 ADR-0003/0004。
- Cube 线性引擎 与 Langflow 的终局归属——见 ADR-0004。
