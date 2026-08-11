# KB / RAG 一致性与安全不变量

> 本文定义数据何时才算“一致”、请求何时才算“已授权”。只比较 point ID、只检查请求头存在、或者等待最终重试，都不足以证明安全与一致性。

## 1. 权威源与版本

MySQL 是文档、chunk、ACL、metadata 和期望向量状态的权威源。当前实现用不可变 `generation_id` 同时界定一组 chunk/payload 的可见版本，并用以下标识决定向量是否可复用：

- `embedding_fingerprint`：由规范化 `embeddingText`、modelCode、instructionProfile、algoVersion 计算。
- `generation_id`：metadata/ACL 或任一 chunk 变化时创建新 generation 和新 point ID，避免原地覆盖造成同 ID 陈旧 payload。

如未来增加原地 payload 更新、外部数据导入或遗留数据严格审计，必须再引入独立 `payload_fingerprint/version`，由 tenantId、documentId、ACL、docType、lang、tags、createdAt 等可过滤字段计算。不得用 embedding fingerprint 代替 payload 版本；文本未变不代表 ACL/metadata 未变。

`embedding_fingerprint` 是“应使用哪种 embedding”的版本凭证，不是实际向量字节 checksum。它能发现旧模型/旧文本版本，不能证明同版本向量没有损坏；后者需要 vector checksum 或重新 embed 比对。

## 2. 一致性判定

正常写路径把文档标记为 `indexed` 前至少满足：

1. MySQL 活跃 chunk ID 集合与 Qdrant point ID 集合一致。
2. point 使用 active `generation_id` 的不可变 ID，并由同一次 staging 写入期望 payload；检索候选再经 MySQL active generation 校验。
3. 新 generation 的 MySQL chunk 数与 Qdrant point 数等于期望数；metadata/ACL 与 active generation 在同一 tenant-scoped CAS 中提交。
4. 已删除文档在 Qdrant 无残留 point。
5. 当前状态不存在未完成的安全收紧操作。

当前 per-document reconcile 分页扫描 ID 和 deletion，可修复缺失/孤儿 point；它是故障补偿，不是任意内容损坏证明。上线严格审计还必须用 E2 校验 embedding version、payload version；若要覆盖同版本向量位损坏，再增加 vector checksum/重嵌抽样。仅做集合差不得宣称“任意损坏下完全一致”。

## 3. ACL 状态模型

当前计划只支持租户内两种文档可见性：

| 状态 | 语义 |
| --- | --- |
| `tenant_visible` | 同租户已认证主体可见 |
| `group_restricted` | 仅与服务端解析出的 group claims 有交集时可见 |

SEC-01 已于 2026-08-10 决策：`NULL`/空 ACL 映射为 `tenant_visible`，因为当前产品语义就是租户内所有已认证用户可见。已有 ACL 列与测试数据非破坏性保留；组 ACL 是未来扩展，不引入额外 visibility enum。

## 4. 身份不变量

- tenant、subject、groups 必须来自已验证 principal 或受信内部 port context。
- 原始 `Authorization`/`x-api-key`/tenant headers 的“形状”不能作为认证或租户授权证据。
- 客户端不得提交 `allowedGroupIds`、`aclGroupIds` 或等价字段来扩大权限。
- 普通已登记 API key 的租户范围必须由 key 记录决定；请求头只能匹配/缩小范围，不能切换到其他租户。
- 例外：Flow knowledge-retrieval 当前使用 `BUILTIN_SYSTEM_API_KEY` + 动态租户 header 跨租户回调。用户决定本轮不改，待 Flow 重构处理。该例外不得扩散到普通 API key，也不得被报告为已修复；Key 泄露可造成跨租户 KB 读取。
- feedback 写入、本人/trace 查询、租户聚合 metrics 是不同权限，不得只用一个 `authenticated` 布尔值概括。

## 5. ACL/metadata 更新协议

### 5.1 收紧权限

安全优先，必须 fail-closed：

当前采用 versioned generation 协议，而不是先原地覆盖文档 ACL：

1. 旧 generation 保持 active；以新 ACL/metadata 写入完整的新 MySQL chunk generation 和 Qdrant payload。文本未变时复用旧向量，embed=0。
2. 校验新 generation 的 MySQL/Qdrant 数量；检索对 Qdrant 候选再以 MySQL active generation 校验。
3. 在一个 tenant-scoped、expected-generation CAS SQL 中同时切换 `active_generation_id` 和 document ACL/metadata。
4. 切换后异步清理旧 generation；清理失败不得删除新 active generation，并进入 reconcile。

不得出现“MySQL 已收紧、Qdrant 仍按旧 ACL 返回”的可见窗口。

### 5.2 放宽权限

允许在传播完成前继续使用旧的更严格 ACL；不得为了可用性先扩大一条腿。

### 5.3 非安全 metadata

可以最终一致，但必须暴露版本落后和队列积压指标；是否在不一致时继续检索由字段风险分类决定。

