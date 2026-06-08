# ADR-0004: Flow 整套收编为 @cube-ai/flow-core（FlowInvokerPort 同进程 + 独立 SSE 直达），横切收归，双后端内化，DSL 编译收口

- **Status**: Accepted
- **Date**: 2026-06-05（经 cube-ai 服务拆分现状重评修订）
- **Deciders**: 架构组（经 `/grill-with-docs` 收敛）
- **Tags**: flow, langflow, dsl-compile, flow-invoker-port, deployment, consolidation, migration-scope

## Context

> 本 ADR 早前版本假设 flow「切两半、分布 `cube-ai/server/flow` + `ghcloud ai-application`、engine 经 **4 跳浅链**才碰到实现」。经 cube-ai「全面架构改造——服务拆分」(`400b45e`) 重评，该假设已过时。完整勘察见 **[`../architecture/cube-ai-current-state.md`](../architecture/cube-ai-current-state.md) §3**。

flow 现状（cube-ai 服务拆分后）：`@cube-ai/flow` 已是**自洽完整域**（107 文件），含：

- **本体**：`engine`（`cube-linear-engine` 经 `openai-compat-chat` 调 LLM）、`langflow`（`langflow-client` + cube↔lf 双向翻译 + **LF MCP 同步**，经 `LANGFLOW_BASE_URL` 调外部 Langflow）、`custom-component`（**DSL v2** 编译 `compile-v2`/`dsl-to-cube-schema`/`lf-template-from-dsl`）、`components`、`flows`（CRUD·exec·playground·sync·monitor·files）、`webhook`、`guardrails`、`observability`。
- **夹带的横切**：`auth`（access-token）、`api-keys`、`projects`（租户）、`settings/model-providers`（模型商凭据存 `app_kv`）、`mcp`（**MCP 客户端**：探测外部 MCP server 的工具列表 + 同步注入 Langflow；**非** MCP server，见 ADR-0006 #6 事实订正）。
- **双库**：sqlite + mysql。
- **独立 SSE**：`flows/cube-sse-*`、`http/sse-response`——flow 是一个**可直达域**，不只是「藏在 port 后被 engine 调」的库。

执行后端双路：`flow-execution.service` 由 `EXP_USE_CUBE_FLOW_ENGINE` 选 Cube 线性引擎 / Langflow，LF 失败时 `shouldFallbackCubeEngine` 回退。`ghcloud ai-application` 的 compile/DSL 映射在服务拆分后已不再是 flow 的「另一半」（其退役见 ADR-0009）。

## Decision

把 flow **整套**收编为 in-repo 能力包 `@cube-ai/flow-core`（同进程），功能零丢失。

1. **flow 本体整套迁入**：引擎 / langflow / DSL / components / flows / playground / webhook / guardrails / observability + **projects-as-container**（flow 领域聚合，flows 归属 project）。
2. **两种消费模式并存**（关键修订）：
   - **(a) 直达**——flow-core 自带 SSE，前端经 `/flow/*` 直接访问（ADR-0008）；flow 与 kb 一样是**可直达的平级下游域**（ADR-0012 D2）。
   - **(b) 被 engine 调用**——`FlowInvokerPort` → in-repo adapter（同进程），`agent-engine` 把 flow 当能力编排。ghcloud HTTP adapter 降级为 legacy 过渡层（两 adapter 坐实同一 seam）。
   - flow **不是**「只藏在 port 之后」——它既被 engine 编排，也对前端直达。
3. **横切收归**（ADR-0012 D3）：
   - flow 自带的 `auth`/租户身份 → **host 注入源**（ADR-0009 D2）；因身份是**注入式 seam**（本体只读 `currentProjectId()`/`isGlobalAccessEnabled()`），**换源不动本体**。
   - flow `api-keys`（developer 程序化执行 key）→ **认证(key→principal/租户)归 host 身份层（host 备 PAT 能力）**，flow 只留 **key→可跑哪些 flows 的 grant 授权**（领域数据，同 projects-as-container）；x-api-key 校验经 host 注入 reader（同 Bearer，本体不改），发券 UI 去 host console（ADR-0012）。
   - 模型商凭据（`settings/model-providers` 存 app_kv + flow 节点 config 焊 `api_key`）→ **llm-core catalog**：model-providers **退役**（模型接入统一去 llm console）、节点 key→**modelRef**（软过渡），落地见 ADR-0003。
