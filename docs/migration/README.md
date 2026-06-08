# AI 中台收敛 · 迁移计划（index）

> 本目录是把分散在三个旧仓的 AI 能力，按已落 ADR 收敛进本 monorepo（`cube-ai-project`）的**可落地完整迁移计划**。
> 采用**渐进式披露**：本文只给总览/排序/全局不变量/用法；每个里程碑的细节在 `milestones/M*.md`；源码事实地基在 `inventory/*.md`；跨会话进度在 `PROGRESS.md`。

## 0. 怎么用这套计划（必读）

- **接手某里程碑前**：先读本文 §3（排序与依赖）+ §4（全局不变量）→ 读对应 `milestones/M*.md` → 读它引用的 `inventory/*.md` 小节。
- **执行中**：每完成一个 task，在 `PROGRESS.md` 勾选并追加一行 session log（这是跨会话不丢上下文的唯一抓手，对应需求「额外的实现进度 ref」）。
- **遇到与计划不符**：停下、在 `PROGRESS.md` 的「阻塞/偏差」区记一笔，不要硬扛（迁移是 copy-not-move，偏差往往意味着源仓有新事实）。
- **不要在本文堆细节**：本文保持精简；细节只进 `milestones/` 与 `inventory/`。

## 1. 目标（Goal）

把 `cube-agentic-engine`（运行时）、`redesign/cube-ai`（flow + kb）、`ghcloud/ai-application`（llm-catalog + 身份）的能力，**copy** 进本仓的单一 monorepo，形成单进程 `apps/ai-center` 组合根；旧仓保持可用，最终整体切换。**不是重写，是带着既有测试搬家 + 按接缝换源**。

## 2. 目标架构（一屏速览，权威见 `docs/adr/`）

```
apps/ai-center                      ← 单进程组合根（装配下面所有，注入 host 身份）
  packages/
    contracts                       ← 唯一共享内核：port 接口 + wire schema(zod) + 错误码 + DI token
    agent-engine                    ← 唯一活跃运行时（session/turn/tool 编排，@tachu/core host）
    llm-core                        ← provider(调用) + catalog(模型注册/凭据) 单一权威
    flow-core                       ← flow 整套（engine/langflow/DSL v2/components/playground/webhook/guardrails/mcp + projects-as-container）
    kb-core                         ← kb 整套（documents/ingestion/retrieval hybrid）
    embedding                       ← capability：文本→{dense,sparse}，经 llm-core 调模型
    *-sdk-client / *-sdk-console    ← 前端消费面 SDK（只走 HTTP/SSE）
  infra/
    vector-qdrant                   ← raw Qdrant 驱动（领域无关，kb-core 与 agent-engine 直连，不设 port）
    bun-server-ext-{sse,outbox,nacos,mock}   ← bun-server 框架扩展
    test-infra                      ← testcontainers 夹具
  platform-adapter-ghcloud          ← 仅鉴权/租户身份（实现 contracts 的平台身份 port）
```

**唯一跨域接缝 = `contracts` 的 port**（infra/vector-qdrant 直连是明示例外）。身份权威在 host，agent-engine / flow-core / kb-core 是三个平级下游域；agent-engine 可经 port 调 flow/kb，flow 也有独立 SSE 直达——三者不冲突。

## 3. 里程碑、排序与依赖（Milestones）

排序原则（承 ADR-0010「构建/验证次序，非不可逆」）：先立**接缝与底座**，再立**最高频且最独立**的能力（llm-core），再立**运行时锚点**（engine，最成熟），随后**小而独立**的 kb，再**最大且横切最多**的 flow，最后前端与整体切换。

| 里程碑 | 标题 | 主要来源 | 关键产出 | 依赖 | ADR-0010 对应 |
|---|---|---|---|---|---|
| **M0** | 地基 & contracts 内核 | agent-engine（contracts/infra）+ cube-ai（workspaces/组合根范式） | monorepo 脚手架、`contracts`、`infra/*`、CI、**框架版本统一**、**@tachu 取数前置** | — | C1 前置 |
| **M1** | llm-core（provider+catalog） | ghcloud llm-catalog + engine provider 适配 + flow 凭据 | `llm-core`、`LlmProviderPort`/`LlmCatalogPort` 落地、凭据单一权威 | M0 | **C1** |
| **M2** | agent-engine 锚点 + ai-center 组合根 | cube-agentic-engine engine 包 | `agent-engine`、`apps/ai-center` 单进程起得来、7 个自足 handler 通 | M0,M1 | C1↔C4 之间（新增） |
| **M3** | kb-core + embedding + vector-qdrant | cube-ai kb | `kb-core`、`embedding`、`infra/vector-qdrant`、engine knowledge/memory 接线 | M0,M1,M2 | **C3** |
| **M4** | flow-core | cube-ai flow（+ ghcloud DSL 对表） | `flow-core`、横切换源、engine flow-handler 接线、独立 SSE | M0,M1,M2 | **C2/C4** |
| **M5** | 前端 & SDK 家族 | engine sdk-* + ghcloud 前端 | `*-sdk-client/console`、新前端、单 origin 领域路由 | M2,M3,M4 | **C4** |
| **M6** | 整体切换 + ghcloud 薄化 + 数据迁移 | ghcloud security + 各域数据 | `platform-adapter-ghcloud`、ai-server 退役、数据迁移、整体 cutover | M1–M5 | **C5** |

依赖图（粗）：`M0 → M1 → M2 →（M3 ∥ M4）→ M5 → M6`。M3 与 M4 之间无硬依赖，可并行/择一先行；本计划默认 **kb(M3) 先于 flow(M4)**（kb 更小更独立、且 embedding/vector-qdrant 抽取对 engine memory 也有用，先验证低风险）。

