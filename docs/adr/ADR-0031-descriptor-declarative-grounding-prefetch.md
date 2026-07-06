# ADR-0031: descriptor 声明式接地预取（grounding prefetch）—— tool-loop 前主机代跑发现/检索工具、结果注入本轮上下文，领域知识只住 descriptor

- **Status**: Accepted
- **Date**: 2026-07-01
- **Deciders**: 架构组（经 `/improve-codebase-architecture` + `/grill-with-docs` 收敛）
- **Tags**: agent, engine, tool, descriptor, grounding, weak-model-robustness

## Context

同一问数任务、仅 `model` 不同：DeepSeek 能经工具调用查库出结果，doubao 1.5 vision pro 失败。经 `/diagnose` + turn-trace 定位到两条**框架级**根因（非问数专属，问数只是暴露弱模型的场景之一）：

1. **Tool starvation**：intent LLM 产出的 `turnPolicy.includeTools` 把本轮工具收窄到单个动作工具（`mcp.biz-ontology.query_database`），把同一 agent 的 schema 发现兄弟工具（`list_databases` / `read_ontology` / `search_ontology`）挤出本轮 function-calling 可见集。强模型即便如此也会凭已知信息硬凑或换路；弱模型拿不到发现工具、又缺自纠错韧性。
2. **Give-up license**：tool-use system prompt 明确允许「一次失败即可诚实认输」。弱模型据此在首个 `query_database` 因标识符错误报错后直接放弃。

约束基线：**MCP server 是外部依赖，不能改**（无法在 server 侧合并工具、改错误信息含可用标识符、或注入 schema）；跨域只走 contracts port（ADR-0002）；Tool/MCP 编排归 engine（ADR-0006）；tenant 单一隔离（ADR-0012 addendum）；LLM 凭据单源 `llm-core`（ADR-0003）。

已有先例：**knowledge 预取**——host 在 tool-loop 开始前主动查选中的知识库、把命中格式化注入 system prompt。它证明了「轮开始前 host 代跑一个工具、结果接地进上下文」这一形态有效，但它是 knowledge 专用的硬编码路径。

prompt 层缓解（W1：把「一次失败即放弃」改为「缺标识符先调发现工具再重试」；W2：intent prompt 默认 `includeTools` 留空、若 pin 动作工具须连带 pin 发现兄弟）已在 `cube-engine-prompt-overrides.ts` 落地。但 prompt 是**劝导**——对弱模型是概率性的，即便到位，doubao 级模型仍可能不主动发起发现调用。需要一个**不依赖模型自觉**的确定性兜底。

## Decision

### 1. 接地预取 = 通用 host 机制，非 knowledge/ontology 专属

定义「接地预取（grounding prefetch）」（见 [CONTEXT.md](../../CONTEXT.md)）：**tool-loop 开始前，host 代 agent 预跑一次发现/检索类工具，把结果格式化注入本轮上下文**，让本轮 LLM（尤其弱模型）无需自己发起发现调用即可拿到真实标识符（表 / 视图 / 实体 / 列 / id）。knowledge 预取被重新理解为该机制的第一个实例。

### 2. 领域知识只住 descriptor 声明，engine 域无关

「调哪个工具、取什么参数」是**领域知识**，只住 agent descriptor 的声明式字段，engine 代码**零领域名**（绝不出现 `mcp.biz-ontology.*`）。contracts `TenantAgentContentSchema` 加可选字段：

```ts
groundingPrefetch?: Array<{
  tool: string;                    // 运行时镜像/registry 中的工具名
  args?: Record<string, unknown>;  // 静态入参（如 { connection: "", entity: "_index" }）
  queryFromPrompt?: boolean;       // 为 true 时把本轮 prompt 作为 query 注入（与 args 合并）
  topK?: number;                   // queryFromPrompt 时的召回条数
}>
```

任何 agent 声明即得；未声明的 agent 行为完全不变（向后兼容）。声明经两条 resolver（`runnable-agent-resolver` / `tenant-descriptor-resolver`）透传、`session.service` 白名单投影进 snapshot。

### 3. host 执行经共用 `runContextPrefetch` seam

抽出 `runContextPrefetch` helper 收敛「tool-call-start → invoke → tool-call-end（成功/失败）」的机械骨架。knowledge 预取迁移为该 seam 的第一个 adapter、grounding 预取（`prefetchAgentGrounding`）为第二个——**两 adapter 坐实真 seam**（一个 adapter 只是假想 seam）。新增预取种类只写「调什么 + 结果怎么格式化」，不再复制 chunk 管道。

### 4. 预取以真实 tool-call 事件对流出，失败不阻断本轮

