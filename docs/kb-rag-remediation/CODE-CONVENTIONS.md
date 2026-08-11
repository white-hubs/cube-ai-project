# 编码与设计约束（Coding & Design Constraints）

> 与 [GATE-CRITERIA.md](./GATE-CRITERIA.md) 配套：门阀管「合不合/开不开」、本文管「怎么写才合规」。一致性、安全和迁移还必须分别核对 [CONSISTENCY-AND-SECURITY-INVARIANTS.md](./CONSISTENCY-AND-SECURITY-INVARIANTS.md) 与 [ROLLOUT-AND-MIGRATION.md](./ROLLOUT-AND-MIGRATION.md)。
> 评审核对清单；违规拒合。防过度设计护栏见 §4。

## 1. 三层落法

| 层 | 内容 | 保证方式 |
| --- | --- | --- |
| 编码规范 | 全量 typecheck / test / lint（oxlint）/ 依赖 catalog / 无散落临时产物 | CI + pre-push（G0-1/2/7/11） |
| 设计模式 / 架构 | ADR 清单、contracts 先行、DI `agentic.*`、env 进 app.config、行为变更 flag 默认关 | 每 W 门阀表「设计约束核对」行 + G0-3/8/9 |
| 可扩展性 | 只对已文档化的演进方向留 seam；扩展点须有消费或测试 | 各 W「设计约束 / 扩展点」节 + G0-10 |

## 2. ADR / 仓库硬约束核对清单

PR 触及本目录实现时，reviewer 按表勾选（与 AGENTS.md 一致）：

| ID | 约束 | 来源 |
| --- | --- | --- |
| C-ADR-0002 | 跨领域只走 contracts port，禁止能力包互 import 实现 | ADR-0002；**不可豁免** |
| C-ADR-0003 | vendor 凭据只住 llm-core catalog；新直连须登记例外 | ADR-0003 |
| C-ADR-0005 | kb / embedding 包边界：向量化 capability 与向量存储分层，禁止混包职责（见 ADR 正文） | [ADR-0005](../adr/ADR-0005-kb-and-embedding-consolidation.md) |
| C-ADR-0012 | 租户隔离唯一主键 `tenant_id`，无 project 维度 | ADR-0012 |
| C-ADR-0013 | 持久化统一 MySQL，禁止 SQLite | ADR-0013 |
| C-ADR-0015 | DI token 保持 `agentic.*` 命名空间 | ADR-0015 |
| C-LAYER | 包内分层：controller → service → repository；不跨层偷调用 | **仓库惯例**（非 ADR-0005；ADR-0005 讲包边界） |
| C-CATALOG | 依赖版本走根 catalog，子包 `"pkg": "catalog:"` | AGENTS.md |
| C-CONTRACTS | 新/改公共接口：zod schema + 导出 + ≥1 单测（**不可豁免**） | 本目录；G0-8 |
| C-CONFIG | 新 env → `packages/kb/core/src/config/app.config.ts`（或对应包 config） | overview §4.2 |
| C-FLAG | 风险性行为默认 feature flag **off**；默认 on 需要书面兼容例外、迁移和回滚证据 | G0-9 |
| C-TMP | 临时产物只落 `.tmp/` | G0-4 |
| C-IDENTITY | ACL/反馈权限只消费 verified principal/受信 port context，不从原始 header 推导已认证 | 安全不变量 §4 |
| C-VERSION | 不可变 generation 隔离正常更新；若允许同 ID 更新/导入，embedding 与 payload 必须有独立 version；ID 对账不得冒充内容完整性证明 | 一致性不变量 §1–2 |
| C-ROLLOUT | schema/index/backfill 必须 additive-first、可续跑、可回滚 | ROLLOUT-AND-MIGRATION |

## 3. 编码规范细则

- **命令**：合并前 `bun run typecheck && bun test && bun run lint` 全绿（全 workspace，见 G0-1/2/7；对齐 AGENTS.md）
- **格式**：以仓库 oxfmt / oxlint 为准；不另造风格指南
- **测试**：新增或修改的公共接口 / 核心分支必须有 ≥1 覆盖用例（纯配置/文档/DI 接线且行为不变除外）— G0-11
- **复用惯例**：BaseRepository、contracts port + zod、既有 error 类型；不平行造第二套抽象

### 3.1 本轮跨包改动白名单

本轮不是把改动机械限制在 `packages/kb/core`，而是限制为“KB 能力落地所需的最小依赖面”。下表之外的跨包改动默认拒绝；新增项必须先在计划中写明 KB 消费方、不能留在 KB 内的原因和回滚影响。

