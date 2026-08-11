# KB / RAG 交付责任与证据矩阵

> 本文件是唯一交付状态源。各 W 文档中的步骤是计划清单，不再用勾选框充当完成证据。

当前有效运行决策、最近反例和续接顺序见 [CURRENT-STATE.md](./CURRENT-STATE.md)。本表负责状态与证据，不重复保存容易过期的运行决策全文。

## 1. 状态语义

| 状态 | 必须证据 |
| --- | --- |
| `planned` | 计划、依赖和 owner 已定义 |
| `in_progress` | 有活动 PR/分支链接 |
| `code_complete` | commit/PR + 全局门阀 CI 证据 |
| `data_verified` | E2 真实 MySQL/Qdrant 证据 |
| `live_verified` | E3 canary 证据、配置快照和 owner 批准 |
| `blocked` | 阻断决策/外部依赖明确 |
| `deferred` | 有准入条件，不进入当前排期 |

没有链接和日期时，不得只根据代码存在、checkbox 或 README 文案填写 `code_complete/live_verified`。

## 2. 当前证据审计

以下“文档原声称”只记录修订前文本，不代表本次复核确认；owner、PR、CI、环境证据尚未回填，因此不得从本表推导已经可上线。

| 工作项 | 计划状态 | 文档原声称 | Owner | PR/commit + CI | E2 | E3/启用 | 关键阻断 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| W0 | blocked | merged/总览称未提交 | TBD | TBD | N/A | N/A | 状态自相矛盾 |
| W1.4 | blocked | merged | TBD | TBD | TBD | TBD | 先建立真实链路 before 基线 |
| W1.1 | planned | merged | TBD | TBD | TBD | N/A | 需以 W1.4 before 为前置 |
| W1.2 | planned | merged | TBD | TBD | TBD | TBD | structured chunk 可用性与迁移策略 |
| W1.3 | planned | merged | TBD | TBD | N/A | TBD | 结构化 chunk 锚点 + tenant-scoped 详情接口 |
| W2.1 | planned | merged | TBD | TBD | N/A | TBD | vendor 限额/费用与决策 owner |
| W2.2 | planned | merged/default off | TBD | TBD | TBD | TBD | 工作区已有统一 rerank、multi-doc 公平预算及路由/provider 两层安全审计日志；缺本机 DashScope smoke、真实模型 E3、阈值和费用标定 |
| W2.3 | planned | 工作区已有实现 | TBD | KB 311 pass/1 skip/0 fail；workspace typecheck pass；全量测试 3203 pass/234 skip/15 个监听环境失败；全局 lint 有 63 个既有错误 | N/A | 未运行 | 已实现独立阈值、结构化输入、exact 默认阈值豁免、去重、section 配额、MMR、动态 TopK 与 nDCG@5 门阀；多样化默认关闭。真实查询“证实方法有哪些”仍发生主题提及压过直接答案的 Top1 误排，且当前非同分顺序只看模型分。缺通用纠偏方案、QG-15、正常 CI 全绿与真实标注 E3，不能声称质量达到 80 或标记 code_complete |
| W3.1 | planned | merged | TBD | TBD | TBD | TBD | 工作区已有 versioned generation/CAS/outbox reconcile；缺 MySQL+Qdrant 故障注入、payload/version 与向量完整性证据 |
| W3.2 | planned | README 称 merged、步骤未勾选 | TBD | TBD | TBD | TBD | provider 是否支持真正 batch 需先核实 |
| W3.3 | planned | merged/default off | TBD | TBD | TBD | TBD | 工作区已接 outbox relay + BullMQ、keyset 后台恢复、REDIS_URL 启动兼容与 KB mysql2 同连接事务，但产品运行模式已收回同步：`INGESTION_ASYNC_ENABLED` 默认 false，upload/reindex/preview 均等待处理结果；异步仅显式 opt-in。仍缺 Docker E2/真实 outbox 故障注入、readiness/SLO；DLQ 管理/重放按产品决定后置，多副本租户限流仍是进程级 |
| W3.4 | planned | merged/default off | TBD | TBD | TBD | TBD | DDL/容量、短字段候选召回 |
| W3.5 | planned | README 称 merged、步骤未勾选 | TBD | TBD | TBD | TBD | 工作区已有 chunk embedding diff/向量复用；缺 parser/config fingerprint、E2 与真实 Qdrant 读取成本验证 |
| W4.1 | planned | merged/待小流量 | TBD | TBD | TBD | TBD | 工作区已绑定普通 API key tenant、移除 opaque token 组解析并建 payload index；缺跨租户/ACL E2 与存量数据验证 |
| W4.2 | deferred | merged/default on | TBD | TBD | N/A | N/A | 无产品入口/owner；默认关闭并移除 header-shape auth |
| W4.3 | planned | merged/default off | TBD | TBD | TBD | N/A | 移除 KB LLM rewrite/contextual prefix；Agent 负责改写 |
| W4.4 | deferred | deferred | TBD | N/A | N/A | N/A | picture 数据与 ROI 准入 |
| W4.5 | deferred | deferred | TBD | N/A | N/A | N/A | 产品配置面准入 |
| W4.6 | deferred | 新增后续项 | TBD | N/A | N/A | N/A | 当前无独立失败任务管理端；待 owner、权限、留存和重放不变量确认 |