4. **Cube 线性引擎的 LLM 调用迁到 `LlmProviderPort`**（C1），删掉自带 `openai-compat-chat` 直连；legacy 节点残留 key 经 port 的临时 **key-override fallback** 承接（软过渡，数据迁移完 sunset，ADR-0003）。
5. **双后端内化**：Cube 线性引擎 / Langflow 的选择是 flow-core 内部细节，藏在 port/路由之后，engine 不感知跑了哪个后端。
6. **DSL 编译收口**：以 cube-ai 的 `compile-v2` / `dsl-v2.schema` 为准；ghcloud ai-application 的 compile/companion/DSL 映射退役，编译与引擎回到同一 locality。
7. **Langflow 保持现状（本轮不动，非核心）**：仍是经 `LANGFLOW_BASE_URL` 调用的**外部运行时**，自带 key 直连 vendor——ADR-0003 直连例外 + ADR-0009 显式排除单进程。
8. **剥离 assistant 残留**：flow repo 的 `listAssistantSessions`/`createAssistantSession` 等（为玩具 assistant 服务，assistant 不迁）在迁移时剔除（ADR-0012 D1）。
9. **战略取向不在本轮决定**：「Cube 线性引擎是否终将取代 Langflow」记为 **open question**。

### 去风险迁移法（针对「迁移后功能异常」）

1. **先整体 copy flow 跑绿** flow 自带的大量 `*.test.ts`，证搬运无损；
2. **逐处换源 + 回归**：身份源 flow→host；凭据源 model-providers→llm-core catalog，每换一处跑测试；
3. **projects-as-container 留 flow**（领域数据，非身份）。详见 ADR-0012 D3。

## Consequences

- **Positive**：flow 功能整套迁齐、一个不少；横切收归后不再带第二套 auth/租户/凭据进新仓；编译与引擎同 locality；Cube 线性引擎的 LLM 用量/能力匹配收口进 provider；flow 既可被 engine 编排（FlowInvokerPort）又对前端直达（独立 SSE）；迁移风险被 flow 自带测试夹住、本体零改；engine→flow 从 4 跳降到 1 跳。
- **Negative**：`@cube-ai/flow-core` 体量大（引擎 + 编译 + LF client + 本体横切前的全套）；横切换源需逐处验证；Langflow 仍是外部运行时，flow-via-LF 的 LLM 用量与凭据短期不收口；单进程「1 跳」承诺仅对 Cube 线性引擎成立，LF 路径仍有 flow→外部 LF 一跳（LF 固有）。
- **Neutral**：双后端开关 `EXP_USE_CUBE_FLOW_ENGINE` 语义保留，移到 port/路由之后，成为 flow 内部配置。

## Options Considered

- **flow 连横切（auth/租户/凭据）原样搬**：最快，但把第二套身份/凭据栈固化进新仓，与 ADR-0012 D1「唯一真源」精神冲突。否（除非显式临时态）。
- **flow 只藏在 FlowInvokerPort 之后、不暴露直达路由**：对称好看，但 flow 本有独立 SSE、前端需直接编辑/运行流程，强行只走 engine 会把 flow 操作硬塞进 turn。否（保留直达 + 编排两模式）。
- **保持 ghcloud HTTP adapter 为主、不收编实现**：改动小，但浅链与「flow 切两半」原样留存，违反 C2。否。
- **把 Langflow 也收进单进程 / 改造为走网关**：凭据用量彻底收口，但要求本轮动 LF（用户明确排除、风险高）。改为「LF 作外部依赖 + 例外清单」。否（本轮）。
- **本轮即裁定 Cube 线性引擎为终态、弃 Langflow**：方向清晰，但 Cube 引擎当前仅线性 MVP，过早押注绑死。记为 open question。否。

## Open Questions

- Cube 线性引擎 与 Langflow 的终局归属（自研取代 LF / LF 长期主引擎 / 双轨并存）。
- Langflow 何时、以何路径从**直连 vendor 例外清单**收口（候选：LF 节点 `base_url` 指向 **LLM 网关** + 租户级 key）。

> 已决（不再 open）：flow `mcp`（**客户端探测 + 同步进 LF，非 MCP server**）随 flow-core、与 engine **各自装配**（Decision #3 引、ADR-0006 #6 事实订正）；flow `api-keys` 认证**统一归 host**、flow 只留 grant（Decision #3、ADR-0012）。flow 对外仅 `FlowInvokerPort` + 直达 SSE 两个面。
