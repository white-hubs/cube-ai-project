# KB / RAG 当前状态与续接说明

> 更新时间：2026-08-11
> 用途：后续开发开始前的单一续接入口。本文记录当前有效决策、已知代码事实和未决问题；历史决策变化见 [PLAN-REVIEW-CHANGELOG.md](./PLAN-REVIEW-CHANGELOG.md)，交付状态仍以 [DELIVERY-MATRIX.md](./DELIVERY-MATRIX.md) 为唯一权威。

## 1. 当前证据边界

- 本轮候选实现已完成；是否已提交、推送、合并或上线必须以 Git 和部署记录为准，不得仅凭“代码存在”推断交付状态。
- 2026-08-11 本地门禁记录：`bun run typecheck` 通过；`bun test` 在允许监听本地临时端口的环境中为 3218 pass、234 skip、0 fail。skip 均为显式环境门控用例，真实依赖矩阵仍需单独执行。
- 真实 MySQL/Qdrant 故障注入和真实模型 E3 未完成，尚未证明检索质量达到 80，也未证明生产可默认开启。
- 后续开始修改前必须先执行 `git status --short`、核对本文件和 DELIVERY-MATRIX，并保存新的 before 基线；不得仅凭历史聊天恢复状态。

## 2. 当前有效决策

| 主题 | 当前有效决定 | 被取代的旧决定 |
| --- | --- | --- |
| upload/reindex | `INGESTION_ASYNC_ENABLED=false` 为默认；请求内同步完成 parse/embed/index | 默认异步快速返回 job/status |
| preview | 已有 active chunks 直接返回；普通无 chunks 文档同步从对象存储执行只读 parser/chunker 并返回；不 embed、不写库、不入队 | 快速 `200 + items=[]`；processing+轮询 |
| 异步摄入 | outbox/BullMQ、恢复和失败终态代码保留，仅显式 opt-in；管理端和人工重放延期至 W4.6 | 当前产品默认启用异步 |
| HTTP idle timeout | 保留 ai-center `CUBE_SERVER_IDLE_TIMEOUT_MS` 到 `Application.idleTimeout` 的接线和有效值日志，用于同步 preview/upload/reindex 的长等待；它是全局连接资源权衡，不是处理提速 | 因“摄入已异步”而撤回接线 |
| rerank provider | DashScope `qwen3-rerank`；catalog 保存完整工作空间 endpoint，adapter 不追加或推断后缀 | Jina；全局 DashScope URL；自动追加 `/reranks` |
| rerank model tenant | 与 embedding 一致，固定使用 `KB_EMBEDDING_TENANT`（默认 1）解析模型 catalog；请求 tenant 只用于 KB 数据隔离 | 使用请求上下文 tenant 解析模型凭据 |
| rerank 开关 | `RETRIEVAL_MODEL_RERANK_ENABLED` 默认 false；目标环境可显式开启实验 | 将 HTTP 200 视为可以默认启用 |
| rerank instruct | 当前不发送 `instruct`。阿里云文档说明省略时默认问答检索；不重复发送同一默认值。只有产品明确改变排序任务且经过 E3 时才配置不同指令 | 把“显式传默认 instruct”当作当前误排的修复 |
| rerank 质量选择 | 独立模型阈值已实现；去重/section/MMR/exact reserve 由 `RETRIEVAL_DIVERSIFICATION_ENABLED` 控制且默认 false | 仅靠单个模型分或固定返回满 topK 判断质量 |
| ACL | 空 ACL = tenant visible；非空 ACL 是 fail-closed 扩展；普通 API key 不允许通过 tenant header 切换租户 | 空 ACL 语义未决；header-shape authentication |
| query rewrite | KB 不做 LLM query rewrite/contextual prefix；由 Agent 负责改写，KB 接收可检索 query | KB 与 Agent 重复调用改写模型 |
| Flow key | `BUILTIN_SYSTEM_API_KEY` 本轮不改，作为接受的遗留风险等待 Flow 重构 | 在 KB 改造中顺手修改 |

## 3. 当前实现主线