`blocked/planned` 是本目录的证据审计状态，不是对代码存在性的否认。证据和未决协议回填后，才可转换为 `code_complete/data_verified/live_verified`。

### 2.1 本地工作区证据（2026-08-10，非 CI/非上线证据）

已核对的代码事实：

- versioned chunk generation、tenant-scoped expected-generation CAS、旧 import job 单调水位保护；单块编辑与 ACL/metadata 更新也走新 generation。
- upload/reindex 的 MySQL outbox、BullMQ worker、tenant context 恢复，以及 `(create_time,id)` keyset 分页兜底扫描。
- KB BullMQ 与共享 outbox relay 复用宿主 Redis env 优先级（engine override → `REDIS_URL` → Bun 兼容 → localhost）；恢复扫描后台运行，relay 在 HTTP listen 后后台启动，两者均不再阻塞 HTTP bootstrap。
- async upload/reindex 不再依赖框架 `TransactionManager`；KB mysql2 adapter 以同一个 `PoolConnection` 提交 document/import job/outbox，并由模块级 DI 测试阻止“手工 new 单测通过、真实容器 503”回归。对象存储仍是事务外 best-effort 补偿，storage orphan 清理尚属运维欠账。
- by-id preview 有 active chunks 时直接返回；普通无 chunks 文档从对象存储同步执行只读 parser/chunker 并返回 items，不 embed、不写 MySQL chunks/Qdrant、不入队。multipart 与 by-id 原文件 preview 都复用 ingest 的 primary→fallback parser 决策。
- `kb.vector.reconcile` 持久 outbox/BullMQ worker；per-document Qdrant scroll 遍历全部页并修复 ID 差集/删除孤儿。
- DashScope `qwen3-rerank` OpenAI-compatible adapter，默认关闭；multi-doc 候选预算至少为每个有候选文档保留一个代表项（预算足够时），剩余按 pre-rank 稳定填充。
- W2.3 在 rerank 后增加独立模型分阈值（初值 0.65）、结构化输入与标准号归一化；可选质量选择使用 exact 默认阈值豁免、内容/section 去重、Qdrant dense-vector MMR 和动态 TopK。按 G0-9，`RETRIEVAL_DIVERSIFICATION_ENABLED` 默认 false；fixture before/after Hit@3/MRR 均为 1.0、nDCG@5 均为 0.9855195547607133，只证明默认路径不退化，不证明 live 收益。
- `/kb/search/by-documents` 的模型精排新增两层结构化日志：KB 层给出跳过原因/调用结果及模型 catalog tenant，HTTP provider 层给出实际 endpoint host、model、status 和耗时；query、chunk 文本与 API Key 不进入日志。rerank 已与 embedding 对齐，固定使用 `KB_EMBEDDING_TENANT`（默认 `1`），请求 tenant 仍只隔离 KB 数据。该证据只能确认调用链，不能替代真实检索质量评测。
- 阿里云官方说明省略 `instruct` 时默认采用问答检索；当前 adapter 不重复发送同一默认值。真实“证实方法有哪些”反例说明默认问答目标仍可能误排，不能把显式补同值参数当作修复，也不能把模型分超过 0.8 当作正确性证据。
- 空 ACL 映射 tenant-visible；非空 ACL 为 fail-closed 扩展；普通 API key 不能用 tenant header 切换租户；feedback 默认关闭且不存在 header-shape authentication。

本地验证事实：全 workspace typecheck 与 build 通过；KB/contracts/llm/Qdrant/outbox 相关测试集为 1042 pass、16 skip、1 fail，唯一失败隔离复跑 3 次均在 `Bun.serve(port=0)` 报 `EADDRINUSE`。全量 `bun test` 为 3169 pass、234 skip、15 fail，15 项均是需要监听本地随机端口的 HTTP/gRPC/mock server 测试；这支持“当前 sandbox 监听限制”的解释，但仍须在正常 CI 复核，不能直接把失败抹掉。Docker socket 无权限，因此 testcontainers、真实 MySQL/Qdrant 故障注入和供应商 live E3 **没有证据**。在这些门阀补齐前，状态保持 `planned`，不能写成 `code_complete`。

范围收敛后的增量回归（2026-08-10）：全 workspace `bun run typecheck` 通过；Redis env、后台恢复、tenant API key、outbox attempts、Qdrant retrieve/index、rerank/embedding 与 Agent 契约消费共 91 tests pass、0 fail；`git diff --check` 通过。这是本地代码证据，不替代上述 E2/E3 和正常 CI。

