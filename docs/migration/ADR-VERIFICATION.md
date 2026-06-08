# ADR 严格验收跟踪板

> 规则：Pass=1 · Partial=0.5 · Fail=0 → **完整度 = 加权平均**  
> **>90% 标记 DONE**，停止该 ADR 的 implement 循环；运维 cutover 不计分。

## 状态总览（终轮 2026-06-07，交叉审计校正）

| ADR | 主题 | 基线% | 当前% | 状态 |
|-----|------|------:|------:|------|
| ADR-0001 | 收敛仓/领域布局 | 53 | **94** | ✅ DONE |
| ADR-0002 | 包边界/依赖方向 | 90 | **92** | ✅ DONE |
| ADR-0003 | LLM 一核两面 | 79 | **78** | 🟡 Partial |
| ADR-0004 | flow-core | 75 | **91** | ✅ DONE |
| ADR-0005 | kb/embedding | 81 | **92** | ✅ DONE |
| ADR-0006 | Tool/MCP @ engine | 100 | 100 | ✅ DONE |
| ADR-0007 | workspace 治理 | 85 | **94** | ✅ DONE |
| ADR-0008 | 前端 seam | 68 | **74** | 🟡 Partial |
| ADR-0009 | ai-center 拓扑 | 82 | **93** | ✅ DONE |
| ADR-0010 | copy 串联 | 88 | **92** | ✅ DONE |
| ADR-0011 | 路径派生命名 | 53 | **94** | ✅ DONE |
| ADR-0012 | 单一真源/三域 | 83 | **91** | ✅ DONE |

**全局**：**10/12 ADR >90%**；ADR-0003 / ADR-0008 仍 Partial（交叉审计诚实分，见下）。implement 循环对这两项**未停止**。

## 硬门禁

```bash
bun run typecheck
bun run test
bun run verify:layout
```

**终轮实测（2026-06-07）**：typecheck 全绿 · test-all **1641 pass / 22 skip / 0 fail**[^skip] · verify-layout OK

[^skip]: **22 skip** 主要为 `USE_TESTCONTAINERS=1` / `USE_GHCLOUD_IDENTITY=1` 等 env 门控的集成测（agent-engine testcontainers、ghcloud identity E2E 等）；`test:all` 汇总见 `scripts/test-all.ts`。不计入 pass 分母，亦**不**视为 fail。

## 验收项摘要（每 ADR 10–15 条，终轮得分）

### ADR-0001 收敛仓布局（94%）
- v6 目录树 git mv 完成 · workspaces glob · 无 legacy 扁平包 · README · deploy/docker-compose · descriptors · ai-center/routes · platform-host 收口 · verify-layout 门禁 · 组合根 apps/ai-center · docs/architecture 对齐 · 无 platform-adapter 根目录 · 过渡包 shared 消除
- **脚注**：`descriptors/tools/`、`descriptors/skills/` 仅为空目录脚手架（README 已列结构，尚无 YAML/资源）；`agents/`、`rules/` 各有 1 个种子文件

### ADR-0011 路径派生（94%）
- 多包领域子目录 agent/llm/flow/kb · platform-adapters 复数目录 · bun-server-ext 单数嵌套 · 包名 @cube-ai/* 不变 · test-all cwd 更新 · tsconfig paths · CI 路径 · infra 扁平例外 · SDK 按面子目录 · 无旧路径 import（代码） · verify-layout forbidden 列表

### ADR-0007 workspace 治理（94%）
- 根 package.json workspaces · 无 platform-host workspace · catalog bun-server · typecheck.ts 全包 · test-all.ts 全包 · 无 orphan package.json · apps/* 仅 ai-center+ai-console · infra/*/* glob · patchedDependencies · bun.lock 一致 · verify-layout