1. **摄入与一致性**：versioned chunk generation、active-generation CAS、MySQL/Qdrant reconcile、增量 embedding fingerprint；异步启用时 document/import job/outbox 使用 KB mysql2 同一连接事务。
2. **解析与预览**：Docling primary 与 fallback 决策在 ingest/preview 间复用；by-id 无 chunks 时同步只读拆分。
3. **检索召回**：dense+sparse Qdrant RRF 与 MySQL lexical 召回合并；响应字段 `vectorScore` 实际承载 Qdrant 返回的 RRF 召回分，不是纯余弦相似度。
4. **模型重排**：候选结构化为 file/section/headers/keywords/content；provider 将阿里云 `relevance_score` 按原始 index 映射；当前非同分候选的最终顺序由模型分决定，原召回分只在模型分完全相等时参与 tie-break。
5. **质量选择**：模型分独立阈值、exact reserve、内容去重、section 配额、MMR、动态 TopK；除独立模型阈值外，多样化能力默认关闭。
6. **租户与 ACL**：模型 catalog tenant 和业务数据 tenant 分离；MySQL/Qdrant 两腿按业务 tenant/ACL 过滤。
7. **宿主缝合**：outbox relay 在 HTTP listen 后后台启动；Redis URL 解析与宿主兼容；server idle timeout 显式接线。

## 4. 当前未解决问题

### RQ-01：问答重排把“主题提及”排在“直接答案”之前

固定回归样例：

```json
{"query":"证实方法有哪些？","documents":[{"documentId":"2086630204986372098","topK":5}]}
```

观测事实：

- `chunk-5`（“1 范围”，只声明文档包括证实方法）得到 `0.862109` 并排第一。
- `chunk-25`（“8 证实方法”，列举 8.1/8.2/8.3）得到 `0.854213` 并排第二。
- 差值为 `0.007896`。这证明 HTTP 200、单条分数超过 0.8 都不能保证 Top1 正确。
- 当前代码已把 section 和 content 发送给模型；不能归因于标题漏传。
- 阿里云默认已经是问答检索；不能把“没有显式发送默认 instruct”当作已证实根因。

当前判断：这是模型近似分误排被“模型分覆盖最终顺序”放大的系统问题。通用修复不得写死 query、章节名、documentId 或 chunkId；候选方案必须通过冻结标注集比较，例如校准后的多信号融合/近似并列策略、答案完整性特征和切块完整性修复。具体权重或分差阈值在 E3 前保持 TBD，禁止拍脑袋写死。

最低回归门阀：`chunk-25` 必须排在 `chunk-5` 之前，并同时验证标题/标准号查询、无答案和其他文档不退化。

### OP-01：`/kb/search/by-documents` 偶发通用连接错误返回 500

观测日志：trace `fc58555ab50346bfb5e4cc7cf49db368`，错误文本 `Unable to connect. Is the computer able to access the url?`，最终为 `INTERNAL_UNKNOWN` 500。

已核实：

- 该错误发生前的文档审阅没有修改代码。
- 事后检查时，配置的 Qdrant TCP 和 `/readyz` 正常；默认 embedding 主机可完成 TLS/HTTP 并返回未认证状态。这只能证明检查时可达，不能排除事发时瞬时故障。
- rerank provider 失败按设计会 fallback，单独的 rerank 连接失败不应直接产生该 500。
- KB `extractNetworkError` 只识别常见 errno/message；Bun 的通用连接消息或嵌套 `cause` 未被识别时会原样抛出，因而丢失 `step` 并落成 `INTERNAL_UNKNOWN`。

未核实：具体失败的是 platform sync、embedding、Qdrant 还是同一 `vector-search` 包装内的其他调用。没有带相同认证上下文的成功复现和分阶段日志前，禁止写成某个依赖的确定故障。

后续诊断要求：保留 traceId，在不记录 query、文档正文、API Key 和完整连接串的前提下记录 `step/provider/endpointHost/error.cause.code`；Bun 通用网络错误应映射为带 step 的 503，但是否重试/降级必须按依赖语义分别决定。

## 5. 续接协议

后续任何代码改动必须：

1. 先读本文、DELIVERY-MATRIX、对应 W 文档和 changelog 的最新覆盖项。
2. 将待修问题写入对应 W 文档，明确事实、推测、方案、反例、测试和门阀，再改代码。
3. 对照当前未提交 diff，避免覆盖用户已有修改；不得把工作区全部变更视为同一提交。
4. 修改后更新本文的有效决策/未解决问题，并在 DELIVERY-MATRIX 回填 commit/CI/E2/E3 证据。
5. 文档和日志只保留脱敏 endpoint host；禁止记录 `.env` 中的完整 URL 凭据、token 或用户原文。