| 位置 | 允许保留的最小改动 | 必要性与边界 |
| --- | --- | --- |
| `apps/ai-center` | HTTP listen 后后台启动已有 outbox relay；普通 API key 绑定已登记 tenant；移除已失效的 root-container worker 启动代码；把 `CUBE_SERVER_IDLE_TIMEOUT_MS` 的有效值接入共享 `Application.idleTimeout` 并记录启动值 | KB 持久任务需要宿主投递，但 Redis leader election 不得阻塞 HTTP bootstrap；tenant 隔离必须在进入 KB 前建立 verified context。idle timeout 是同步 preview/upload/reindex 的宿主必要接线，属于全局连接资源权衡，不得扩展为 Flow 行为重构；`BUILTIN_SYSTEM_API_KEY` 本轮不动 |
| `packages/contracts` | KB queue 名、outbox payload、`KnowledgeHit` 的可选 chunk/page/section 字段 | 跨领域 wire schema 的唯一合法位置；保持 additive/optional 兼容 |
| `infra/vector-qdrant` | point retrieve 与 payload index 能力 | generation 向量复用和 tenant/metadata 过滤索引需要 adapter 支持；KB 不直连 vendor client 绕过 adapter |
| `infra/bun-server-ext/outbox` | 从已校验 payload 读取单任务 `maxAttempts`；Redis URL 兼容宿主 `REDIS_URL` | KB retry 配置需传递至既有 BullMQ dispatcher；relay/dispatcher 是 KB 持久任务的直接投递链路，不能错误回退 localhost。不得修改 leader election 算法 |
| `packages/llm/core` | DashScope rerank catalog/adapter；豆包 embedding batching/retry 的 vendor 行为 | vendor 凭据和 HTTP 协议按 ADR-0003 只能留在 llm-core；KB 只消费 contracts port，不感知供应商 DTO |
| `packages/agent/engine` | `KnowledgeHit` additive 字段的 consumer 回归测试 | 仅验证共享契约消费兼容，不改变 Agent 运行逻辑 |
| 根 `bun.lock` | KB 新增 catalog `bullmq` 后的机械锁文件更新 | 依赖落地必需，不承载额外版本升级 |

最终决定（覆盖 2026-08-10 的撤回记录）：当前产品路径已恢复为同步 preview/upload/reindex，因此保留 `ai-center` 的 server `idleTimeout` 接线。只允许传递已存在的 `CUBE_SERVER_IDLE_TIMEOUT_MS`、校验 Bun 上限并记录最终值；不得借此修改 Flow 路由、默认业务超时或连接管理算法。长期应以解析缓存、singleflight 或经门阀验证的异步能力缩短占用，而不是无限扩大 timeout。

## 4. 可扩展性护栏（防过度设计）

1. **不为「可能有一天」留接口** — 只对 W 文档已写明的演进方向留 seam（多协议 rerank、多路召回、per-KB 配置、fingerprint 版本位等）
2. **扩展点必须有消费者或测试** 才进门阀；否则从文档移除
3. **优先复用仓库惯例**，禁止为本 epic 另起框架级 plugin 系统

## 5. 各 Wave 扩展点契约（摘要）

详细说明写在各 `W*.md`「设计约束 / 扩展点」节；摘要：

| 文档 | 必须保留的 seam |
| --- | --- |
| W1.1 | `LEXICAL_FIELD_WEIGHTS` / `buildLexicalPreScoreSql` 与 JS 精算共用，便于 W3.4 FULLTEXT 替换 SQL 体 |
| W1.2 | `textChunkMode`（auto/block）为唯一二次切开关，不散落 if |
| W1.3 | 结构化 chunk 锚点；详情查询 tenant-scoped；无真实 consumer 不生成假 link |
| W1.4 | `eval/metrics` 与 RetrievalService 解耦；cases schema 可版本升级 |
| W2.1 | kb-core / contracts **不感知** vendor HTTP 类型（DashScope/Jina）；新协议只加 provider |
| W2.2 | `modelRerankOnce` 独立可测；流水线显式阶段：recall → merge → rerank → truncate |
| W3.1 | 双写编排与 store 适配分离；generation 防同 ID 陈旧写，reconcile 覆盖 ID/deletion；内容与向量完整性另有 E2 门阀 |
| W3.2 | embed 批处理按画像分组；与 vendor HTTP 细节隔离在 llm-core |
| W3.3 | 复用既有 outbox/队列惯例，不自造第二套 job 框架 |
| W3.4 | 归一化与 SQL 体可替换；权重常量仍来自 W1.1 |
| W3.5 | embedding fingerprint 与 payload generation 分离；前者含 **algoVersion**；parse 短路另需 parser/config fingerprint |
| W4.1 | `resolveAllowedGroupIds(identity)` seam；换身份源不改检索过滤 SQL/Qdrant |
| W4.2 | 当前默认关闭；重新启用前 feedback 写入/查询/metrics 权限与 trace exposure 分离 |
| W4.3 | 对话改写归 Agent；KB 只做确定性 normalization，不重复调用 LLM rewrite/contextual prefix |

## 6. 文档写法

每份**非暂缓** `W*.md` 必须包含：

1. 「设计约束 / 扩展点」小节（可放在设计节末）
2. 门阀表中至少一行：设计约束核对（引用本文 §2）和/或本波扩展点硬性项（`Wx-Hx`）
