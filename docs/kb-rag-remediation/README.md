# KB / RAG 审查修复 — 落地计划索引

> 本目录是计划与验收基线，不以文件中的代码锚点、checkbox 或“merged”字样证明实现完成。唯一交付状态源见 [DELIVERY-MATRIX.md](./DELIVERY-MATRIX.md)。

## 1. 先读这六份跨波次文档

| 文档 | 回答的问题 |
| --- | --- |
| [CURRENT-STATE.md](./CURRENT-STATE.md) | 当前哪项决定有效、最近发现了什么、从哪里继续 |
| [00-overview.md](./00-overview.md) | 为什么做、依赖顺序和交付轨道是什么 |
| [EVALUATION-STRATEGY.md](./EVALUATION-STRATEGY.md) | 什么证据足以证明不退化或有收益 |
| [CONSISTENCY-AND-SECURITY-INVARIANTS.md](./CONSISTENCY-AND-SECURITY-INVARIANTS.md) | 什么叫双写一致、什么叫已授权 |
| [ROLLOUT-AND-MIGRATION.md](./ROLLOUT-AND-MIGRATION.md) | 如何迁移、灰度、停止和回滚 |
| [DELIVERY-MATRIX.md](./DELIVERY-MATRIX.md) | 谁负责、当前有什么证据、还缺什么 |

配套规则：

- [GATE-CRITERIA.md](./GATE-CRITERIA.md)：代码合并门阀与能力启用门阀。
- [CODE-CONVENTIONS.md](./CODE-CONVENTIONS.md)：ADR、contracts、分层、配置与扩展约束。
- [PLAN-REVIEW-CHANGELOG.md](./PLAN-REVIEW-CHANGELOG.md)：计划修订历史。

推荐续接顺序：`CURRENT-STATE → DELIVERY-MATRIX → 对应 W 文档 → CHANGELOG 最新覆盖项 → 代码与测试`。CHANGELOG 保留历史摇摆，不表达当前有效状态；遇到冲突时先修正文档，不能自行挑选有利版本。

## 2. 状态语义

必须区分：

| 状态 | 含义 |
| --- | --- |
| `planned` | 范围与门阀已定义，不代表存在实现 |
| `code_complete` | 有 PR/commit 和全局 CI 证据 |
| `data_verified` | 真实 MySQL/Qdrant 数据面验证通过 |
| `live_verified` | 目标环境 canary 证明收益、成本与风险可接受 |
| `blocked/deferred` | 有明确阻断决策或暂缓准入条件 |

状态只能在 DELIVERY-MATRIX 回填。默认 off 只能说明尚未影响默认路径，不能证明实现正确或值得开启。

## 3. 工作项地图

| 文档 | 报告编号 | 轨道 | 计划状态/关键前置 |
| --- | --- | --- | --- |
| [W1.4](./W1.4-golden-eval-gate.md) | F-02 | 评测 | 首要前置；先登记 before 基线 |
| [W1.1](./W1.1-lexical-score-ordering.md) | F-03 | 正确性 | W1.4 E1 before |
| [W1.2](./W1.2-docling-preserve-semantic-chunks.md) | F-12 | 摄入质量 | W1.4 E1 before + 存量迁移计划 |
| [W1.3](./W1.3-citation-links.md) | F-04 | 可解释性 | 结构化 chunk 锚点；tenant-scoped 详情接口 |
| [W3.1](./W3.1-dual-write-consistency.md) | F-06 | 数据安全 | versioned generation 构建/校验/原子切换 |
| [W4.1](./W4.1-metadata-acl-filter.md) | F-05/F-10 | 访问安全 | W3.1、普通 API key tenant 绑定、payload index |
| [W4.2](./W4.2-feedback-observability.md) | F-08 | 用户反馈暂缓；操作观测保留 | 无产品入口/owner，默认关闭 |
| [W3.2](./W3.2-embedding-batch-retry.md) | F-07 | 摄入性能 | 先核实 provider capability |
| [W3.3](./W3.3-async-ingestion.md) | F-16 | 摄入可靠性 | W3.1、既有 outbox+BullMQ、运维指标 |
| [W3.5](./W3.5-incremental-reembed.md) | R-07 | 成本/一致性 | W3.1；embedding fingerprint + payload generation；parse 短路需 config fingerprint |
| [W2.1](./W2.1-jina-rerank-provider.md) | F-01 | 质量增强 | vendor 限额/费用/决策 owner |
| [W2.2](./W2.2-retrieval-model-rerank.md) | F-01/F-11 | 质量增强 | W1.4、W2.1、候选预算公平性 |
| [W2.3](./W2.3-rerank-quality-selection.md) | F-01/F-11 | 质量控制 | W2.2；独立阈值、去重、section 配额、MMR、动态 TopK 与 nDCG@5 门阀 |
| [W3.4](./W3.4-lexical-fulltext-upgrade.md) | F-03 性能 | 性能增强 | W1.1、W1.4、DDL dry-run |
| [W4.3](./W4.3-query-rewrite-contextual.md) | F-09/F-13 | 能力边界修复 | query rewrite 归 Agent；KB 移除重复 LLM 能力 |
| [W4.4](./W4.4-multimodal-picture-deferred.md) | F-14 | 暂缓 | picture dataset + ROI 准入 |
| [W4.5](./W4.5-per-kb-retrieval-config-deferred.md) | F-17 | 暂缓 | 全局参数稳定 + 产品配置面准入 |
| [W4.6](./W4.6-ingestion-failure-operations-deferred.md) | W3.3 后续 | 暂缓 | 独立失败任务管理端 + owner + 权限/留存决策 |

## 4. 推荐执行顺序

不是把所有工作串行化，而是分成三条有门阀的轨道：

1. **评测轨**：W1.4 有效 before 基线 → W1.1/W1.2 → E1/E2；质量实验记录 operational exposure/version，不依赖延期的用户 feedback API。
2. **安全与数据轨**：W3.1 → W4.1；W3.2 → W3.3 → W3.5。安全隔离不等待 rerank。
3. **质量实验轨**：W2.1 → W2.2 → W2.3；W3.4。W4.3 是删除 KB 重复 LLM 能力的边界修复，不作为新质量实验。

任何涉及 schema、索引、存量数据和 ACL 的工作，同时受 ROLLOUT-AND-MIGRATION 约束。

## 5. 已冻结决策与遗留风险

- EVAL-01..04：live 数据、主指标、非劣界、延迟/成本预算。
- SEC-01 已决策：空 ACL = tenant visible，ACL 扩展非破坏性保留。
- SEC-02 延期：feedback 产品入口、submit/list/metrics 权限和数据留存。
- CON-01 已选：staging generation 双腿校验后原子切 active generation。
- QUEUE-01 已选：现有 MySQL outbox + relay + BullMQ，消息 `kb.ingest.v1`。
- QUEUE-OPS-01 延期：失败任务查询/人工重放管理端进入 W4.6；W3.3 异步实现保留自动重试和持久失败终态，但 `INGESTION_ASYNC_ENABLED` 默认 false，当前产品路径同步。
- FLOW-AUTH-01 接受遗留风险：`BUILTIN_SYSTEM_API_KEY` 本轮不改，待 Flow 重构。

## 6. 工作量边界

修订前 W 文档显式开发估算机械相加为 31～51.5 人日，另加 reindex；该数不含数据标注、DBA/向量平台窗口、身份联调、灰度观察、安全评审和值班。详见 DELIVERY-MATRIX，排期前由 owner 分项重估。