## 6. 双写失败矩阵

| 场景 | 对外状态 | 补偿 |
| --- | --- | --- |
| MySQL 失败 | 不改变可见状态 | 整次失败，不写 Qdrant |
| MySQL 成功、Qdrant 失败 | `indexing/failed`；安全收紧时不可见 | 持久化 reconcile job |
| Qdrant 成功、状态提交失败 | 不宣称 indexed | reconcile 读取 MySQL 期望版本重放 |
| 删除 MySQL 成功、Qdrant 失败 | MySQL 检索腿立即不可见 | reconcile 删除残留 point |
| metadata/ACL 新 generation 失败 | 旧 generation 保持 active；收紧操作不得被报告为已生效 | 重试完整 generation；不要原地 payload-only 覆盖 |

所有动作必须幂等；job 至少携带 tenantId、documentId、operation、expectedVersion、attempt 和 idempotencyKey。

## 7. 异步任务不变量

- 持久化后才向客户端返回“已入队”。
- async upload/reindex 的 document、`import_job` 与 `outbox_events` 必须由同一个 KB mysql2 `PoolConnection` commit/rollback；只包裹回调、但 repository 仍走连接池其他连接，不算事务。
- KB 当前数据库 adapter 不得直接混用框架 `TransactionManager`/`@Transactional()`。事务能力由 `DATABASE_SERVICE_TOKEN` 指向的 KB adapter 提供，并以真实模块解析测试和 connection-level commit/rollback 测试作为证据。
- 领取使用原子 claim + lease；进程退出后 lease 可恢复。
- 交付语义按 at-least-once 设计，handler 必须幂等。
- W3.3 当前 retry 使用有上限的指数退避并写持久失败终态；jitter、业务 DLQ 查询/重放 API 按产品优先级后置至 [W4.6](./W4.6-ingestion-failure-operations-deferred.md)。不能把 BullMQ failed job 本身等同于完整运维入口，也不能把后置项误报为已完成。
- 恢复扫描必须分页，不能只处理固定首批记录。
- worker 创建与 HTTP bootstrap 不得同步等待全量恢复扫描；恢复在后台运行并记录 begin/complete/fail。启动成功只表示服务可监听，不表示 backlog 已清空，readiness/告警必须区分二者。
- 多副本不得因无租约扫描而无限重复同一任务；当前 BullMQ claim 可避免同一 job 同时执行，但租户并发 semaphore 只在单进程内生效。
- 当前请求等待优化至少观测队列深度、最老任务年龄和每租户占用；重试率、死信数及人工处置闭环由 W4.6 承接。

本轮后端已选定为现有 MySQL outbox + relay + BullMQ，沿用 `kb.ingest.v1`。进程内 queue 只用于单测。KB Redis URL 契约为 `AGENTIC_ENGINE_REDIS_URL > REDIS_URL > BUN_REDIS_URL > localhost`；ingest/reconcile worker 必须共用解析器，禁止各自复制一套 env 规则。`outbox_events.tenant` 当前为数值列，scheduler 对非数字 tenant fail-fast；支持字符串/UUID tenant 前必须先迁移共享 outbox schema。

## 8. 必测故障

- 同 ID、旧 embedding version（遗留/故障注入路径）。
- 同 ID、旧 ACL payload version（遗留/故障注入路径）。
- 同 fingerprint、向量字节被修改（仅在引入 vector checksum/重嵌审计后可判定）。
- ACL 收紧时 Qdrant 更新失败。
- 文档删除后残留 point。
- worker 在 claim 后、完成前崩溃。
- 两个 worker 同时竞争同一 job。
- 恢复记录超过单次 page size。
- 仅配置 `REDIS_URL` 时 worker 不得错误连接 localhost；恢复查询永久 pending 时 HTTP bootstrap 仍可完成。
- 宿主模块解析 `DocumentService` 时缺少事务 provider；outbox insert 失败时 document/import job 未 rollback。
- 合法 API key 携带其他租户 header。

这些用例必须经过 E2 数据面集成，不能只对自造 JSON 或 in-memory repository 断言。

## 9. 待决策项

| ID | 决策 | 阻断范围 |
| --- | --- | --- |
| SEC-01 | **已决策**：空 ACL = tenant visible；ACL 列/测试数据非破坏性保留 | 已解除 W4.1 产品阻断 |
| SEC-02 | **延期**：产品 feedback 入口、角色与留存 owner 未确认 | W4.2 保持关闭 |
| CON-01 | **已决策**：staging generation 双腿构建校验后原子切 active generation | W3.1 实现与 E2 |
| QUEUE-01 | **已决策**：现有 MySQL outbox + relay + BullMQ，`kb.ingest.v1` | W3.3 实现与 E2 |
| FLOW-AUTH-01 | **接受遗留风险**：`BUILTIN_SYSTEM_API_KEY` 本轮不改 | Flow 重构 |