启动卡死二次修复回归：全 workspace typecheck 再次通过；outbox Redis 解析、dispatcher、KB worker Redis 与后台恢复共 26 tests pass、0 fail。当前 sandbox 无法连接用户的外部 Redis/MySQL，因此“真实进程已越过 migration/listen”仍需本机 smoke 证据；新阶段日志会直接标出剩余阻塞位置。

主动保留的风险：`BUILTIN_SYSTEM_API_KEY` 按产品决定本轮不改，待 Flow 重构；它是接受的遗留风险，不是修复成果。

### 2.2 当前未关闭运行事件（2026-08-11）

- `/kb/search/by-documents` 出现 trace `fc58555ab50346bfb5e4cc7cf49db368`，Bun 通用连接错误最终映射为 `INTERNAL_UNKNOWN` 500。
- 事后 Qdrant `/readyz` 和默认 embedding 主机连通性正常，只能排除“检查时持续不可达”，不能确定事发依赖。
- rerank 失败按代码会 fallback；尚无证据把本事件归因于 rerank。
- KB 网络错误提取器未识别通用 Bun message/嵌套 cause，导致 step 丢失并返回 500；下一步先补脱敏分阶段诊断和稳定 503 映射，再依据同 trace 复现决定是否需要依赖级重试。事件细节和安全日志约束见 CURRENT-STATE OP-01。

### 2.3 改动范围审计（2026-08-10）

事实：工作区的非 KB 代码改动均已逐项映射到 KB 消费链路，允许范围与理由以 [CODE-CONVENTIONS §3.1](./CODE-CONVENTIONS.md) 为准。代码审计确认 `CUBE_SERVER_IDLE_TIMEOUT_MS` 曾只被解析、未传入 ai-center `Application`，现仅恢复组合根接线和有效值日志，不修改 Flow server。该接线直接服务于同步 multipart/by-id preview 的 Docling 等长请求。worker Redis 兼容修复位于 `packages/kb/core`；共享 outbox relay 在其既有 adapter 中补充 `REDIS_URL`/`BUN_REDIS_URL` fallback。上述宿主缝均不修改 SFID、Agent session 或 leader election 算法。

判断：不能把“只允许改 KB”解释成“只能修改 KB 目录”，否则会迫使 KB 绕过 contracts、vendor catalog、Qdrant adapter 或宿主鉴权，反而违反仓库边界；正确约束是只保留有直接 KB 消费证据的最小跨包接缝。

## 3. 必须明确的责任

| 决策/工作 | Accountable owner | Due | 证据 |
| --- | --- | --- | --- |
| EVAL-01..04 评测数据、指标和预算 | TBD | TBD | 决策记录 |
| SEC-01 空 ACL = tenant visible | 产品决策已确认 | 2026-08-10 | 本计划决策记录 |
| SEC-02 feedback 权限与留存 | deferred（安全+数据 owner） | 产品入口确认后 | 权限矩阵/留存策略 |
| CON-01 versioned generation | KB owner | 实现前 | schema + 故障注入评审 |
| QUEUE-01 outbox + BullMQ | 平台/KB owner | 实现前 | 既有基础设施复用 + 容量评审 |
| FLOW-AUTH-01 静态系统 Key | Flow 重构 owner | Flow 重构时 | 替换动态 tenant 高权限回调凭证 |
| MySQL FULLTEXT 窗口 | TBD（DBA） | TBD | dry-run |
| Qdrant payload index/容量 | TBD（向量平台 owner） | TBD | collection 检查 |
| canary 与回滚值班 | TBD（发布 owner） | TBD | rollout ticket |

“产品确认”“运维评估”不是可追责主体；必须回填具体团队角色或个人及日期。

## 4. 工作量事实与未计成本

按修订前各非暂缓 W 文档的显式数字机械相加：开发估算为 **31～51.5 人日，另加 reindex 成本**。这是文档数字的汇总，不是经历史数据校准后的承诺。

| 工作项 | 修订前显式估算（人日） |
| --- | ---: |
| W1.1 / W1.2 / W1.3 / W1.4 | 1–1.5 / 0.5 / 0.5–1 / 1.5–2 |
| W2.1 / W2.2 | 1.5–2.5 / 2.5–3.5 |
| W3.1 / W3.2 / W3.3 / W3.4 / W3.5 | 3–5 / 1.5–2.5 / 3–5 / 2–4 / 2–3 |
| W4.1 / W4.2 / W4.3 | 5–9 / 2–4 / 5–8 + reindex |
| **机械合计** | **31–51.5 + reindex** |

该区间未明确包含：live 数据构建/标注、DBA 窗口、Qdrant/MySQL 容量验证、身份 claims 联调、灰度观察、回填失败处理、安全评审、runbook、值班和跨团队排队时间。排期前必须由 owner 分别估算，不能简单对开发人日乘系数后宣称交付日期。

## 5. 证据回填模板

```text
Work item:
Owner / reviewer:
PR / commit:
CI run + date:
E2 environment + result:
E3 experiment_id + result:
Enabled config + scope:
Residual risks / accepted by:
Rollback owner:
```