### ADR-0003 LLM 一核两面（78%）
- LlmProviderPort · CatalogDrivenProvider · POST /v1/chat/completions · POST /v1/embeddings · llm-gateway.test.ts · model-providers 退役 · catalog-migrate SQLite upsert · direct-vendor-exceptions.md · openai-compat-chat 删除 · GET /llm/providers · 凭据 catalog 权威
- **缺口（审计）**：anthropic/gemini 等 provider 与连通 adapter 仍 stub/未全覆盖（M1 T4/T6 偏差）；Langflow 直连 vendor 例外未收口；catalog 运行时对账与预发 cutover 未验

### ADR-0004 flow-core（91%）
- FlowModule 在 ai-center · cube-engine-llm LlmProviderPort · 域前缀 /flow · flow SSE E2E test · model-providers 未注册 · assistant SQL 剔除 · Langflow 例外登记 · DSL v2 保留 · FlowInvokerPort · 无 openai-compat-chat

### ADR-0005 kb/embedding（92%）
- @cube-ai/embedding · vector-qdrant infra · AiKbModule 真面 · engine memory→vector-qdrant+EmbeddingPort · LlmProviderPortBridge dense 契约 · kb-sdk-client · KnowledgeQueryPort · 无 tachu embed 直连

### ADR-0008 前端 seam（74%）
- ADR-0008 addendum agent=/v1/* · ai-console core-flows · flow/kb SDK smoke · domain middleware · llm-sdk-console · agent-sdk /v1 · /agent UI-only · SSE turn.completed test · **文档路由表已与 addendum 对齐**（BL-004）
- **缺口（审计）**：ai-console 仍 smoke 级 UI（非完整会话/SSE 产品流）；kb/llm HTTP 面对外能力薄；gateway façade 退役在代码侧完成、现网 cutover 未验

### ADR-0009 ai-center 拓扑（93%）
- 单进程 bootstrap · deploy compose · routes/ 领域 HTTP · platform 内嵌 server-base/shared/mock · ghcloud adapter · health/live · domain-routes E2E · identity E2E mock JWT · FlowModule+KbModule+Engine

### ADR-0010 copy 串联（92%）
- M0–M6 垂直切片 · contracts 真源 · test-all 矩阵 · PROGRESS 文档 · migration tools · 无 move-only · engine anchor · llm catalog copy · flow copy · kb copy

### ADR-0012 三域拓扑（91%）
- engine 唯一运行时 · flow/kb 平级 · AiKbModule HTTP · identity E2E · 无 assistant 迁入 · platform ports · kb 非 smoke · 三域 prefix E2E · Langflow 外部

### ADR-0002 包边界（92%）
- contracts 零依赖 · BC 不互 import 实现 · composition-root-import-boundary.test · adapter 层 ghcloud · flow→LlmProviderPort token · kb→EmbeddingPort · 无 @cube-ai/shared

### ADR-0006 Tool/MCP（100%）
- engine-owned · DescriptorModule · McpBridge · 基线 DONE

## 会话日志（append-only）

- [2026-06-06] 基线建立 — 首轮 4 路 subagent 审计；ADR-0006 DONE；启动 Loop1 re-home
- [2026-06-07] Loop1 — re-home + README + deploy/docker-compose + descriptors + routes/ 重命名；verify-layout
- [2026-06-07] Loop2 — /v1 网关 · model-providers 退役 · catalog SQLite · direct-vendor-exceptions · 删 openai-compat-chat
- [2026-06-07] Loop3 — AiKbModule 替 smoke · memory/identity E2E 绿
- [2026-06-07] Loop4 — ADR-0008 addendum · ai-console core-flows · flow SSE E2E
- [2026-06-07] Loop5 — assistant SQL 回归测试 · SDK ADR 引用 · composition-root boundary
- [2026-06-07] 终轮签收 — typecheck + test-all + verify-layout 全绿；**自评 12/12 >90%（后证过度乐观）**
- [2026-06-07] 交叉审计校正 — ADR-0003→78% · ADR-0008→74% · 披露 22 skip · descriptors/tools|skills 空脚手架 · 全局 10/12 DONE
