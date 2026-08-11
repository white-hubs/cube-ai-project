# 门阀验收硬性要求（Definition of Done）

> 本文区分“代码可合并”和“能力可启用”。通过单测或默认 flag off，均不能自动获得 live 启用资格。

## 0. 全局代码合并门阀

以下任一项不满足即拒绝合并：

| ID | 要求 | 证据 |
| --- | --- | --- |
| G0-1 | 全 workspace `bun run typecheck` 通过 | CI |
| G0-2 | 全 workspace `bun test` 全绿；testcontainers 仅可按约定门控 skip | CI |
| G0-3 | 不引入跨领域实现 import，只走 contracts port；不可豁免 | review |
| G0-4 | 临时产物只落 `.tmp/`，不提交密钥、真实租户语料和敏感 comment | git/status + review |
| G0-5 | PR 标注 W、F/R、owner、影响的不变量和 rollout 类型 | PR body |
| G0-6 | 排序/阈值/精排改动附同数据版本 before/after 分层结果 | EVALUATION-STRATEGY E1 |
| G0-7 | `bun run lint` 通过 | CI |
| G0-8 | 新/改公共接口 contracts 先行：schema、导出、测试；不可豁免 | review + CI |
| G0-9 | 风险性行为默认 off；若必须默认 on，须有书面兼容理由、迁移与回滚证据 | config review |
| G0-10 | 新扩展点有当前消费者或测试，不为假想需求造框架 | review |
| G0-11 | 新/改公共接口和核心分支至少一条覆盖用例 | CI |
| G0-12 | PR 列出受影响的一致性/安全不变量及故障注入用例 | review + E2（适用时） |
| G0-13 | schema、索引、回填改动附 R0/R1 盘点和 rollback compatibility | rollout review |
| G0-14 | ACL/认证改动使用 verified principal，并包含跨租户/错租户负例 | E2 + security review |
| G0-15 | DELIVERY-MATRIX 回填 commit、CI、owner、日期；checkbox 不算证据 | review |

纯文档 PR 可豁免 G0-1/2/7/11，但仍受 G0-4/5/15；纯 DI 且行为不变可说明 `no-behavior-change`，不得借此豁免安全或 schema 门阀。

## 1. 全局能力启用门阀

以下门阀适用于小流量、扩量和默认开启：

| ID | 要求 | 证据 |
| --- | --- | --- |
| L0-1 | E3 before 基线、数据版本、主指标和 critical set 已登记 | 实验记录 |
| L0-2 | canary owner、范围、观察窗口和自动停止条件明确 | rollout ticket |
| L0-3 | 质量满足预登记的非劣/收益门槛，不能在结果出来后换指标 | E3 报告 |
| L0-4 | p95/p99、错误率、降级率和费用不超 EVAL-03 预算 | dashboard/账单口径 |
| L0-5 | migration/backfill 可续跑，reconcile 达到严格一致性 | E2 + migration report |
| L0-6 | ACL 泄漏、跨租户命中、不可恢复分叉为 0 | security/invariant tests |
| L0-7 | kill-switch 和应用/数据回滚已演练 | rollback record |
| L0-8 | DELIVERY-MATRIX 更新为 `live_verified` 并有批准人 | evidence links |

## 2. 工作项硬性门阀摘要

| 工作项 | 代码合并关键门阀 | 能力启用附加门阀 |
| --- | --- | --- |
| W1.4 | E0/E1 分层；fixture runner 经过 RetrievalService | E3 数据 owner、区间和 critical set |
| W1.1 | SQL 排序与目标评分严格等价或有可证明保序关系；窗口外负例 | 目标数据性能不超预算 |
| W1.2 | parser chunk 有效性/长度判定；preview/ingest 一致 | 存量 reindex 和模型 token/成本评估 |
| W1.3 | 结构化 chunkId/page/section + tenant-scoped detail | 错租户 404；不暴露 embeddingText |
| W2.1 | vendor DTO 隔离、限额/错误契约测试 | 凭据、限流、费用和模型版本确认 |
| W2.2 | 三路径统一 rerank；失败降级；候选预算公平性负例 | 真实模型 E3 + 阈值标定 |
| W2.3 | 独立 rerank 阈值；结构化输入；exact 阈值豁免；内容/section 去重；MMR 降级；动态 TopK；fixture nDCG@5 ≥ 0.80；直接答案不得被仅主题提及候选压过 | 真实标注 E3 nDCG@5 ≥ 0.80 + critical Hit@3=1 + 答案/主题 hard-negative 分层 + 延迟/费用预算 |
| W3.1 | staging generation 双腿一致并原子切 active | 失败保留旧 generation；历史清理和告警运行 |
| W3.2 | 先证明 provider batch capability；否则采用有限并发 | 429/5xx/限流与吞吐预算 |
| W3.3 | 默认 `INGESTION_ASYNC_ENABLED=false` 时 upload/reindex/preview 返回成功必须已同步完成；异步显式开启时才允许快速返回，并具备既有 outbox+BullMQ、幂等、分页恢复、自动限次重试和持久失败终态，worker/relay Redis env 与宿主兼容，真实宿主模块可解析 `DocumentService`，document/job/outbox 共用一个 KB mysql2 事务连接 | 默认同步路径延迟/网关/客户端/idle-timeout 预算；异步启用前补队列积压、恢复演练、readiness、故障注入与容量预算；DLQ 管理端按 W4.6 后置 |
| W3.4 | 双候选源避免短字段饿死；DDL dry-run | FULLTEXT flag E3、慢查询和容量 |
| W3.5 | embedding fingerprint 与 payload generation 分离；metadata-only 不跳过；parse 前短路须有完整 config fingerprint | 回填/reconcile 版本分布为零欠账 |
| W4.1 | verified principal、tenant 双腿隔离、空 ACL=tenant visible、payload index | 小流量跨租户泄漏=0 |
| W4.2 | 默认关闭且 header-shape auth 不可达 | 产品入口/owner 确认后重新评审 |
| W4.3 | KB 不调用 LLM query rewrite/contextual prefix | Agent 改写与原始 query 分别 trace/eval |

暂缓 W4.4/W4.5 未达到准入条件前不得以完成 F-14/F-17 名义合并产品化实现。

## 3. 交付阶段出口

| 阶段 | 出口 |
| --- | --- |
| G0 决策与基线 | EVAL/SEC/CON/QUEUE owner 回填；W1.4 before；R0 盘点 |
| G1 正确性与安全 | W1.1/W1.2 before-after；W3.1 严格收敛；W4.1 E2 无泄漏 |
| G2 可靠性与观测 | W3.2 capability 核实；W3.3 故障恢复；W3.5 版本收敛；W4.2 权限/观测闭环 |
| G3 质量实验 | W2.2/W3.4/W4.3 各自 E3；不得用一个功能的收益替另一个功能背书 |

## 4. 豁免

豁免必须记录 ID、原因、风险、到期时间、补偿和批准人。以下不可豁免：

- G0-3 跨域边界、G0-8 contracts、G0-14 身份负例。
- W4.1 双腿 ACL 与 ACL 收紧 fail-closed。
- W3.1 payload/version 一致性。
- W3.3 持久化、幂等和可恢复领取。
- critical set 安全/法规零退化。

质量收益门槛可以由产品在实验前调整，但不能在看到结果后选择最有利口径。
