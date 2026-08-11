# KB / RAG 迁移、灰度与回滚计划

> 本文把“代码可以合并”和“能力可以开启”分开。任何涉及 schema、索引、存量回填、ACL 或外部模型的工作，都必须有独立 rollout 记录。

## 1. 上线前事实盘点

每个目标环境必须记录：

- MySQL/Qdrant 版本、部署形态、可用容量和备份恢复方式。
- document/chunk/point 数量、按租户分布、最大文档、日增量。
- 当前 p50/p95/p99 检索与摄入延迟、错误率、队列积压。
- 需要回填的文档数、预计新增索引/向量/payload 空间。
- 模型限额、区域、调用单价口径和凭据 owner。

未完成盘点时，迁移耗时、成本和容量只能标记为推测，不得给出确定上线日期。

## 2. 外部系统已核实约束

### MySQL FULLTEXT

- MySQL 官方文档确认 ngram parser 面向 CJK，`ngram_token_size` 是服务端只读启动配置，migration 不能临时修改：[ngram Full-Text Parser](https://dev.mysql.com/doc/refman/8.0/en/fulltext-search-ngram.html)。
- 官方 Online DDL 表说明：已有表首次增加 FULLTEXT 且缺少用户定义 `FTS_DOC_ID` 时会重建表，不能仅凭 `ALGORITHM=INPLACE` 假设无容量或锁风险：[Online DDL Operations](https://dev.mysql.com/doc/refman/8.0/en/innodb-online-ddl-operations.html)。

因此 W3.4 上线前必须在生产等规模副本测量 DDL 时间、临时空间、并发 DML 影响和回滚时间。

### Qdrant payload index

- Qdrant 官方建议为过滤字段创建 payload index，且在写入数据前创建更利于 filter-aware HNSW；后补索引可能需要重建相关图结构：[Indexing](https://qdrant.tech/documentation/manage-data/indexing/)。
- Qdrant Cloud strict mode 默认可能拒绝非索引字段过滤；OSS 虽可能允许，但仍有性能风险：[Qdrant Overview](https://qdrant.tech/documentation/overview/)。

因此 W4.1 在发送 ACL/metadata filter 前，必须先创建并验证 tenantId、documentId、aclGroupIds 及实际启用 metadata 字段的 payload index。

### DashScope rerank

- 阿里云官方文档确认 `qwen3-rerank` 支持 OpenAI-compatible `/reranks`；当前列出的上限为 500 documents、单项 4,000 tokens、单请求 120,000 tokens：[Reranking API](https://help.aliyun.com/en/model-studio/rerank)。

这些是 vendor 当前限制，不是项目默认值；provider 必须把响应错误、截断和限流作为运行时事实记录，计划不得假设固定 50 个候选天然安全或最优。

## 3. 标准 rollout 阶段

| 阶段 | 动作 | 出口条件 |
| --- | --- | --- |
| R0 盘点 | 记录 §1、owner、窗口和停止条件 | 无 TBD 的安全/容量阻断项 |
| R1 兼容部署 | 先部署可读旧/新 schema 的代码，flag off | 回滚到旧代码仍兼容 |
| R2 建索引/回填 | 限速、分页、可续跑；记录 cursor/version | 无持续错误，容量余量满足预算 |
| R3 shadow | 新旧路径同时计算但只返回旧结果 | 逐 query 差异、延迟和成本可解释 |
| R4 canary | 选定租户/流量百分比；自动停止条件生效 | E3 门阀满足 |
| R5 扩量 | 分阶段扩大，阶段间保留观察窗口 | 无安全/一致性事件 |
| R6 默认开启 | owner 签字，保留 kill-switch | 完整证据包归档 |
| R7 清理 | 兼容期结束后删旧配置/旧路径 | 已验证无法回滚需求 |

流量比例和观察时长由环境容量与 EVAL-03 决策确定；不得在文档中凭经验硬编码一个看似精确但无依据的数字。

## 4. 回填协议

- 以 `(tenantId, documentId, expectedVersion)` 为幂等键。
- 按稳定 cursor 分页，保存已完成 cursor 和失败明细；进程重启可续跑。
- 支持 pause/resume、每租户限速和全局并发上限。
- ACL 收紧优先于普通 metadata；遵守 `CONSISTENCY-AND-SECURITY-INVARIANTS.md` 的 fail-closed 协议。
- 完成条件不是“job 扫完”，而是 reconcile/E2 证明 ID、embedding **version**、payload version 和 deletion 收敛。若验收目标包含实际向量字节完整性，还必须比较 vector checksum 或抽样重新 embed；输入 fingerprint 本身不能提供该证明。
- 回填前后保存 point/chunk 数、版本分布、孤儿数和抽样检索结果。

## 5. 回滚分层

| 层 | 回滚方式 | 必须预先证明 |
| --- | --- | --- |
| 配置 | 关闭 feature flag | 旧路径仍可读新 schema |
| 应用 | 回滚到上一镜像 | migration 为向后兼容 additive change |
| 数据 | 停止回填并按版本恢复/重放 | 有备份或可重建来源 |
| MySQL 索引 | 评估后 DROP INDEX | 不影响旧查询，记录 DDL 时间 |
| Qdrant payload index | 通常先保留而非紧急删除 | 删除不会造成 strict-mode 查询失败 |
| ACL | 安全事件时优先扩大拒绝面 | 不以“恢复可用性”为由 fail-open |

删除列、删除旧 payload、清理兼容 env 属 R7，不与首次启用放在同一发布。

## 6. 监控与自动停止

至少监控：

- 检索 p50/p95/p99、错误率、空结果率、降级率。
- Qdrant filter error、timeout、未索引字段错误。
- MySQL 慢查询、锁等待、DDL 进度和临时空间。
- W3.3 异步显式开启时：job queue depth、oldest age、处理耗时和租户占用；retry/dead-letter 人工处置指标随 W4.6 管理端补齐。默认同步模式必须监控 HTTP/Docling/embed/index 延迟和上游超时。
- inconsistent document 数、ACL updating 时长、孤儿 point 数。
- rerank/rewrite/embed 调用量、token、费用估算和限流。

安全泄漏、不可恢复分叉为零容忍停止条件；其余阈值必须在 DELIVERY-MATRIX 中由 owner 回填。

## 7. 每次启用的证据包

- PR/commit/CI 链接与配置 diff。
- migration dry-run 和回滚演练记录。
- before/after E2、E3 报告。
- 容量、延迟、错误率、成本表。
- canary 租户选择依据和观察窗口。
- 事件负责人、回滚负责人、批准人。