## 4. 全局不变量（每个里程碑都必须守住）

1. **copy-not-move**：源仓只读、不破坏；本仓是唯一写入目标。每次搬运「先整包 copy + 跑绿既有离线测试」，再「逐处按接缝换源 + 回归」。这是去风险的核心方法（ADR-0004/0012）。
2. **接缝唯一**：跨包只经 `contracts` 的 port + wire schema 交互；唯一例外是 `infra/vector-qdrant` 直连。严禁深相对 import（ADR-0008）。
3. **身份注入式**：各域本体只读身份上下文（`currentProjectId()` 等），不持有身份源；换源只动组合根注入的工厂实现，不动本体（ADR-0009/0012 D2/D3）。
4. **凭据单一权威**：vendor key 只在 `llm-core` catalog；其它地方（flow 节点 config、env、qwen-image）一律软过渡到经 `LlmProviderPort`（ADR-0003）。
5. **命名遵循 ADR-0011**：领域目录不含 package.json，叶子才是真包；集合目录单数化；SDK `<domain>-sdk-<face>[-framework]`；运行包 `agent-engine`。
6. **每步可验证**：每个 task 必须有「跑什么命令、期望什么输出」的验收；里程碑有明确 entry/exit 准则。
7. **进度可续**：任何中断都能从 `PROGRESS.md` 续上（需求 #2）。

## 5. 三条贯穿全程的硬约束（最早暴露、别埋雷）

| # | 约束 | 影响里程碑 | 处置入口 |
|---|---|---|---|
| **G1** | **`@tachu/*`（core/extensions/host-defaults `1.0.0-rc.0`）来自私有 Nexus** `nexus.guhecloud.com`。agent-engine 是 tachu Engine 的 host，拉不到则一行不能编译。 | M0(验证可达)、M2(阻塞) | `milestones/M0` task「@tachu 取数前置」 |
| **G2** | **两仓 `@dangao/bun-server` 大版本不一致**：engine `^3.1` vs flow/kb `2.3.0`。单进程合并必须统一到一个版本。 | M0(定基线)、M2/M4(适配) | `milestones/M0` task「框架基线统一」 |
| **G3** | **kb 的 sparse 向量来自 embedding 模型一次调用**（doubao multimodal）。`EmbeddingPort` 必须返回 `{dense,sparse}`，否则混合检索退化失效。 | M1(port 形态)、M3 | `milestones/M1` + `M3` |

## 6. 投资勘察产物（inventory，事实地基）

- [`inventory/agent-engine.md`](inventory/agent-engine.md) — 运行时/contracts/provider 现状（M0/M1/M2）
- [`inventory/flow.md`](inventory/flow.md) — flow 整套 + 横切 + assistant 残留（M4）
- [`inventory/kb.md`](inventory/kb.md) — kb 检索/向量层/embedding 分界（M3）
- [`inventory/cube-ai-platform.md`](inventory/cube-ai-platform.md) — 组合根 + 身份注入 seam + 命名对照（M0/M2/M4）
- [`inventory/ghcloud.md`](inventory/ghcloud.md) — llm-catalog 数据模型 + 身份 + 退役项（M1/M6）

## 7. 勘察中发现、已回填到 ADR 的修正（✅ 已完成）

> 以下源码事实与早前 ADR 措辞的偏差**已回填**对应 ADR（2026-06-06），计划与决策已对齐。其中带「M1 决策」者是把"事实"写入 ADR、把"最终选型"留到对应里程碑落地。

1. ✅ **flow 没有对外 MCP server**（grep `McpServer`/`setRequestHandler`/`registerTool`=0）：其 mcp 是「MCP 客户端探测外部 + 把 MCP 配置同步进 Langflow」。已回填 **ADR-0006 #6**（事实订正）与 **ADR-0004 §Context/Open**（flow 对外仅 `FlowInvokerPort` + 直达 SSE 两个面）。（详见 `inventory/flow.md §6/§16`）
2. ✅ **`EmbeddingPort` 在 engine 已被废弃**（改用 tachu `EmbeddingRuntime` 走 `ProviderAdapter.embed`）+ **G3 稀疏向量约束**：已回填 **ADR-0005 约束 #1**（事实订正 + `{dense,sparse}` 硬约束；最终是否重建独立 `EmbeddingPort` 由 **M1.T1** 决策）。（详见 `inventory/agent-engine.md §3.2`、`inventory/kb.md §7/§12-1`）
3. ✅ **`LlmProviderPort` 当前不存在**（engine 用 tachu `ProviderAdapter`）：已回填 **ADR-0003 Decision #1**（明确为 M1 在 contracts 新建的接缝，签名对齐 tachu ProviderAdapter、`embed` 回 `{dense,sparse}`）。（详见 `inventory/agent-engine.md §3.2/§7`）
4. ✅ **engine memory 向量是纯 dense@1536；kb 是 dense+sparse@1024**：已回填 **ADR-0005 约束 #6**（`vector-qdrant.ensureCollection` 须参数化命名向量集合而非仅 vectorSize，sparse 可选）。（详见 `inventory/kb.md §6/§13-7`）

## 8. 不在本计划范围（Out of scope）

- `cube-ai/assistant`（玩具，D1 不迁）；其产品价值若需要，另立「以 agent-engine preset 重建」的独立计划。
- ghcloud 非 AI 流量（bff-gw、ouaa、video-monitor 等）保持不动。
- `@tachu/*` 本身的演进（外部依赖，仅消费）。

---

进度看板与会话交接：见 [`PROGRESS.md`](PROGRESS.md)。
