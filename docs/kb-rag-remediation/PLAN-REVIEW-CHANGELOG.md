# 计划复核修订记录

来源复核报告：`.tmp/reports/kb-rag-plan-review__20260807-151001-0a360d/report.html`（易失；结论已吸收进各 W*.md）。

| 编号 | 处理 |
| --- | --- |
| G-01 | **已改** W1.1：SQL 预评分 ORDER BY 升为必须；统一 `lexicalCandidateLimit` |
| G-02 | **已改** W2.2 §3.1：三条路径合并后统一 rerank 一次；multi-doc 重构要点 |
| G-03 | **已改** W4.1：MySQL 词法腿 ACL + 验收用例 |
| G-04 | **已改** W3.1：覆盖 updateDocumentChunk / deleteDocument |
| G-05 | **已改** W3.2：document/query 分组批 + `data[i]` 映射 |
| G-06 | **已改** 新增 W4.4 / W4.5 暂缓说明；overview 映射修正 |
| G-07 | **已改** 新增 W3.5 增量 re-embed |
| G-08 | **已改** W1.3：引擎已渲染 link；补 kb:// 消费约定 |
| G-08A | **再次修正** W1.3：仓库无 `kb://` consumer，不再生成假链接；改为结构化 chunk 锚点 + tenant-scoped 详情接口 |
| D-20260810 | **产品裁决冻结**：空 ACL=tenant visible；query rewrite 归 Agent；移除 LLM contextual prefix；feedback 默认关闭；outbox+BullMQ；versioned generation；预览 processing+轮询；`BUILTIN_SYSTEM_API_KEY` 延期至 Flow 重构 |
| G-09 | **已改** W1.4：fixture/live 门禁规则 + 目录层级 |
| G-10 | **已改** W1.2 锚点 :132 / :136 |
| G-11 | **已改** README/overview：W0「已完成·未提交」；来源路径说明 |
| G-12 | **已改** W3.4 归一化/字段映射/V002；W2.2 env 兼容期 |

复核后状态：计划文档可进入 Sprint 排期（实现前仍建议重核锚点行号）。

## 后续增补

