# ADR-0036: 常驻 session_recall 工具（同会话按需召回）+ 会话连续性演进方向

- **Status**: Accepted
- **Date**: 2026-07-10
- **Deciders**: 架构组（经历史召回缺口调研 + `/improve-codebase-architecture` + `/tdd`）
- **Tags**: agent, engine, tools, session, memory, context

## Context

同 session 内 MySQL `messages`（UI/`listMessages`）与 tachu `MemorySystem` 热窗（LLM 装配）双轨分裂：热窗冷启动（默认 `in-memory`、进程重启、Redis miss）后，UI 仍可见「上一份报告」，模型却称「全新会话」并编造占位内容。行业基线（Cursor / Codex / Claude）对**同会话**是 L1 自动 transcript 进 prompt，超窗再 L2 compaction，跨会话才 L3 记忆/检索工具。

本期产品选择：**先落地常驻 `session_recall` 工具**（模型按需读本 session 权威 transcript），**延后**行业同款的 turn-start 热窗回灌；用户级 `memory_recall`（跨 session）本期不做。

## Decision

### 1. 本期：引擎内置常驻工具 `session_recall`

- **Scope**：仅当前 `sessionId`（`ToolHandlerCtx.session.id`）；数据源 = MySQL `messages`（与 `listMessages` 同权威），**不是** Qdrant `memory.search` 投影。
- **常驻**：描述符注册后经 `computeTachuToolMirrorNames` 强制并集（对齐 `currentDate`），不依赖 agent `toolRefs` 声明。
- **调用语义**：模型主动调用；默认尽量返回全文；一次性体积超过 `maxChars` 预算时返回 `mode: "summary"` + `truncated: true`（有损预览/近端优先），而非静默截断无标记。
- **非目标**：不替代热窗多轮连续性；不解决「模型忘记调工具」的鸡生蛋问题（见演进）。

### 2. 演进方向（明确分期，避免把工具当成 L1）

| 阶段 | 能力 | 对齐行业 |
|------|------|----------|
| **本期（本 ADR）** | 常驻 `session_recall` 读 MySQL transcript | Claude chat-search **形态**，但 scope=同 session（偏 L2 深挖入口） |
| **下一阶段** | Turn start / Memory load miss 时 **SessionTranscriptContinuity**：MySQL → `MemorySystem` 回灌 | Cursor/Codex/Claude **L1** 同会话自动可见 |
| **再后** | 热窗超预算 compaction（摘要替换旧轮，保留近端原文） | L2 compaction |
| **另轨（不做于本期）** | 用户级 `memory_recall` / 跨 session 记忆合成 | L3（Claude memory / Codex memories） |

**不变量**：同 session「上一份报告」类指代的**正确性**最终由 L1 回灌保证；`session_recall` 是按需深挖与过渡期缓解，**不得**在后续 ADR 中被表述为 L1 的替代方案。

### 3. 与现有 memory 工具的边界

- 现有 `MemoryHandler`（get/set/delete/search）操作 `MemorySystem` / Qdrant 投影；**无**生产 builtin descriptor。
- `session_recall` **不**复用 `operation: search`，避免「向量 snippet ≈ 对话权威」混淆。
- 用户级跨 session 召回若落地，使用独立名（如 `memory_recall`），不扩展本工具 scope。

## Consequences

- **Positive**：模型在热窗空时仍有显式通道取回本 session 报告/原文；与 UI 同源（MySQL）；常驻降低「工具未进 availableTools」漏配；演进路径写死，避免长期停在 tool-only L1。
- **Negative**：每轮 tool schema 多一项常驻成本；依赖模型主动调用——空窗 + 弱提示下仍可能不调（实锤会话已见）；summary 有损。
- **Neutral**：不改 ADR-0032（规则不入 memory）；不改 ADR-0029（仍按 session 锚定读 messages，handler 用当前 session 上下文，不做跨 session 越权读）。

## Options Considered

- **仅 turn-start 回灌（不做工具）**：最对齐行业 L1，直接修实锤 bug；本期排期选择先工具后回灌。否（本期）。
- **仅常驻工具、永不回灌**：把 L1 永久降成可选动作。否（本 ADR 演进表否决）。
- **扩展 `MemoryHandler.search` 读 MySQL**：混淆热窗/向量/权威 transcript。否。
- **常驻 `session_recall` + 文档化 L1/L2/L3 演进（本决策）**：过渡可用、边界清晰。是。

## Open Questions

- L1 回灌触发点：`TurnService` 相位前 vs `MemorySystem.load` miss 懒回填。
- summary 策略：近端全文 + 远端预览 vs 单段 LLM 摘要（成本/延迟）。
- 常驻工具 token 成本是否需像 ADR-0034 一样压描述符正文。