预取经与正常工具调用同构的 `tool-call-start` / `tool-call-end` chunk 对流出 → 可观测、可回放。另发 host engine 事件 `grounding_prefetch_end` / `_skipped` / `_failed`。任一项失败**只降级、不阻断**本轮（graceful degradation）——弱模型仍可回落到自己调发现工具（此时 W1 prompt 生效）。

### 5. 门控

- 工具必须**已镜像进本轮 registry**，否则跳过并发 `tool_not_registered`（不臆造调用）。
- `queryFromPrompt` 且 prompt 过短 → 跳过并发 `query_too_short`。

### 6. 与 W1/W2 prompt 两刀是纵深防御互补

prompt 两刀劝模型「缺标识符先发现」（对强模型足够、对弱模型概率性）；接地预取是 host「直接把发现结果端上桌」（对弱模型确定性兜底）。两者不互斥、不重复——一个改「模型该怎么想」，一个改「模型开局手里有什么」。

## Consequences

- **Positive**：弱模型鲁棒性**确定性**提升，不依赖模型自觉调发现工具；engine 严格域无关，任何 agent 声明即得、加新预取种类无需改 engine；contracts 仅一个可选字段 + 两条透传，向后兼容；knowledge / grounding 共用 seam，DRY + locality（预取骨架收一处）；预取全程可观测（真 tool-call 事件 + host 事件）；预取声明随 agent draft/publish 生命周期走（ADR-0016），可按 agent 差异化。
- **Negative**：带 `groundingPrefetch` 的轮多一次（或多次串行）工具调用 → 首字延迟 + 成本上升，即便本轮 LLM 本不需要该数据；`groundingPrefetch` 进了**共享内核 contracts** wire schema + DB descriptor，**难回退**（删除即破坏契约）；声明的静态 `args` 与外部 MCP server 的真实入参 schema **耦合**，server 改签名时声明须跟着改（「外部依赖不可改」前提下的必然取舍）；预取结果注入 system prompt，长输出需截断（当前 4000 字符）。
- **Neutral**：运行时 tool-activation / intent 路由不动；knowledge 预取语义不变（仅重构为共用 seam 下的 adapter，既有测试保绿）；tachu 侧可选的「loop 内强制首调发现工具」改进另由 handoff 记录，与本 host 轮前预取分工。

## Options Considered

- **改 MCP server（合并发现+查询工具 / 错误信息含可用标识符 / server 注入 schema）**：最治本，但 server 是外部依赖不能改。否（前提约束）。
- **纯靠 prompt 两刀（W1/W2）不加预取 seam**：零新机制、最小改动，但 prompt 对弱模型是概率性劝导，doubao 级仍可能不主动发现。否（prompt 两刀留作强模型层，另加预取作弱模型确定性兜底，二者纵深互补）。
- **硬编码 ontology 预取进 engine（仿 knowledge 专用路径）**：最快，但 engine 认领域工具名（`mcp.biz-ontology.*`），违背域无关 + ADR-0002；每加一种预取都改 engine。否（descriptor 声明，engine 零领域名）。
- **config / 环境变量驱动预取声明**：engine 仍无领域名，但预取是 **agent 行为特征**，应与 agent 版本/发布绑定；住 config 则与 agent 生命周期脱节、无法按 agent 差异化。否（住 descriptor，随 draft/publish）。
- **建完整 ContextPrefetch registry seam（预取器注册表 + 策略）**：最可扩展，但当前仅 knowledge / grounding 两类，registry 仪式过重（over-engineering）；Level 1 共用 helper 已得 DRY + locality。暂否（后续更多预取种类触发再升级为 registry）。
- **做成 tool-loop 内 first-class「强制首调发现工具」**：更贴近模型自然流程，但要改 tool-loop 引擎（tachu 侧）、强制首调对不需要的轮是浪费；host 轮前预取在 loop 外、对 engine 侵入更小。否（host 轮前预取；tachu 侧改进另记 handoff）。
- **预取结果注入 user message 而非 system prompt**：user message 更「新鲜」、模型更重视，但与 knowledge 预取注入 system 的既有约定不一致、且混入用户话轮语义。否（注入 system，与 knowledge 对齐）。

## Open Questions

- `topK` / 注入截断阈值（当前硬编码 4000 字符）是否该 per-entry 可配。
- 多个 `groundingPrefetch` 项当前**串行**执行——是否该并行（省延迟 vs. 加复杂度）。
- 声明静态 `args` 与外部 MCP server 真实 schema **漂移**的探测/告警（当前 server 改签名 → 预取 `failed` 事件，但无主动校验）。
- 是否加「仅 intent 判定为复杂/需工具的轮才预取」门控，避免简单轮无谓开销（当前每带声明的轮都预取）。
- 与 tachu 侧可选的 loop 内「forced discovery first step」改进的终局分工（handoff 已记）。