| 日期 | 项 |
| --- | --- |
| 2026-08-07 | 新增 [GATE-CRITERIA.md](./GATE-CRITERIA.md)：全局/各 Wave/Sprint 出口硬性门禁；各非暂缓 `W*.md` 增加「门阀验收（硬性）」节 |
| 2026-08-07 | **第三轮复核**（`.tmp/reports/kb-rag-plan-review-3__20260807-152207-410487/`）：门阀体系达标；吸收 N-01…N-05 → 新增 [CODE-CONVENTIONS.md](./CODE-CONVENTIONS.md)；G0 修订为全 workspace typecheck/test + G0-7…G0-11；豁免收紧（G0-3/G0-8 不可豁免）；各非暂缓 W 补「设计约束/扩展点」与门阀 HD/扩展行 |
| 2026-08-07 | 精修：C-ADR-0005 改回 ADR 真实含义（kb/embedding 包边界）；包内 controller→service→repository 改标 `C-LAYER`（仓库惯例）；删除与 G0-1/2/7 重复的 G0-12，AGENTS 完成标准并入 G0-1 说明 |
| 2026-08-07 | 闭环结论入 README/overview：计划可进 S1；Wave0 须先单独 commit，再 W1.1→W1.2→W1.4 |
| 2026-08-07 | **交付复核**（`.tmp/reports/grok-delivery-review__20260807-172135-a1c502/`）：有条件接受。README 拆「代码就绪 / 能力验证」两态（R-03）。 |
| 2026-08-07 | **W2.1 供应商决策已确认**：采纳 DashScope `qwen3-rerank`（`openai_rerank`）；书面决策见 [ADR-0037](../adr/ADR-0037-kb-rerank-qwen3-dashscope.md)。 |
| 2026-08-07 | **CI 归属说明（R-01）**：`llm-catalog-http.module.test.ts` EADDRINUSE 隔离复跑可过 → 环境/端口抖动，非本 epic 逻辑回归。workspace typecheck 红：`agent-engine` descriptor tier/pin（非 kb/llm 本 epic 改动文件）。 |
| 2026-08-10 | **计划体系修复**：不再把 checkbox/`merged` 当证据；新增 EVALUATION-STRATEGY、CONSISTENCY-AND-SECURITY-INVARIANTS、ROLLOUT-AND-MIGRATION、DELIVERY-MATRIX。修正 W1.4 基线顺序、ACL 对 rerank 的错误依赖，并拆分代码合并/能力启用门阀。 |
| 2026-08-10 | **前提修正**：ID 集合一致不等于 payload/向量一致；合成满分 fixture 不证明真实收益；内存队列不等于持久队列；一次 rerank 不自动保证 multi-doc 公平；旧数据空 ACL 可见性改为待安全/产品决策。 |
| 2026-08-10 | **启动回归修复并固化契约**：KB BullMQ 原先漏读宿主 `REDIS_URL`，会错误回退 localhost；统一为 `AGENTIC_ENGINE_REDIS_URL > REDIS_URL > BUN_REDIS_URL > localhost`。ingest 恢复扫描改为 worker 创建后的后台任务，不再阻塞 HTTP bootstrap；增加启动阶段 begin/complete/fail 日志与 H9/H10 门阀。 |
| 2026-08-10 | **改动范围收敛**：逐项审计非 KB diff，仅保留 contracts、Qdrant adapter、outbox dispatcher、llm-core vendor adapter、宿主 relay/tenant 鉴权与契约 consumer 测试等直接依赖；撤回无必要因果关系的 Flow/server `idleTimeout` 调整。白名单与边界写入 CODE-CONVENTIONS §3.1。 |
| 2026-08-10 | **启动卡死二次根因修复**：纠正“仅 KB worker Redis 配置导致卡死”的不完整结论。代码中确定存在的后续阻塞点是 ai-center 在 HTTP listen 前同步等待 outbox relay leader election，而 relay 同样漏读宿主 `REDIS_URL`。现改为 listen 后后台启动，relay Redis env 与 worker 对齐，并增加 H11、状态日志和纯函数测试；migration/listen 也增加阶段日志，以免在未取得运行证据前把 V006 DDL 等替代解释排除。 |
| 2026-08-10 | **DI 503 回归与事务前提纠正**：异步摄入改动曾直接向 `DocumentService` 注入未注册的框架 `TransactionManager`，导致 preview 等所有文档路由在服务解析阶段 503。更深层错误是框架事务会话与 KB 的 mysql2 adapter 并非已证明的同一连接，补 provider 不能证明原子性。现改为 `DATABASE_SERVICE_TOKEN` 对应的 KB adapter 自带 transaction runner，用 AsyncLocalStorage 让 document/import job/outbox SQL 共享一个 `PoolConnection`；增加 commit/rollback/release/nested 单测、真实 `AiCenterKbHttpModule` DI 解析测试及 W3.3-H12/H13。对象存储仍只能补偿清理，不宣称跨资源原子。 |
| 2026-08-11 | **by-id preview 空结果与一致性纠正**：此前为规避异步 worker 重复 Docling，把“无持久化 chunks”的 preview 改成快速返回空 items；该取舍破坏预览语义且未经产品确认。现恢复为对象存储原文件只读拆分，并纠正另一处逻辑冲突：preview 不再无条件优先本地 fallback，而与 ingest 复用 primary→失败/无效才 fallback 的解析决策；全程不 embed、不写 MySQL/Qdrant、不入队。代价是首次 preview 延迟和并发重复解析，后续以 checksum+chunking config 缓存/单飞优化；新增 W1.2-H7、W3.3-H14。 |
| 2026-08-11 | **preview 10 秒断连与死配置修复**：`CUBE_SERVER_IDLE_TIMEOUT_MS=240000` 已被配置层正确解析，但 ai-center 在加载该配置前就以 `{port, hostname}` 构造 `Application`，最终 Bun.serve 仍使用默认 10 秒。新增启动前窄配置读取并把毫秒值传给 `Application.idleTimeout`，启动日志输出有效值；框架内部换算为秒，240000ms→240s（低于 Bun 255s 上限）。该宿主改动仅因同步 KB preview 的 Docling 等待而保留。风险是全局静默连接占用时间增加，长期替代为解析缓存/单飞或异步 preview。 |
| 2026-08-11 | **W3.3 优先级收敛与 preview 决策纠偏**：产品确认当前先解决请求等待，独立失败任务管理端、DLQ 查询/人工重放后置；自动限次重试、持久 failed/error 和恢复仍保留。此前把“未拆分应执行拆分预览”直接解释为 by-id 请求内同步 Docling，是未经确认的同步性推断，也与既有“processing+轮询”冻结记录及 `ChunkPreviewResult` 注释冲突。现 by-id preview 有 chunks 即返回，无 chunks 返回明确 `previewStatus`/pipeline 状态/`pollAfterMs`，不下载对象、不重复 Docling；async reindex 也不再在入队前下载完整对象。multipart 原文件 preview 仍同步解析，server idle timeout 接线因此保留。 |
| 2026-08-11 | **preview 产品语义再次确认并撤销轮询方案**：运行验证确认快速 `200 + items=[]` 不满足“预览”语义，产品明确质疑 by-id preview 再次异步化。事实核对发现上一方案仅凭 document 的 `pending/parsing` 字段推测后台任务存在，旧数据可能没有可推进 job，因而可能永久空结果。现收窄 W3.3：仅 upload/reindex 异步；by-id preview 有 chunks 直接返回，普通无 chunks 文档同步从对象存储执行只读 parser/chunker 并返回，不 embed/写库/入队。明确 failed/unsupported 仍返回终态。代价是 Docling 等待、对象下载和与后台 ingest 重复解析，依赖 idle timeout，后续以缓存/singleflight 优化。 |
| 2026-08-11 | **摄入产品路径全部收回同步**：产品进一步确认 `/reindex` 也不应先返回异步空状态，并要求现阶段拆分相关入口全部同步。代码事实是 `INGESTION_ASYNC_ENABLED` 原默认 true，upload/reindex 会入 outbox/BullMQ 后返回。现将默认改为 false：upload、reindex、multipart preview、by-id preview 均在请求内等待完成；异步可靠性实现保留为显式 opt-in，待 W4.6 管理面、readiness/SLO 和故障演练满足后再评估默认启用。代价是 parse+embed+index 延迟重新进入 upload/reindex 请求预算，服务端、网关和客户端超时必须一并校准。 |
| 2026-08-11 | **模型重排调用证据补齐**：此前 `/kb/search/by-documents` 只有失败降级文本日志，开关关闭、无候选、provider 缺失和成功调用均不可区分，且 KB 端口调用成功不能单独证明实际供应商。现增加 KB 路由层 `skipped/started/succeeded/fallback` 与 HTTP provider 层 `endpointHost/modelCode/status/durationMs` 两层结构化日志；明确排除 query、chunk 文本和 API Key。日志可证明调用链与实际端点，不能证明相关性收益，后者仍依赖 W1.4/E3。 |
| 2026-08-11 | **rerank 模型租户前提纠正**：运行日志显示重排在 HTTP 前 catalog 解析失败。对照真实 embedding 装配后确认：embedding 的 `LlmProviderEmbeddingPort.tenant` 固定来自 `KB_EMBEDDING_TENANT`（默认 `1`），而 rerank 曾错误优先使用请求 `currentTenantId()`，把业务数据租户误当成模型凭据租户。现移除该覆盖，rerank 与 embedding 共用固定模型 catalog tenant，并把实际 tenant 写入安全日志；请求 tenant 仍用于 MySQL/Qdrant 数据隔离。代价是模型配额和费用集中到固定 catalog tenant，尚不提供按业务租户分摊。 |
| 2026-08-11 | **qwen3-rerank endpoint / 协议修正**：运行证据为全局 `dashscope.aliyuncs.com/compatible-mode/v1/reranks` 返回 404；初始化 SQL、权威系统 seed 与 match rule 改为已确认的北京地域工作空间完整 endpoint `https://llm-rsqnz4dqml5koq8p.cn-beijing.maas.aliyuncs.com/compatible-api/v1/reranks`。撤回“自动追加/识别 `/reranks` 后缀”的脆弱实现，文本 adapter 只 POST catalog 的完整地址。官方文档确认 qwen3-rerank 使用顶层 `model/query/documents/top_n`，而 qwen3-vl-rerank 使用另一完整路径及嵌套 `input/parameters`、`output.results`；后者必须是独立 endpoint type/adapter，W4.4 前误配为 `openai_rerank` 明确拒绝。工作空间地址跨环境须覆盖并验证 Key 权限。 |
| 2026-08-11 | **默认 instruct 决策澄清**：阿里云官方契约说明 qwen3-rerank 省略 `instruct` 时默认采用问答检索。当前 adapter 继续省略，不重复发送相同默认值；“显式补默认 instruct”不再作为当前误排的修复方案。只有明确改变排序任务且完成 E3 时才引入不同指令。 |
| 2026-08-11 | **重排 Top1 反例与前提修正**：真实查询“证实方法有哪些？”中，范围声明 chunk-5（0.862109）压过直接列举方法的 chunk-25（0.854213），差值 0.007896。代码已发送 section/content，故不是标题漏传；分数 >0.8 也不等于答案正确。当前非同分排序由模型分决定，原 RRF 只在完全同分时 tie-break。W2.3 新增直接答案 vs 主题提及 hard-negative、QG-15 和不可硬编码约束；融合权重/margin 在 E3 前保持 TBD。 |
| 2026-08-11 | **运行时连接错误保留为未决事件**：`/kb/search/by-documents` trace `fc58555ab50346bfb5e4cc7cf49db368` 返回 Bun 通用连接错误和 `INTERNAL_UNKNOWN` 500。事后 Qdrant 与默认 embedding 主机可达，不能反推事发依赖；rerank 失败本应 fallback，也无证据归因于 rerank。记录现有 network error extractor 未识别通用 message/嵌套 cause 的可观测性缺口，等待带认证复现与脱敏分阶段证据。 |
| 2026-08-11 | **文档一致性与续接入口**：新增 CURRENT-STATE，冻结当前同步摄入、preview、idle timeout、rerank tenant/instruct、ACL 和 query rewrite 有效决策；修正 CODE-CONVENTIONS 的 idle timeout 旧结论、W3.3 双模式验收冲突及 W2.3 过期实现状态。历史摇摆只留 changelog，交付状态仍由 DELIVERY-MATRIX 管理。 |
