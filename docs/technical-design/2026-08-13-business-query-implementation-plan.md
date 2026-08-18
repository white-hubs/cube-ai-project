# 业务问数安全与语义层改造落地执行计划

日期：2026-08-13  
状态：实施中，当前不满足完成定义（2026-08-17 启动验证复盘结论：后端 platform service、安全 SQL executor、MCP progress、cube/ghcloud 安全投影等切片已有实现与测试；但 biz 前端配置中心、API contract、verified queries/metrics 管理、Eval 门阀、Workbench 调试、计划状态口径仍未完整对齐。不得把局部测试通过视为本计划完成。真实跨仓库端到端对话仍需在 Redis/MySQL/Qdrant/MCP/Agent 全部可达后复验，完整权限/审计专项后置。）  
适用仓库：

- `/Users/ghy/work/cube-ai-project`
- `/Users/ghy/work/biz-ontology-platform`
- `/Users/ghy/work/ghcloud-new/prod/cube/apps/ai-application/app`

关联设计文档：

- `/Users/ghy/work/cube-ai-project/docs/technical-design/2026-08-13-mcp-business-query-safety-and-semantic-layer.md`

---

## 0. 当前事实校准与追踪矩阵（2026-08-17）

本节用于防止再次出现“补了局部功能但没有完整落地”的问题。后续实现必须先更新本矩阵，再改代码；任何条目只有同时具备后端、前端、配置、测试和门阀证据，才允许从 `partial/missing` 改为 `done`。

状态定义：

- `done`：代码已实现，前后端 contract 对齐，自动测试或真实环境验收有事实证据。
- `partial`：已有部分能力，但页面、API、测试、配置或真实验收任一维度缺失。
- `missing`：尚未实现或当前实现与计划要求不匹配。
- `blocked_real_env`：代码可验证范围已完成，但必须依赖真实 Redis/MySQL/Qdrant/MCP/Agent 环境复验。
- `conflict_with_plan`：代码事实与本文冻结 contract 或完成定义冲突，必须先修设计/实现口径。

### 0.1 全量待整改执行矩阵（冻结，全部必须落地）

本节是后续整改的唯一执行基线。以下条目不是优先级拆分，也不得解释为“只做前几项即可”。所有 `partial`、`implemented`、`todo`、`blocked_real_env`、`conflict_with_plan` 条目都必须逐项整改到目标状态；只有达到本节定义的门阀，才允许标记为 `done` 或作为合入依据。

执行规则：

1. **不分 P0/P1/P2**：表格顺序仅用于串行施工和回归定位，不代表优先级；所有条目都是必须项。
2. **不得空心配置**：页面有配置入口但后端不消费、后端有字段但页面不可配置、配置能保存但 runtime 不生效，均视为未完成。
3. **不得局部冒充完成**：源码契约测试通过只能证明局部 contract，不能替代真实页面交互、真实服务联调或真实 eval。
4. **不得泄漏内部信息**：普通用户路径不得输出 SQL、MCP URI、tool args、raw rows、raw id/code、tenant/deleted、真实 API key/token、内部 trace/debug。
5. **门阀必须达标才能入**：每项必须同时给出代码落点、页面/配置落点、测试命令、测试结果、文档状态；未达目标不得合入。
6. **文档先行同步**：每完成一个条目，必须先更新本矩阵的状态和证据，再进入下一项整改。

#### 0.1.1 总体能力整改矩阵

| 序号 | 能力项 | 当前状态 | 必须整改内容 | 达标门阀 |
| --- | --- | --- | --- | --- |
| G-01 | `ask_business_data` platform service | partial | 补真实环境验收、完整浏览器交互、性能基线；复杂问数不得回退到不安全路径 | 后端服务、页面验证、真实问数、性能报告均通过；普通响应不含内部信息 |
| G-02 | 旧 `query_database` 普通 MCP tool 物理清理 | partial | 扫描并清理 prompt/export/descriptors/custom agents/旧路由残留；旧引用 fail-closed | 旧工具不可注册、不可 discovery、旧引用有失败关闭测试 |
| G-03 | API contract 冻结 | partial | 补 stream contract、debug contract 页面交互、真实联调；前端不再依赖同步整包 JSON | API 类型、stream 事件、页面消费、contract 测试一致 |
| G-04 | BusinessDomainPage 配置中心 | partial | 保存 dirty、requires_rebuild、Eval/Workbench 消费、真实页面交互闭环 | 页面新增/编辑/保存/重建/跳转真实可用；测试覆盖 |
| G-05 | 候选域启用/禁用 | partial | domain_key 显式保存、多 connection UX、`${ENV}` placeholder 防泄漏 | 保存不会展开真实密钥；候选域状态与路由诊断一致 |
| G-06 | 关键词闭环 | partial | 保存后 semantic dirty、热生效/重建边界提示、`matched_keywords` 测试 | 关键词配置、召回、diagnostics、重建提示闭环 |
| G-07 | semantic index repository 抽象 | partial | repository/provider/catalog 结构清晰；Qdrant smoke 真实验证 | 本地/测试 Qdrant 写入和查询通过；文档与代码结构一致 |
| G-08 | semantic index 内容可解释 | partial | 展示 domain/entity/field/synonym/query_example/question_bank/metric/dimension/resolver/relationship/multi_step_template 数量、indexed_at、dirty 原因、last_error | status/rebuild 返回与页面展示一致，有页面断言 |
| G-09 | display policy | partial | 明确页面可编辑边界、隐藏原因 diagnostics、防止移除默认安全基线 | 用户配置不能破坏安全兜底；隐藏字段原因可审计 |
| G-10 | access policy / 字段条件约束 | partial | 实体级条件页面保存、上下文变量、缺字段 skip/not_applicable、缺变量 fail-closed 全闭环 | 页面配置会被 SQL 约束执行器消费；无任意 SQL where 编辑 |
| G-11 | `_metrics.yaml` 管理 | partial | 指标/维度/过滤字段表格化真实保存、dirty、平台生成 SQL 只读预览 | 保存后 schema 校验、索引 dirty、问数命中、测试均通过 |
| G-12 | `_verified_queries.yaml` / SQL 模板 | partial | 模板新增/编辑/保存/重建/命中完整链路；不得保存可执行 SQL 原文 | verified query 只存 plan/audit metadata，执行 SQL 永远平台生成 |
| G-13 | 业务主体列表/明细查询 | partial | 真实主体值过滤 eval、浏览器保存、列表/明细真实验收、dict 兼容不丢失 | 用户列表/明细问题安全、准确、分页、展示字段均符合配置 |
| G-14 | 跨业务域/跨连接多步问数 | partial | OUAA → 风险管控真实 E2E/eval；resolver 0/1/多命中、分页、上下文绑定验收 | 跨库不 JOIN，多步执行顺序和中间变量安全可验证 |
| G-15 | EvalPage 业务问数门阀 | partial | 50 条人工 eval、分类指标、门阀报告；准确性、安全性、澄清质量分项 | 未达门阀不得合入；报告必须关联 config_fingerprint |
| G-16 | WorkbenchPage 问数调试 | partial | 调试路径闭环；普通用户不得回到任意 SQL 路径 | Workbench 调试入口只走安全问数 API |
| G-17 | OntologyEditorPage 资产编辑 | partial | 实体配置真实浏览器保存、业务域 dirty 联动、配置持久化验收 | 实体页配置保存后被业务域页、runtime、索引状态消费 |
| G-18 | MCP 配置导出动态验证问题 | partial | 无候选域不生成问数验证；有候选域从实体/verified query 动态生成；禁止硬编码风险管控 | exporter 测试证明无硬编码、无空验证、无旧工具引用 |
| G-19 | cube/ghcloud 安全投影 | blocked_real_env | 真实 MCP/Agent/应用对话复验；pagination/timeline 不泄漏内部字段 | 最终答案不含 SQL/MCP URI/tool args/raw id/code；真实端到端截图/日志留证 |
| G-20 | 合入门阀 | conflict_with_plan | 建立统一门阀报告，替代分散测试口头证明 | 后端、前端、MCP、cube、ghcloud、eval、真实联调全部达标后才可合入 |

#### 0.1.2 BQ 细项整改矩阵

| ID | 当前状态 | 是否必须整改 | 待整改/待验证内容 | 达标门阀 |
| --- | --- | --- | --- | --- |
| BQ-A01 | verified | 是，需回归 | domain asset 类型扩展保持支持 `metrics/verified_queries/resolvers/multi_step_queries`；未知 asset fail-closed | settings/API 测试通过；无旧 asset kind 回退 |
| BQ-A02 | verified | 是，需回归 | `_resolvers.yaml` schema 校验保持完整 | 坏结构、坏字段、坏 mask 均拒绝 |
| BQ-A03 | verified | 是，需回归 | `_multi_step_queries.yaml` schema 校验保持完整 | 无效 step、field、operator、`${step.xxx}` 均拒绝 |
| BQ-A04 | verified | 是，需回归 | `_verified_queries.yaml` 保持单步语义；multi-step 不得强塞旧模板 | 旧 verified 正常；带 steps 的 verified 策略明确并测试 |
| BQ-A05 | verified | 是，需回归 | catalog loader 类型化；loader 不执行 SQL | loader 单测通过 |
| BQ-L01 | verified | 是，需回归 | `list_profile` 读取模型保持稳定 | 读取有效配置测试通过 |
| BQ-L02 | implemented | 是 | `list_profile` 保存校验需要真实页面保存验收 | 后端校验 + 前端保存 + 浏览器真实保存通过 |
| BQ-L03 | implemented | 是 | display_fields 投影补齐 label/mask/enum/formatter 细粒度验收 | 投影单测覆盖 mask、enum、hide_fields、formatter；真实展示一致 |
| BQ-L04 | implemented | 是 | filter_fields 受控过滤需完整回归；未声明过滤意图 fail-closed | enum/context/contains/min_keyword_length/未声明过滤阻断测试通过 |
| BQ-L05 | verified | 是，需回归 | relationship usage 页面配置与 runtime/catalog 保持一致 | 前端源码契约、保存、validator 回归通过 |
| BQ-R01 | verified | 是，需回归 | resolver catalog 加载稳定 | catalog 单测通过 |
| BQ-R02 | verified | 是，需回归 | exact_then_fuzzy 匹配稳定 | 0/1/多命中测试通过 |
| BQ-R03 | implemented | 是 | resolver 查询必须真实注入 tenant/deleted/context_filters | SQL executor/resolver 安全约束测试 + 真实查询验收 |
| BQ-R04 | verified | 是，需回归 | ambiguity handling 禁止默认取第一个 | 0 命中、多命中、allow_multi 测试通过 |
| BQ-R05 | implemented | 是 | resolver display projection 脱敏真实验收 | raw id 不进入用户答案；display_fields 受 display policy 约束 |
| BQ-M01 | implemented | 是 | MultiStepPlan model 回归与序列化稳定 | model/serialization 测试通过 |
| BQ-M02 | verified | 是，需回归 | MultiStepPlanValidator 正反例完整 | validator 正反例测试通过 |
| BQ-M03 | verified | 是，需真实验收 | Orchestrator 消费 multi-step template，单步不回归 | service 测试 + 真实多步问数通过 |
| BQ-M04 | verified | 是，需真实验收 | external_reference 跨连接只多步，不 JOIN | 缺关系 fail-closed；跨连接不 JOIN；真实跨库通过 |
| BQ-M05 | partial | 是 | 同连接 1-hop JOIN：`validate_same_connection_join` + `build_same_connection_join_select` 已实现（同 connection、显式 relationship、1-hop、join 标识符防注入、分页只主实体）；仍需跨实体字段匹配触发点接入 `_plan` | join validator/SQL generator 单测通过；触发点接入待补 |
| BQ-M06 | partial | 是 | LLM plan proposal：`validate_plan_proposal` 已实现（entity/metric/dimension/filter 字段校验、禁 SQL/raw rows、非法字段 fail-closed）；仍需 LLM fallback 调用集成（prompt/schema） | proposal guard 单测通过；LLM 调用集成待补 |
| BQ-M07 | todo | 是 | pending candidate：动态成功计划只进入 pending，不变 verified，不保存 SQL | candidate 写入与审核流测试通过 |
| BQ-P01 | implemented | 是 | 请求/响应 contract 与 MCP contract 全对齐 | service/router/frontend/MCP contract 测试通过 |
| BQ-P02 | implemented | 是 | Redis page session 需要真实 Redis 集成测试 | Redis adapter 真实连接、TTL、opaque token 测试通过 |
| BQ-P03 | verified | 是，需回归 | PAGE_TOKEN_EXPIRED 保持安全响应 | 过期测试通过 |
| BQ-P04 | verified | 是，需回归 | Redis 不可用降级保持安全 | 降级测试通过 |
| BQ-P05 | verified | 是，需真实验收 | 跨连接多步分页真实验收 | 下一页不重跑 resolver；context hash 不匹配失效 |
| BQ-F01 | verified | 是，需回归 | API 类型扩展保持一致 | API 测试 + typecheck 通过 |
| BQ-F02 | verified | 是，需真实验收 | 实体页 list_profile UI 浏览器真实交互 | 新增/编辑/保存/重载后配置一致 |
| BQ-F03 | verified | 是，需真实验收 | relationship usage UI 浏览器真实交互 | 保存后 YAML 和 runtime/catalog 一致 |
| BQ-F04 | verified | 是，需真实验收 | 业务域页 resolver UI 浏览器真实交互 | 表格编辑保存 `_resolvers.yaml`，无 YAML textarea 暴露 |
| BQ-F05 | verified | 是，需真实验收 | 业务域页 multi-step UI 浏览器真实交互 | 表格/分步编辑保存 `_multi_step_queries.yaml`，无 YAML textarea 暴露 |
| BQ-F06 | implemented | 是 | 问数验证页 timeline / event-stream contract 与真实联调 | SSE 事件白名单；SQL/raw rows 不进事件 |
| BQ-F07 | implemented | 是 | semantic dirty 联动：`_domain_fingerprint` 覆盖 domain 目录全部 `*.yaml`（含 resolver/multi-step/list_profile/relationship 资产），保存资产后 fingerprint 自动变化使 `dirty=true`，无需显式标记 | Vue/API 测试 + 真实页面状态通过（浏览器交互待验） |
| BQ-S01 | verified | 是，需回归 | semantic documents 扩展：`build_semantic_documents` 已构建 13 种 kind（含 resolver、relationship、multi_step_template、list_profile、verified_query、metric、dimension 等）入索引 | `test_business_query_semantic_index.py` 覆盖语义资产入索引与 repository 状态 |
| BQ-S02 | verified | 是，需回归 | content_summary 展示：`_semantic_content_summary` 返回 `asset_type_counts` 及 13 个 doc_count 字段，前端 `semanticIndexContentRows` 13 类标签渲染 | status/rebuild 返回与页面展示测试通过 |
| BQ-E01 | partial | 是 | eval 分类扩展：list/clarification 已通过 normal（detail/lookup）/ambiguity（clarification）分类覆盖；resolver/multi_step_count/multi_step_list 待 G-14 资产落地 | eval 分类测试通过（list/clarification 已有覆盖） |
| BQ-E02 | partial | 是 | eval 门阀指标：已补非问数误召回拦截（`non_business_query_rejection`，=100%）与 field/filter/group-by 命中率（`field_filter_groupby`，field/filter/group-by 三项齐备）；仍需补 resolver 命中率、跨域 step order、列表安全投影 | eval runner 测试覆盖非问数误召回拦截 + field_mismatch + filter_mismatch + group_by_mismatch；期望值由生成器推导 normal 重要字段/枚举过滤字段与 aggregate/topn 的 group-by 字段 |
| BQ-C01 | verified | 是，需回归 | MCP contract：`ask_business_data` 输入/输出支持分页，普通 content 无 diagnostics；2026-08-18 已补 `page_size/page_token` schema、stdio 转发、tools 薄封装安全 JSON、structured payload 安全 pagination | MCP contract 7 passed；structuredContent 安全；普通 content 只保留摘要文本 |
| BQ-G01 | todo / blocked_real_env | 是 | 应用对话 guard 回归：pagination/timeline 字段不泄漏 SQL/raw id/tool args | cube/ghcloud 测试 + 真实 Agent 对话验收 |

| 计划能力 | 后端事实 | 前端事实 | 配置/资产事实 | 测试/门阀事实 | 当前状态 | 修正要求 |
| --- | --- | --- | --- | --- | --- | --- |
| `ask_business_data` platform service | `backend/services/business_query/service.py` 已存在，能读取 ontology、生成受控计划、走内部 SQL executor；普通单实体列表已消费 `list_profile.display_fields/default_sort/filter_fields/value_match`，启用 `list_profile` 后不再绕过 `filter_fields` 使用旧 enum 自动过滤；`value_match.type=context` 会从解析后的 caller_context 变量生成受控 SQL 条件，缺失时 fail-closed；resolver 型值匹配必须走多步模板，不在普通列表里隐式跨域调用；用户问题命中未声明枚举/字段值过滤意图时 fail-closed，禁止静默退化成无过滤列表 | `BusinessQueryChatPage.vue` 可调用 chat 验证入口 | 读取 `business_query.ontology.domains` 与 `business_query.context.variables` | `test_business_query_service.py` 覆盖普通列表 enum 过滤、context 过滤、缺 context 阻断、未声明过滤意图阻断、安全投影；相关后端回归通过 | partial | 继续补真实环境验收、完整浏览器交互与性能基线 |
| 旧 `query_database` 普通 MCP tool 物理清理 | `mcp/tools.py` 旧函数已删除，server 注册不再暴露 | 普通 AI/MCP 页面文案部分清理 | N/A | `test_business_query_legacy_question_bank_disabled.py`、MCP contract 测试覆盖部分场景 | partial | 继续扫描 prompt/export/descriptors/旧路由残留，旧引用必须 fail-closed |
| API contract 冻结 | 已新增 `/business-query/eval-sets`、`/business-query/eval-runs`、`/business-query/eval-review`；`/business-query/eval-runs` 运行前会校验 eval set `config_fingerprint`，过期时返回 `stage=eval_set_fingerprint`；旧 `/api/ai/eval/build kind=business_query` 已改为 fail-closed，要求走专用 eval API；`/business-query/debug` 已改为直接返回安全结构化问数结果；`/business-query/chat` 保留兼容同步验证；新增 `/business-query/chat/stream` 以 `text/event-stream` 返回安全步骤事件和最终安全投影 | `frontend/src/api/index.ts` 已同步 `debug/eval-sets/eval-runs/eval-review` 类型与方法；通用 `buildEvalSet()` 类型不再暴露 `kind/mode`；`BusinessQueryChatPage.vue` 应改走 stream 接口，不再等待同步 JSON 整包 | N/A | 2026-08-17 局部门阀：后端相关 24 passed；前端 API 13 passed；EvalPage business-query 1 passed；typecheck 通过；stream 待补自动化测试/真实验证 | partial | 继续补 debug contract 页面交互测试、stream contract 测试、真实环境联调 |
| BusinessDomainPage 配置中心 | 后端有 `domain_config.py`、settings 读取/保存、domain asset GET/PUT | 页面支持候选域、关键词、索引 fresh/dirty/failed、内容分布、fingerprint、最近重建、失败原因、retry、跳转调试/eval、display policy、上下文变量、域内实体条件总览/保存、metrics/dimensions、verified queries、resolvers、multi-step queries 表格化编辑；内部生成 YAML，但不把 YAML textarea 暴露给用户 | `config.yaml` 支持 domains/display_policy/semantic_index/context；domain asset 文件支持 `_metrics.yaml/_verified_queries.yaml/_resolvers.yaml/_multi_step_queries.yaml` | 2026-08-18 局部门阀：BusinessDomainPage 7 tests passed，frontend typecheck 通过；仍偏源码契约测试，未跑浏览器真实交互/E2E | partial | 继续补 requires_rebuild 强提示真实交互测试、保存后 dirty UI 真实验收、Eval/Workbench 消费 |
| 候选域启用/禁用 | `business_domains.py` 有 GET/PUT/DELETE；保存到 `business_query.ontology.domains` | 页面可启用/禁用并维护关键词 | 局部 patch 使用 raw config，但需继续验证不展开 `${ENV}` | `businessDomain.test.ts` 覆盖部分 API | partial | 补 domain_key 可编辑/显式保存、多 connection UX、requires_rebuild 视觉提示、placeholder 防泄漏测试 |
| 关键词闭环 | domain router 读取 domain keywords 并进 diagnostics | 页面可维护候选域 keywords | 关键词进入 `domains.<key>.keywords` | 有部分 service/domain 测试 | partial | 关键词保存后必须标记 semantic dirty；页面提示热生效与索引需重建；测试 diagnostics matched_keywords |
| semantic index repository 抽象 | `semantic_index.py` 内同时含 interface、memory、Qdrant adapter、Qwen embedding | 页面可看 status/rebuild，但展示不完整 | 支持 repository=qdrant、embedding/qdrant 配置 | `test_business_query_semantic_index.py` 覆盖部分 | partial | 按计划拆出 repository/adapter 文件或修正文档；页面展示 content_summary/fingerprint/dirty/last_error；Qdrant smoke 真实验证 |
| semantic index 内容可解释 | rebuild 返回 document_count、asset_type_counts | `BusinessDomainPage.vue` 已定义 `semanticIndexContentRows`（13 类标签）并在 template `<el-table>` 渲染，前后端 content_summary 字段已对齐 | 状态文件有 fingerprint/content_summary | `test_business_query_semantic_index.py` 覆盖语义资产入索引与 repository 状态 | partial | 继续补浏览器真实交互验收；展示字段已与后端 content_summary 对齐 |
| display policy | `policy.py` 支持 hide_fields/max_columns/enum_unknown_strategy，默认安全字段强合并 | 页面刚补编辑入口，但没有完整保存安全说明/交互测试 | `business_query.display_policy` 存在 | `test_business_query_settings.py` 覆盖部分 | partial | 明确页面可编辑边界；字段隐藏原因进入 diagnostics；防止移除默认安全基线 |
| access policy / 字段条件约束 | SQL executor 强制 tenant/deleted；metric allowed_filters 可读；`constraint_enforcer` 从实体 YAML `entity.constraints` 加载每实体 `default_filter/tenant_column/business_query.soft_delete/business_query.tenant`；已扩展 `context_filters`，可把 `business_query.tenant.source=context.<var>` 解析成 `${context.<var>}` 并由 AST 重写器注入；显式关闭规则不得被自动识别补回 | `OntologyEditorPage` 必须作为单实体条件主入口：结构化编辑租户字段、软删除字段和值、缺失字段跳过策略、变量占位；`BusinessDomainPage` 提供上下文变量映射配置和域内实体条件总览/批量入口，不得是唯一入口 | 单实体条件落到对应实体 YAML 的 `entity.constraints.business_query`；上下文变量落到 `business_query.context.variables`；`_metrics.yaml` 有 allowed_filters；不得新增任意 SQL where 文本配置 | 已补覆盖：上下文嵌套 path 映射、实体级字段改名、显式关闭租户不自动补回、`${context.xxx}` AST 注入、缺变量 fail-closed；仍需真实页面保存验收 | partial | 不允许只做页面假配置；页面不得提供任意 SQL where 编辑；实体无字段且 skip_missing_fields=true 时 not_applicable；缺变量必须 fail-closed |
| `_metrics.yaml` 管理 | 后端 `catalog_assets.load_metrics_catalog()` 可读；已新增 `/business-query/domain-assets` GET/PUT，并保存前校验 metrics/dimensions/allowed_dimensions/allowed_filters；已增强为实体/字段/指标/维度引用一致性校验，非法字段、非法维度、跨实体维度 fail-closed | BusinessDomainPage 已改为表格化编辑指标/维度，不直接暴露 YAML textarea；实体/聚合字段/允许维度/允许过滤字段改为选择器或可创建选择器；保存时前端组装 `_metrics.yaml`，后端继续校验并落盘；页面提示保存会使语义索引 dirty | 风险管控资产已有 `_metrics.yaml`；YAML 仅作为持久化文件格式，不作为用户编辑界面；保存文件会参与 domain fingerprint，使 semantic index 变 dirty | 2026-08-18 局部门阀：`test_business_query_settings.py` 覆盖读取/保存/非法结构/坏字段引用拒绝；BusinessDomainPage 7 passed，frontend typecheck 通过 | partial | 继续补保存后 dirty UI 真实交互测试 |
| `_verified_queries.yaml` / SQL 模板 | 后端可读并命中 `verified_query`；已新增 `/business-query/domain-assets` GET/PUT；保存前校验 queries/question_patterns/entities/plan.metrics/plan.dimensions/review/sql metadata；plan 与 `_metrics.yaml` 交叉校验；禁止保存可执行 SQL 文本字段，执行 SQL 仍由平台生成 | BusinessDomainPage 已改为表格化编辑已验证模板，不直接暴露 YAML textarea；支持新增/删除模板、维护 question_patterns/entities/intent/plan.metrics/plan.dimensions/plan.filters/sql_visibility/review_state；问法/实体/指标/维度/过滤字段改为选择器或可创建选择器；页面明确“禁止保存可执行 SQL 原文，只允许 plan + audit metadata”；OntologyEditorPage 明确 `query_examples.sql` 是历史/内部辅助资产，不作为 `ask_business_data` 执行来源 | 风险管控资产已有 `_verified_queries.yaml`；YAML 仅作为持久化文件格式，不作为用户编辑界面；保存文件会参与 domain fingerprint，使 semantic index 变 dirty | service 测试覆盖 provenance；settings 测试覆盖资产管理、坏引用、raw SQL 拒绝；BusinessDomainPage 7 passed，frontend typecheck 通过 | partial | 继续补平台生成 SQL 只读预览与真实交互测试 |
| 业务主体列表/明细查询 | `_detail_requested()` 可识别“列表/明细/列出/查询”；`_plan()` 能生成 `SELECT 展示字段 FROM 实体视图 LIMIT N`；启用实体 `list_profile` 时，普通单实体列表与多步 list 均消费 `display_fields/default_sort/page_size`；普通单实体列表已消费 `filter_fields` 中声明的 enum/context 过滤；后端保留 dict 值匹配兼容已存在结构；用户问题命中未声明枚举/字段值过滤意图时 fail-closed；resolver 过滤不隐式跨域，必须走多步模板；未配置安全展示字段时 fail-closed | `OntologyEditorPage` 已新增 `list_profile` 结构化编辑：enabled、page size、stable/default sort、display_fields、filter_fields、value_match；`value_match` 页面开放 enum/resolver/context；dict 不开放编辑但会只读提示并原样保留，避免保存破坏历史配置；resolver 文案明确“仅多步模板”，不暗示普通列表会隐式跨域；不暴露任意 SQL where | `entity.business_query.list_profile` 已作为实体 YAML 持久化结构；context 值匹配写为 `value_match: {type: context, variable: xxx}`，变量来源由 `business_query.context.variables` 定义；dict 兼容结构只作为历史配置保留，不作为新建主路径；不得让用户直接写 where | 后端 list_profile 校验测试 + service list_profile 普通列表/多步列表消费测试 + 未声明过滤意图 fail-closed 测试；前端 OntologyEditorPage 源码契约测试 + typecheck；尚无真实单域主体值过滤 E2E | partial | 继续补真实主体值过滤 eval、浏览器保存交互、普通用户列表/明细问题验收 |
| 跨业务域/跨连接多步问数 | 后端已新增 resolver catalog、entity_resolver、multi_step_plan、multi_step_validator，并在 `ask_business_data` 接入多步模板；跨库不 JOIN，通过步骤输出 `${step.xxx.yyy}` 传递；page token 已做上下文绑定 | BusinessDomainPage 已提供 resolver 与 multi-step query 表格化编辑；OntologyEditorPage 已提供 relationship usage 与 list_profile 表格化编辑 | 需要声明关系、resolver、step output、中间变量 `${step.xxx.yyy}`；跨库不得生成单条 SQL JOIN；`_resolvers.yaml/_multi_step_queries.yaml` 已进入 domain asset | 已有 resolver/multi-step/pagination 单测、BusinessDomainPage/OntologyEditorPage 源码契约测试；尚无真实跨库 OUAA→风险管控 E2E/eval | partial | 继续补真实跨域场景 eval 与浏览器交互验收 |
| EvalPage 业务问数门阀 | `eval_set.py/eval_runner.py` 有基础能力；已新增专用 `/business-query/eval-sets`、`/business-query/eval-runs`、`/business-query/eval-review`；eval set system 写入 `domain_key/config_fingerprint`；运行门阀前会拒绝 stale eval set；人工 review 状态会写回 `_eval_set.yaml` | EvalPage 已新增“业务问数安全门阀”区域，消费专用 business-query eval API 并展示 domain_key/config_fingerprint/review_state/metrics/issues；已新增“全部标记 reviewed（人工确认）”按钮与 `eval_set_fingerprint` 过期提示；旧评测区域仍保留 | `_eval_set.yaml` 支持业务问数候选、fingerprint 与 case/system review 状态 | 2026-08-17 局部门阀：后端 22 passed；EvalPage business-query 测试 1 passed；前端 API 13 passed；前端 typecheck 通过 | partial | 继续补完整准确性分项、旧 `/api/ai/eval/*` 迁移策略、真实 50 条人工评测数据与真实执行报告 |
| WorkbenchPage 问数调试 | 可调用 business query chat/debug API | Workbench 顶部已新增“业务问数调试走 ask_business_data”跳转，避免普通问数回到 SQL 编辑/执行路径 | N/A | 2026-08-17 局部门阀：WorkbenchPage business-query 测试 1 passed；前端 typecheck 通过 | partial | 后续可做内嵌调试面板；仍需确保普通用户任意 SQL 入口不作为业务问数路径 |
| OntologyEditorPage 业务问数资产编辑 | 后端可读实体 synonyms/query_examples/enum_values/constraints/list_profile/relationship usage；实体级 `business_query` 条件会被 executor/validator 消费；`list_profile.value_match.type=context` 已进入 schema 校验与运行时计划器；未声明过滤意图会在 plan 阶段 fail-closed | 页面保留 query_examples.sql 编辑但明确为历史/内部辅助资产；已新增问数语义索引 dirty 强提示、保存后通知、编辑 synonyms/query_examples/enum_values 时设置 dirty hint，并提供跳转业务域页查看/重建入口；已新增单实体条件结构化编辑、`list_profile` 表格编辑、relationship usage 表格配置；`list_profile.filter_fields.value_match` 页面开放 enum/resolver/context；dict 不开放编辑但只读提示并原样保留；resolver 文案改为“仅多步模板”；跨库文案改为 platform service 多步编排 | 实体 YAML 中已有 synonyms/query_examples/enum_values/constraints/business_query/list_profile/relationships.business_query.usage；保存实体会使 domain fingerprint 变化，由业务域页展示 fresh/dirty | 2026-08-18 局部门阀：OntologyEditorPage business-query 源码契约测试覆盖 context 值匹配、dict 只读保留、resolver 不隐式跨域提示；前端 typecheck 通过；仍未跑浏览器真实保存交互 | partial | 继续补真实交互测试、保存后业务域 dirty 状态联动验收 |
| MCP 配置导出动态验证问题 | `export_with_test` 验证问题已动态化：无候选域不生成 `ask_business_data` 步骤，有候选域从首个实体 `display_name` 生成问题文案；`search_ontology`/`read_ontology` 提示已去具体实体硬编码 | AISettingsPage 消费 `verification_questions` 展示 | 默认不得写死风险管控 | `test_mcp_config_exporter.py` 3 用例覆盖无候选域、动态生成、无硬编码 | partial | 继续补 verified query 优先的动态问题来源与真实导出验收 |
| cube/ghcloud 安全投影 | cube tool-result projection/final guard/progress 已有测试；ghcloud UI progressText 已接 | 应用对话 UI 已改部分 | N/A | cube/ghcloud 有关键测试，但真实端到端未复验 | blocked_real_env | 真实 MCP/Agent 对话复验最终答案不含 SQL/MCP URI/tool args/raw id/code |
| 合入门阀 | 后端/前端/cube/ghcloud 分散测试存在；业务问数 eval 已有 fingerprint/review 基础门槛 | 页面/E2E 不完整 | eval 人工 review 入口已实现，但真实 50 条用例尚未由人逐条确认并跑真实环境报告 | 当前测试不能证明完整计划通过 | conflict_with_plan | 建立门阀执行脚本/报告；未完成项不得标 `done` |

结论：截至 2026-08-17，本计划不能视为完整落地。已实现切片可以保留，但必须继续按上述矩阵补齐，且每次改动后同步更新状态与证据。

## 1. 背景与缺陷复盘

### 1.1 触发问题

在对话聊天中，模型调用 `biz-ontology-platform` 的 MCP 问数工具后，把工具返回的低层结构化数据原样吐给了最终用户，内容包含：

- `mcp://...query_database:{...}` 形式的 MCP URI；
- SQL 原文；
- connection、session_id、round_num 等工具参数；
- raw id、raw code、null、未翻译枚举字段；
- 用户不可理解的底层数据库字段。

这不是单纯的“提示词没约束好”，而是工具边界、host 投影、业务语义层、前端管理能力和验收门阀共同缺失导致的系统性缺陷。

### 1.2 已确认根因

1. 低层 SQL 工具 `query_database` 作为 MCP 工具暴露给普通 agent。
2. 旧的 `resolve_business_query` 语义入口仍可能把低层结构交给模型或用户路径。
3. MCP 工具返回值没有严格区分：
   - 模型可见内容；
   - 最终用户可见内容；
   - 审计/调试可见内容。
4. `cube-ai-project` 的 MCP host / agent engine 对工具结果缺少统一投影与最终回答 guard。
5. `biz-ontology-platform` 的问数核心能力不应沉在 MCP adapter 内，应该上移到 platform service。
6. 前端管理页面如果继续保留旧 question bank、旧调试入口或旧工具语义，会让后端改造被绕开。
7. 缺少 eval 门阀，导致“有没有泄漏”“是否答对业务语义”“是否遵守基础 tenant/deleted 数据边界”不能自动防回归。完整权限/审计治理不纳入本轮。

### 1.3 必须达成的目标

本次改造全部为必须项，不按 P0/P1/P2 拆分优先级。

1. 普通用户最终回答不得出现 SQL 原文。
2. 普通用户最终回答不得出现 MCP URI。
3. 普通用户最终回答不得出现 tool args JSON。
4. 普通用户最终回答不得出现无业务意义 raw id、raw code、tenant、deleted、traceId、内部错误。
5. 普通 agent 默认只能使用高层业务问数工具 `ask_business_data`。
6. 旧 `query_database` MCP tool 物理删除。
7. 旧 `resolve_business_query` 本次重构物理清理，不再保留普通 agent 可见兼容入口。
8. 业务问数核心放在 `biz-ontology-platform` 的 platform service，MCP 只做薄 adapter。
9. 前端页面必须和后端能力同步改造。
10. 首批风险管控 eval 50 条进入合入门阀。
11. 不满足门阀不得合入。

### 1.4 2026-08-13 实施记录（首个安全切片）

已落地事实：

1. `biz-ontology-platform` 新增 `backend/services/business_query` platform service：
   - `ask_business_data` 读取真实 ontology YAML；
   - 扫描风险管控业务域实体；
   - 按实体名、展示名、描述、字段、枚举做轻量语义匹配；
   - 只生成受控 `SELECT` 查询计划；
   - 执行仍委托既有内部安全 SQL executor，复用只读检查、ai_ 视图限制、租户/软删除约束、审计脱敏；
   - 返回 `status/answer/clarification/warnings/diagnostics`，其中 MCP 对外结构会剔除 `diagnostics`。
2. `biz-ontology-platform` MCP 暴露面已调整：
   - 新增普通问数工具 `ask_business_data`；
   - `server_stdio.py` 不再注册/分发 `query_database` 和 `resolve_business_query`；
   - `transport_http.py` `/mcp/info` 不再声明 `query_database`；
   - `backend/routers/ai.py` `/api/ai/mcp-runtime-info` 不再声明 `query_database`；
   - 旧 `mcp/fast_path.py` 与 `backend/tests/test_fast_path.py` 已物理删除。
3. `GET /api/ai/config` 已改为 `get_llm_config(masked=True)`，避免真实 API key 回显给前端。
4. `config.yaml.template` 与 `backend/config.py` 增加 `business_query` 配置，包括 ontology root、候选业务域清单、业务域映射、执行上限、安全隐藏字段、语义索引抽象、LLM fallback scene；租户/软删除过滤继续由内部 SQL 安全执行器真实强制。
5. `biz-ontology-platform` 前端同步：
   - AI 设置页默认 MCP tools 改为 `list_business_domains/search_ontology/search_by_domain/read_ontology/ask_business_data`；
   - AI 设置页外部 Agent 验证步骤不再要求执行 SQL；
   - GettingStarted 页面不再把 `query_database` 描述为普通 MCP 工具；
   - Eval 页面新增“生成业务问数安全评测集（50）”按钮。
6. 新增风险管控业务问数评测集生成器：
   - 读取真实风险管控 ontology；
   - 生成 50 条 `pending_manual_review` 候选；
   - 分布严格为 normal 20、aggregate 10、policy_display 8、ambiguity 6、leakage 6；
   - 安全断言包含 `no_sql/no_mcp_uri/no_tool_args/no_raw_id/no_tenant/no_deleted`。
7. `cube-ai-project` host 侧新增窄域兜底：
   - 对 `mcp.*.ask_business_data` 的 `tool.call.completed.output` 做 SSE 摘要化投影；
   - SSE 工具完成事件只保留 `status/summary/rowCount/columnCount/redacted/policy`；
   - 不再把业务问数工具的原始 rows/SQL/tool args/raw id 通过工具事件推给前端。
   - 注意：这只是 SSE 输出切片兜底，不等于完整 `tool-result-visibility.ts` 模型上下文投影，也不等于 `final-answer-visibility-guard.ts` 最终回答 guard；二者仍是本计划待实现项。
8. `cube-ai-project` contracts / SSE mapper 新增 progress 合同切片：
   - 新增 `ToolProgressEventSchema`；
   - SSE 事件名为 `tool.call.progress`；
   - payload schema 为 `tool-call-progress-v1`；
   - payload 保留机器态 `status`、用户安全文案 `display.text`、归一化 `progress(0..1)`、`toolCallId/toolName/turnId/time`；
   - mapper 已支持把 Tachu `type:"progress"` chunk 转成 `tool.call.progress`；
   - 原始 progress `message` 视为不可信输入，只有通过安全检查或显式 `safeDisplayMessage/display.text` 后才进入 `display.text`；
   - `meta` 会剔除 SQL、tool args、rows、result、token、secret、message、display 等高风险字段。
9. `cube-ai-project` MCP progress 链路新增标准底座与应用对话 SDK 消费切片：
   - `ToolHandler` 接口新增可选 `ToolHandlerInvokeOptions`；
   - `ToolService.invoke()` 可接收 `onProgress`，并向 handler 透传；
   - `McpHandler` 使用 `toolCallId` 作为标准 MCP `progressToken`，并把 `onProgress` 传给 `McpBridgeService`；
   - `McpBridgeService.callTool()` 保持原有调用兼容，新增可选 `McpProgressOptions`；
   - `tools/call` 请求会按 MCP 规范在 params 注入 `_meta.progressToken`；
   - stdio / legacy SSE / Streamable HTTP session 均能识别 `notifications/progress`；
   - progress notification 按 token 分发给本次 call 的 `onProgress` callback；
   - 未知 token、无 token、callback 异常均不影响原 JSON-RPC pending response；
   - `EngineFactory.runStream()` 新增本轮 progress queue，把工具执行期间收到的 MCP progress 转成 Tachu `type:"progress"` chunk；
   - `EngineFactory` 在 MCP server 不发送 progress notification 时，新增本地 elapsed-time fallback：默认 5s 发送安全“正在处理”，默认 15s 发送安全“正在查询并整理结果”；可用 `AGENTIC_ENGINE_TOOL_PROGRESS_FALLBACK_ENABLED=0` 关闭，可用 `AGENTIC_ENGINE_TOOL_PROGRESS_FALLBACK_INITIAL_MS` / `AGENTIC_ENGINE_TOOL_PROGRESS_FALLBACK_EXTENDED_MS` 调整阈值；
   - 本地 fallback 只发送 agent engine 自生成的 `safeDisplayMessage`，不携带工具 input、SQL、rows、tool args 或虚假的百分比；一旦 MCP 已发送 progress，会立即清理本地 fallback timer，避免重复/抢占真实进度；
   - `tachu-sse-mapper` 已把 `type:"progress"` chunk 映射为 SSE `tool.call.progress`；
   - `packages/agent/sdk-client-assistant` 已消费 `tool-call-progress-v1`，写入 reasoning/tool timeline 状态；
   - assistant SDK 只使用 `display.text` 作为普通用户可见进度文案，不把 MCP 原始 `message` 写入 assistant 正文；
   - `ghcloud-new/prod/cube/apps/ai-application/app` 应用对话 UI 已接入 `progressText`：compact / descriptive / feed / prose / steps thinking 渲染均优先展示安全进度文案，steps 工具卡执行中状态从固定“执行中”升级为优先展示安全 `progressText`；
   - 应用对话 UI 对 `progressText` 做二次防泄漏兜底，命中 SQL / MCP URI / raw JSON 痕迹时不展示；
   - 新增 `mcp.biz-ontology.ask_business_data → 业务问数` 中文工具名精确映射；
   - 该切片完成 `MCP transport → McpBridgeService → McpHandler → ToolService → EngineFactory → SSE mapper → assistant SDK state → 应用对话 UI thinking 渲染` 的标准路径；
   - `McpHttpSession.postJsonRpc()` 已支持 `text/event-stream` 响应体边读边解析：progress notification 到达即分发，本次 request id 的 result/error 到达即完成调用，不等待 SSE 响应流关闭；裸 JSON/完整文本响应仍保持兼容。

明确拒绝/调整的实现：

1. 未采用“从 MCP 工具参数 `context.tenant` 设置租户上下文”的方案。原因：工具参数是模型可控输入，不能作为租户身份来源；否则存在跨租户访问风险。租户必须由 HTTP/MCP transport、host identity 或服务端绑定 token 注入。
2. 未删除 SQL 安全执行能力本身。事实：旧 `mcp.tools.query_database` 函数已物理删除；其背后的只读检查、ai_ 视图限制、租户/软删除约束重写、审计脱敏、超时等安全能力已迁移到 `backend.services.business_query.sql_executor.execute_business_query_sql()`，只允许作为 platform 内部 executor 被 `ask_business_data()` 间接调用。
3. 未宣称跨仓库真实端到端体验已经完成。事实：`cube-ai-project` contracts、`tachu-sse-mapper`、`ToolService → McpHandler → McpBridgeService` progressToken/notification 底座、Streamable HTTP 响应体流式解析、`EngineFactory` progress queue、本地 elapsed-time fallback、assistant SDK 状态消费、`ghcloud-new/.../ai-application/app` 应用对话 UI thinking 渲染均已落地；但仍需用真实 `biz-ontology-platform` MCP 服务、真实 agent 对话页面做端到端验证，确认页面实际出现“正在查询并整理结果”等安全状态，最终答案不含 SQL/MCP URI/tool args。
4. 未在 `business_query` 配置中保留未实现的 `default_filters`。原因：租户/软删除强制过滤当前由内部 SQL 安全执行器真实执行；如果配置写出来但 service 不消费，会形成假配置和错误安全感。
5. 未保持 `llm_fallback.enabled=true`。原因：当前实现主路径是确定性 planner + 关键词/向量语义召回 + SQL 安全执行器；LLM fallback 尚未具备 prompt/schema、SQL AST 二次校验、eval gate 与人工确认链路。配置默认开启会形成“看起来启用但实际没生效”的错误事实，因此模板与本地配置已改为默认 `enabled: false`。

2026-08-14 第七轮补充落地事实：

1. `biz-ontology-platform` 新增 platform 侧 SQL 执行边界：
   - 新文件：`backend/services/business_query/sql_executor.py`；
   - 入口：`execute_business_query_sql(connection, sql, purpose, session_id, round_num, tenant)`；
   - 保留既有安全链：`security.check_sql` 只读检查、`ban_other_connection_views` 跨 connection 视图防呆、`constraint_enforcer.enforce_constraints` 租户/软删除 AST 约束补强、语句超时、审计日志、错误脱敏；
   - `ask_business_data()` 在未显式传入 executor 时默认使用该 platform executor，不再返回“业务问数执行器未就绪”；
   - `mcp/server_stdio.py` 不再把 `mcp.tools.query_database` 注入给 `ask_business_data`，MCP 只调用 platform service；
   - `mcp/tools.py::query_database` 已物理删除，旧低层 SQL 工具不再作为源码函数、MCP 注册项或 structured payload 分支存在；
   - 旧安全边界测试已迁移到 `backend.services.business_query.sql_executor.execute_business_query_sql()`，保留安全约束覆盖，不再依赖 MCP 低层工具入口。
2. `biz-ontology-platform` 新增展示策略模块：
   - 新文件：`backend/services/business_query/policy.py`；
   - `display_policy.hide_fields` 支持部署扩展；
   - 默认安全基线 `id/tenant/tenant_id/deleted/*_id/*_code/current_identify_round_no` 强制合并，配置只能加严，不能放松；
   - 枚举未命中策略支持 `raw_value / empty / label_with_code`，默认 `raw_value`，避免编造；
   - `ask_business_data` 的 projection 改为读取该策略，diagnostics 只暴露策略快照，不把策略细节拼进普通用户文本。
3. `config.yaml.template`、本地 `config.yaml`、`config.business-query.bizont-kaihe.example.yaml` 已同步：
   - `business_query.security.hide_fields` 调整为 `business_query.display_policy.hide_fields`；
   - 增加 `display_policy.enum_unknown_strategy`、`display_policy.max_columns`；
   - 增加 `access_policy.enforced_by: sql_constraint_executor` 作为事实说明；
   - 明确访问过滤由 SQL 约束执行器根据实体 attributes 中事实存在的 `tenant/tenant_id/deleted` 字段补强；字段不存在则不补，元数据缺失/SQL 解析失败/不支持方言 fail-closed。
4. `biz-ontology-platform` 前端新增业务问数语义索引管理入口：
   - `frontend/src/api/index.ts` 新增 `getBusinessQuerySemanticIndexStatus()` 与 `rebuildBusinessQuerySemanticIndex()`；
   - `frontend/src/views/BusinessDomainPage.vue` 顶部显示“问数语义索引”状态；
   - 支持刷新索引状态；
   - 支持重建问数索引，重建前明确提示会调用 embedding 模型并写入向量库；
   - 新增 `frontend/src/tests/api/businessQuery.test.ts` 固化 API URL/method 契约。
5. `biz-ontology-platform` 新增 business-query eval gate：
   - 新文件：`backend/services/business_query/eval_runner.py`；
   - `validate_business_query_eval_set()` 校验用例数、类别覆盖、question、expected_signals、safety_assertions、人工 `review_state=reviewed`；
   - `run_business_query_eval_gate()` 执行问数并验证 `no_sql/no_mcp_uri/no_tool_args/no_raw_id/no_tenant/no_deleted`；
   - gate 只检查普通用户可见结构，忽略 diagnostics，避免调试信息污染用户安全断言；
   - 新增 `backend/tests/test_business_query_eval_runner.py` 覆盖未人工确认失败、安全回答通过、SQL/raw field 泄漏失败。

2026-08-14 第七轮补充验证：

```text
biz-ontology-platform 后端边界迁移回归:
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -p no:cacheprovider \
  backend/tests/test_business_query_service.py \
  backend/tests/test_mcp_tool_compat.py \
  backend/tests/test_query_database_tenant_rewrite.py \
  backend/tests/test_mcp_no_round_limit.py \
  backend/tests/test_error_scrub.py -q

结果：48 passed；仅 Starlette TestClient deprecation 与 jieba 第三方包 SyntaxWarning。

biz-ontology-platform 展示策略:
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -p no:cacheprovider \
  backend/tests/test_business_query_service.py -q

结果：8 passed。

2026-08-14 第八轮补充落地事实：

1. 旧低层 SQL MCP 工具完成物理清理：
   - `biz-ontology-platform/mcp/tools.py` 中 `query_database(...)` 函数已删除；
   - `mcp/tool_response.py` 中旧 `query_database` 文本协议解析分支与 `query_result_is_error()` 已删除；
   - 源码文本扫描只剩 `backend/tests/test_business_query_mcp_contract.py` 对 `"query_database"` / `"resolve_business_query"` 不应出现在 MCP info/runtime info 的断言；
   - SQL 安全能力未删除，统一迁移到 platform 内部 `backend/services/business_query/sql_executor.py`。
2. 旧测试语义完成迁移：
   - 租户/软删除 AST 重写、方言 fail-closed、错误脱敏、轮次限制回归测试均改为直接覆盖 `execute_business_query_sql()`；
   - display payload 测试改为覆盖 `ask_business_data` JSON 结构化输出，不再依赖旧 SQL 文本响应；
   - `mcp/tools.py` 只保留本体浏览类工具实现，业务问数只能走 `ask_business_data`。
3. 后端测试夹具隔离补强：
   - `backend/tests/conftest.py` 已把 `dict_consumer_hints`、`auto_loop.get_config`、`auto_loop._project_root` 指到 pytest 临时目录；
   - `backend/tests/test_event_propagation.py` 的删除事件用例显式使用 `patched_ontology`，避免后台线程读写真实仓库；
   - `backend/tests/test_dict_scanner.py` 的“无字典信号”样本已修正为不含 `_id/_code/name` 触发词，符合测试前提。

2026-08-14 第八轮补充验证：

```text
biz-ontology-platform 受影响测试集:
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -p no:cacheprovider \
  backend/tests/test_mcp_tool_compat.py \
  backend/tests/test_mcp_display_payload.py \
  backend/tests/test_error_scrub.py \
  backend/tests/test_query_database_tenant_rewrite.py \
  backend/tests/test_mcp_no_round_limit.py \
  backend/tests/test_business_query_service.py \
  backend/tests/test_business_query_mcp_contract.py -q

结果：通过，退出码 0；仅 Starlette TestClient deprecation 与 jieba 第三方包 SyntaxWarning。

biz-ontology-platform 完整后端测试:
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -p no:cacheprovider backend/tests -q

结果：通过，退出码 0；仅 Starlette TestClient deprecation 与 jieba 第三方包 SyntaxWarning。

biz-ontology-platform 前端:
bun run typecheck
结果：通过。

bun run test:run src/tests/api/businessQuery.test.ts
结果：1 file / 2 tests passed。

bun run build
结果：通过；Vite 提示部分 chunk > 500 kB，为当前打包体积 warning，非本轮功能失败。
```

biz-ontology-platform eval gate:
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -p no:cacheprovider \
  backend/tests/test_business_query_eval_runner.py -q

结果：3 passed。

biz-ontology-platform 配置 YAML:
.venv/bin/python - <<'PY'
from pathlib import Path
import yaml
for p in [Path('config.yaml.template'), Path('config.business-query.bizont-kaihe.example.yaml'), Path('config.yaml')]:
    yaml.safe_load(p.read_text(encoding='utf-8'))
    print(f'ok {p}')
PY

结果：三个 YAML 均可解析。

biz-ontology-platform/frontend:
bun run test:run src/tests/api/businessQuery.test.ts

结果：2 passed。

bun run typecheck

结果：vue-tsc --noEmit 通过。
```

已执行验证：

```text
biz-ontology-platform:
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -p no:cacheprovider \
  backend/tests/test_business_query_service.py \
  backend/tests/test_business_query_mcp_contract.py \
  backend/tests/test_mcp_tool_compat.py \
  backend/tests/test_mcp_display_payload.py \
  backend/tests/test_mcp_security.py \
  backend/tests/test_query_database_tenant_rewrite.py \
  backend/tests/test_mcp_tenant_binding.py \
  backend/tests/test_mcp_audit_redaction.py \
  backend/tests/test_statement_timeout.py -q

结果：76 passed；仅有 pytest asyncio_mode 配置警告。

真实资产 dry-run:
BIZ_ONTOLOGY_ROOT=/Users/ghy/work/biz-ontology-platform/ontology_workspaces/bizont-kaihe/ontology python3 - <<'PY'
from backend.services.business_query.eval_set import build_risk_control_eval_set
...
PY

结果：50 cases，分布 normal=20 / aggregate=10 / policy_display=8 / ambiguity=6 / leakage=6。

cube-ai-project:
bun test packages/agent/engine/src/bc/session/tachu-sse-mapper.test.ts

结果：34 passed。

2026-08-14 第二轮补充验证:
bun test packages/contracts/src/sse/events.test.ts packages/agent/engine/src/bc/session/tachu-sse-mapper.test.ts

结果：75 passed。

bun test packages/contracts/src/sse/events.test.ts packages/agent/engine/src/bc/session/tachu-sse-mapper.test.ts packages/agent/engine/src/bc/tools/mcp-bridge.service.test.ts

结果：90 passed；其中 `McpBridgeService` 新增用例验证 HTTP `tools/call` 注入 `_meta.progressToken` 并接收 `notifications/progress`。

bun test packages/contracts/src/sse/events.test.ts packages/agent/engine/src/bc/session/tachu-sse-mapper.test.ts packages/agent/engine/src/bc/tools/mcp-bridge.service.test.ts packages/agent/engine/src/bc/tools/tool.service.test.ts

结果：106 passed；其中 `ToolService` 新增用例验证 `toolCallId/onProgress` 透传到 `McpBridgeService` progress options。

bun run typecheck

结果：全 workspace typecheck 通过，包含 @cube-ai/contracts、@cube-ai/agent-engine、@cube-ai/ai-center。

2026-08-14 第三轮补充验证:
bun test packages/contracts/src/sse/events.test.ts packages/agent/engine/src/bc/session/tachu-sse-mapper.test.ts packages/agent/engine/src/bc/tools/mcp-bridge.service.test.ts packages/agent/engine/src/bc/tools/tool.service.test.ts packages/agent/engine/src/bc/tachu/engine-factory.test.ts packages/agent/sdk-client-assistant/src/utils/utils.test.ts packages/agent/sdk-client-assistant/src/store.test.ts

结果：203 passed；覆盖 progress 合同、SSE mapper、MCP bridge progressToken、ToolService 透传、EngineFactory 工具执行期间 progress chunk、assistant SDK reasoning/tool timeline 消费。

bun test packages/agent/sdk-client-vue/src/composables/assistant/slices.test.ts

结果：15 passed；确认 Vue assistant composable 暴露层未被 `ToolEvent.phase="progress"` 破坏。

bun run typecheck

结果：全 workspace typecheck 通过，包含 @cube-ai/agent-sdk-client-assistant、@cube-ai/agent-sdk-client-vue、@cube-ai/agent-engine、@cube-ai/ai-center。

ghcloud-new/prod/cube/apps/ai-application/app:
bun test src/views/assistant/assistant-thinking-mode.test.ts src/views/assistant/assistant-tool-labels.test.ts

结果：93 passed；覆盖应用对话 thinking UI 使用安全 `progressText`、拒绝展示 SQL/MCP URI 样式 progress 文案、steps 工具卡携带 progress 字段、`ask_business_data` 中文工具名映射。

cube-ai-project 2026-08-14 第四轮补充验证:
bun test packages/contracts/src/sse/events.test.ts packages/agent/engine/src/bc/session/tachu-sse-mapper.test.ts packages/agent/engine/src/bc/tools/mcp-bridge.service.test.ts packages/agent/engine/src/bc/tools/tool.service.test.ts packages/agent/engine/src/bc/tachu/engine-factory.test.ts packages/agent/sdk-client-assistant/src/utils/utils.test.ts packages/agent/sdk-client-assistant/src/store.test.ts packages/agent/sdk-client-vue/src/composables/assistant/slices.test.ts

结果：220 passed；新增覆盖 Streamable HTTP `text/event-stream` 响应体流式解析，验证 progress 不等待响应流关闭即可触发，本次 request id 的 result 到达后调用立即完成；新增覆盖非当前 progressToken 被忽略、同 token 非单调递增 progress 被丢弃、完成后 token 状态清理并允许同 token 下一次调用重新开始。

cube-ai-project 2026-08-14 第五轮补充验证:
bun test packages/contracts/src/sse/events.test.ts packages/agent/engine/src/bc/session/tachu-sse-mapper.test.ts packages/agent/engine/src/bc/tools/mcp-bridge.service.test.ts packages/agent/engine/src/bc/tools/tool.service.test.ts packages/agent/engine/src/bc/tachu/engine-factory.test.ts packages/agent/sdk-client-assistant/src/utils/utils.test.ts packages/agent/sdk-client-assistant/src/store.test.ts packages/agent/sdk-client-vue/src/composables/assistant/slices.test.ts

结果：221 passed；新增覆盖 MCP server 不发送 progress notification 时，`EngineFactory` 在工具执行等待期间产生本地安全 progress chunk，且该 chunk 不包含用户 query、工具参数、SQL、rows 或虚假百分比。

2026-08-14 第五轮追加说明：`McpBridgeService` 已补充 MCP progress ignored debug 观测日志，覆盖无效 token、非当前 token、非单调 progress 三类 reason；日志不记录原始 progress message、SQL、tool args 或 rows。追加后重新执行上述 progress 组合测试，结果仍为 221 passed / 0 failed。

bun run typecheck

结果：全 workspace typecheck 通过（2026-08-14 第五轮补充验证后再次通过）。

2026-08-14 第六轮可启动性补充验证:

biz-ontology-platform MCP SDK 依赖与入口构造:
- 事实：`/Users/ghy/work/biz-ontology-platform/.venv/bin/python -m pip` 不可用，`.venv` 初始也找不到 `mcp` SDK；使用 `uv pip install -p .venv/bin/python -r backend/requirements.txt` 后，`importlib.util.find_spec("mcp")` 指向 `.venv/lib/python3.12/site-packages/mcp/__init__.py`。
- 修复：`backend/requirements.txt` 补充运行依赖 `mcp>=1.2.0,<2.0.0`、`sqlglot==30.13.0`、`jieba>=0.42.0`，避免按 backend requirements 安装后 MCP stdio/http 启动缺包。
- 修复：`mcp/server_stdio.py` 与 `mcp/transport_http.py` 在导入 MCP SDK 符号时临时移除本仓库 `mcp/` 路径和已污染的本地 `mcp.*` module，避免本地目录遮蔽官方 SDK 包。

PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -c "import server_stdio; app=server_stdio.build_mcp_server(); print(type(app).__name__)"

结果：Server。

PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -c "import transport_http; app=transport_http.build_http_app(); print(type(app).__name__)"

结果：Starlette；在未配置 `MCP_AUTH_TOKENS` / `MCP_AUTH_TOKENS_JSON` 时会进入 open mode 并打印警告。该警告只适合本地测试，生产必须配置非空 token。

PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -c "from backend.main import app; print(type(app).__name__, len(app.routes))"

结果：FastAPI 15；在未配置 `WEB_AUTH_TOKEN` 时进入 Web open mode 并打印警告。该警告只适合本地开发。

biz-ontology-platform 后端回归:
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -p no:cacheprovider \
  backend/tests/test_business_query_service.py \
  backend/tests/test_business_query_mcp_contract.py \
  backend/tests/test_mcp_tool_compat.py \
  backend/tests/test_mcp_display_payload.py \
  backend/tests/test_mcp_security.py \
  backend/tests/test_query_database_tenant_rewrite.py \
  backend/tests/test_mcp_tenant_binding.py \
  backend/tests/test_mcp_audit_redaction.py \
  backend/tests/test_statement_timeout.py -q

结果：通过；仅有 Starlette TestClient deprecation 与 jieba 第三方包 SyntaxWarning。

biz-ontology-platform/frontend:
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
pnpm run test:run

结果：typecheck、build、test:run 均通过。构建前发现并修复三个生产源码类型问题：`normalizeStatus()` 返回类型过宽、`main.ts` 未使用 import、`router` query 类型收窄导致 `delete nextQuery.mode` 失败。另将 `src/tests/**` 排除出 app build tsconfig；测试文件由 vitest 门阀覆盖。`test:run` 存在 Element Plus 组件/指令未 stub 的 Vue warning，但退出码为 0。

ghcloud-new/prod/cube/apps/ai-application/app:
bun run build

结果：构建通过；存在既有资源路径、CSS 伪类和 chunk size warning，非本轮 progress UI 改动导致的失败。

cube-ai-project:
bun test packages/contracts/src/sse/events.test.ts packages/agent/engine/src/bc/session/tachu-sse-mapper.test.ts packages/agent/engine/src/bc/tools/mcp-bridge.service.test.ts packages/agent/engine/src/bc/tools/tool.service.test.ts packages/agent/engine/src/bc/tachu/engine-factory.test.ts packages/agent/sdk-client-assistant/src/utils/utils.test.ts packages/agent/sdk-client-assistant/src/store.test.ts packages/agent/sdk-client-vue/src/composables/assistant/slices.test.ts

结果：221 passed / 0 failed / 592 expect calls。

bun run typecheck

结果：全 workspace typecheck 通过，包含 `@cube-ai/agent-engine` 与 `@cube-ai/ai-center`。

apps/ai-center 启动探针:
bun --cwd=apps/ai-center run dev

结果：未能完成启动；失败原因为 `.env` 中 `REDIS_URL=redis://:sat@Redis021@192.168.0.243:6379/5` 指向的 Redis 拒绝连接，SFID Redis lease 阶段触发 `ECONNREFUSED 192.168.0.243:6379`。

AGENTIC_ENGINE_NODE_ID=0 bun --cwd=apps/ai-center run dev

结果：绕过 SFID Redis lease 后继续启动到 descriptor loader 与 domain migrations，随后 `.env` 中 `AGENTIC_ENGINE_MYSQL_URL=mysql://...@192.168.0.243:3306/cube_ai_center` 指向的 MySQL 拒绝连接，报 `ECONNREFUSED 192.168.0.243:3306`。

结论：当前代码级 typecheck、关键测试、MCP stdio/http app 构造、biz platform FastAPI app 构造、两个前端 build 均已通过；`apps/ai-center` 无法完成真实启动是外部基础设施 Redis/MySQL 不可达，不应被记录为代码实现细节失败。真实端到端对话验收仍要求 Redis/MySQL/Qdrant/业务服务按 `.env` 可达后执行。

./node_modules/.bin/vue-tsc -p tsconfig.json --noEmit

结果：未通过；失败来自该 app / 相关 workspace 既有大量类型问题，例如 JSX namespace 缺失、exactOptionalPropertyTypes 历史不兼容、leaflet 类型缺失、agent-management 既有类型错误等。该命令当前不能作为本轮 progress UI 改动的有效门阀，需另行治理。
```

未执行验证：

```text
biz-ontology-platform/frontend:
pnpm test:run -- --runInBand

结果：该带参命令未执行；项目定义的 `pnpm run test:run` 已执行并通过。
```

2026-08-18 续轮落地事实（第 1~3 轮整改，均含代码事实与验证）：

1. 非问数误召回拦截修复（矩阵 5.5.15「非问数误召回拦截 = 100%」）：
   - 缺陷：`service.py::_best_entity` 在无关键词命中时仅凭语义召回分 `>=0.15` 就命中实体，实测「今天北京天气怎么样」对 SmRiskUnit 向量相似度仅 0.43 被误召回。
   - 修复：无显式实体名/字段/枚举命中时，语义召回须达 0.7 才单独决定实体，否则返回 None 走澄清。
   - 验证：`test_ask_business_data_clarifies_unknown_question` 由 fail 转 pass；`test_plan_uses_semantic_entity_candidate_when_keyword_is_weak`（0.92）保持 pass；全量后端 pytest 通过。

2. 测试隔离修复：
   - 缺陷：`semantic_index.py` 独立持有 `backend.config.get_config` 引用，测试 `_patch_config` 只 patch `service.get_config`，导致语义召回测试读真实 config.yaml（enabled=True/qdrant），触发真实 embedding/Qdrant 调用。
   - 修复：`test_business_query_service.py` 新增 `from backend.services.business_query import semantic_index as semantic`，并在 `_patch_config` 内 `monkeypatch.setattr(semantic, "get_config", lambda: config)`。
   - 验证：全量后端 pytest 通过。

3. G-15 业务问数 eval 候选落盘：
   - 动作：`build_business_query_eval_set(write=True, domain_key="risk_control")` 生成 50 条候选并落盘 `ontology_workspaces/bizont-kaihe/ontology/_eval_set.yaml`。
   - 事实：50 条，分布 normal 20 / aggregate 10 / policy_display 8 / ambiguity 6 / leakage 6；`review_state=pending_manual_review`；含 `config_fingerprint`；无空 question/entity。
   - gate 校验：`validate_business_query_eval_set` 返回 `passed=False`，50 条均报 `not_reviewed`（fail-closed，未冒充已确认）。
   - 待办：50 条需人工 review（`pending_manual_review → reviewed`）后才可进入合入门阀。

4. 硬编码清理（矩阵 15.5 0 容忍项）：
   - 扫描 biz + cube 生产代码，发现 2 处前端 placeholder 残留具体业务域名并已修复：
     - `EvalPage.vue` placeholder「例如 risk_control…」→「请输入 domain_key（可从业务域页面跳转带入）」
     - `BusinessDomainPage.vue` placeholder「SmRiskUnit.inherent_risk_level」→「实体名.字段名」
   - 复扫 `backend/mcp/frontend/prompts/docker/scripts/config.yaml.template` 清零；cube 生产代码 + descriptors 无残留。
   - 验证：前端 typecheck 通过。

5. G-08 语义索引内容可解释核查：代码已完整——后端 `_semantic_content_summary` 返回 14 个 key，前端 `semanticIndexContentRows` 定义 13 类标签并在 template `<el-table>` 渲染；0.1 主表该行「页面未完整展示」为过时描述，已在本轮同步修正。

6. G-18 MCP 配置导出动态验证问题修复：
   - 缺陷：`mcp_config_exporter.py::export_with_test` 的 verification_questions 硬编码风险管控样例（「按固有风险等级统计风险单元数量」）及「租户/Tenant」具体实体。
   - 修复：新增 `_configured_business_query_entities()` 延迟读取候选域；`_verification_questions()` 无候选域时只生成 `search_ontology`/`read_ontology` 两步，有候选域时从首个实体 `display_name` 动态生成 `ask_business_data` 问题；去具体实体硬编码。
   - 测试：新增 `test_mcp_config_exporter.py` 3 用例（无候选域、动态生成、无硬编码），全量后端 pytest 通过。

7. 非问数误召回拦截门阀补齐（5.5.15「非问数误召回拦截 = 100%」）：
   - 缺陷：`eval_set.py` 生成器 50 条候选无「非问数」分类，`eval_runner.py` 无 `non_business_query_rejection` 指标，5.5.15 的非问数门阀无法执行。
   - 修复：
     - 生成器从 `ambiguity`（6→4）分出 `non_business_query` 2 条（问法取自设计 14.2 明确样例「证实方法有哪些？」），分布改为 normal 20 / aggregate 10 / policy_display 8 / ambiguity 4 / non_business_query 2 / leakage 6；
     - `eval_runner` 新增 `_assert_non_business_query_rejection`（非问数 case 返回 answered 即报 `non_business_query_recalled`）、`non_business_query_rejection` 指标、`required_categories` 纳入 `non_business_query`、validate 豁免其 domain/entity/expected_signals、`_assert_signals`/`expected_signals` 统计排除该分类；
     - 重新落盘 `_eval_set.yaml`（50 条，含 2 条非问数）。
   - 测试：`test_business_query_eval_runner.py` 适配并新增非问数误召回拦截正例；全量后端 pytest 通过。

8. field/filter/group-by 命中率指标补齐（5.5.15「field/filter/group-by 命中率 ≥85%」的 group-by 维度）：
   - 缺陷：`eval_runner.py` 无 field/filter/group-by 分项，5.5.15 的 field/filter/group-by 门阀无法执行。
   - 修复：
     - `eval_set.py` 生成器为 aggregate/topn 用例生成 `expected_dimensions`（group-by 字段 = 枚举字段名）；`_case`/`add`/`add_limited` 透传 `expected_dimensions`/`expected_filters`；
     - `eval_runner.py` 新增 `_assert_field_filter_groupby`（plan.dimensions 覆盖 expected_dimensions、plan.filters 字段覆盖 expected_filters，缺则报 `group_by_mismatch`/`filter_mismatch`）与 `field_filter_groupby` 指标（仅统计有期望值的 case）；
     - 重新落盘 `_eval_set.yaml`（aggregate/topn 用例含 expected_dimensions）。
   - 测试：`test_business_query_eval_runner.py` 新增 group_by_mismatch 正例；全量后端 pytest 通过。
   - 遗留：filter 命中率（expected_filters 期望值）、resolver 命中率、跨域 step order、列表安全投影仍待实现。

9. 基线固化：三仓库 git 提交 + `ontology_workspaces` 出仓（按用户确认其为页面配置后的运行时产物）：
   - cube-ai-project：`34cc780`（投影/guard/progress/descriptor 清理/文档）
   - biz-ontology-platform：`f3d345f`（business_query 语义层/eval/前端）+ `c07d6e8`（field/filter/group-by）+ `chore(gitignore)`（ontology_workspaces 出仓）
   - ghcloud ai-application：`2b0aa9b9d1`（tool-payload-visibility/progress thinking）
   - `.gitignore` 将 `ontology_workspaces/` 由跟踪改为忽略。

10. eval 门阀 filter 命中率补齐 + BQ-E01 状态校准：
    - BQ-E01 由 `todo` 校准为 `partial`：list/clarification 已通过 normal（detail/lookup）/ambiguity（clarification）分类覆盖，resolver/multi_step 分类待 G-14 资产落地。
    - filter 命中率：`eval_set.py` 生成器为 normal 用例增加按枚举值过滤 case（如「查询重大风险的XX」）并推导 `expected_filters`；`_assert_field_filter_groupby` 已支持 filter 覆盖断言（第 8 轮），缺则报 `filter_mismatch`。
    - 重新落盘 `_eval_set.yaml`（6 条含 expected_filters）；测试补 `filter_mismatch` 正例；全量后端 pytest 通过。

11. eval 门阀 field 命中率补齐（5.5.15「field/filter/group-by 命中率」的 field 维度，至此三项齐备）：
    - `eval_set.py` 生成器为 normal detail 用例推导 `expected_fields`（前 3 个重要字段）。
    - `eval_runner.py` 的 `_assert_field_filter_groupby` 新增 field 覆盖断言（answer 展示字段覆盖 expected_fields，缺则报 `field_mismatch`）；`field_filter_groupby` 统计条件纳入 expected_fields。
    - 重新落盘 `_eval_set.yaml`（5 条含 expected_fields）；测试补 `field_mismatch` 正例；全量后端 pytest 通过。

12. BQ-M05 同连接 1-hop JOIN 框架落地：
    - `service.py` 新增 `validate_same_connection_join`（校验显式同连接关系 + join 标识符防注入）与 `build_same_connection_join_select`（生成受约束 JOIN SELECT，分页只主实体）。
    - 事实依据：实体 YAML `relationships` 已含 `type: many_to_one` 与 `join` 条件（如 `SmRiskUnit.yaml` → `ai_sm_risk_unit.sign_id = ai_sm_risk_warning_sign.id`）。
    - 测试：新增 `test_business_query_same_connection_join.py` 6 用例（合法/非法 join、注入防护）；全量后端 pytest 通过。
    - 遗留：跨实体字段匹配触发点尚未接入 `_plan`（何时生成 JOIN 仍待业务场景确认）。

13. BQ-M06 LLM plan 草案校验（proposal guard）落地：
    - `service.py` 新增 `validate_plan_proposal`：校验草案 entity/metric/dimension/filter 字段在本体存在、禁 SQL/raw_rows/raw_columns/rows、非法字段 fail-closed。
    - 测试：新增 `test_business_query_plan_proposal.py` 5 用例（合法/非法字段/SQL 注入/非对象）；全量后端 pytest 通过。
    - 遗留：LLM fallback 调用集成（prompt/schema）待补，`llm_fallback.enabled` 保持 false。

14. service.py 拆分 + 澄清硬编码修复：
    - 拆分：`models.py`（数据类 FieldMeta/EntityMeta/DomainMeta/QueryPlan/DisplayColumnSpec/RuntimeFilter）、`semantic.py`（_normalize_text/_field_score/_entity_score/_domain_score/_best_entity）、`plan_proposal.py`（validate_plan_proposal）；service.py 2165→1992 行，re-export 保持向后兼容。
    - 硬编码：`_clarification` 澄清示例原写死「风险单元/固有风险等级/重大风险」，违反矩阵 15.5；改为 `_clarification_examples()` 从候选域动态生成，无候选域返回通用文案。
    - Qdrant 实现核查：`semantic_index.py` 已按「仓储接口 + 工厂模式」落地——`SemanticVectorRepository`(Protocol) + `InMemorySemanticVectorRepository`/`QdrantSemanticVectorRepository` 两实现 + `create_repository()` 工厂按 `repository` 配置选择；`EmbeddingProvider`(Protocol) + `QwenEmbeddingProvider` + `create_embedding_provider()` 工厂。符合计划 10.4 抽象要求；但单文件承载多职责仍是 G-07「结构清晰」的遗留。
    - 全量后端 pytest 通过。

---

## 2. 事实依据

### 2.1 本地代码事实

`biz-ontology-platform` 当前存在：

- `mcp/tools.py`：历史低层 SQL 查询工具实现位置。
- `mcp/server_stdio.py` / `mcp/server_http.py`：MCP 工具注册/协议适配入口。
- `mcp/security.py`、`mcp/sql_constraint_rewriter.py`、`mcp/constraint_enforcer.py`、`mcp/error_scrub.py`：已有 SQL 安全、约束、错误脱敏相关能力。
- `backend/services/*`：已有 platform service 分层。
- `backend/services/ai_assist/*`：已有 LLM、question bank、eval、字典、提示词等辅助能力。
- `frontend/src/views/EvalPage.vue`
- `frontend/src/views/QuestionBankPage.vue`
- `frontend/src/views/BusinessDomainPage.vue`
- `frontend/src/views/OntologyEditorPage.vue`
- `frontend/src/views/WorkbenchPage.vue`
- `frontend/src/api/*`

`cube-ai-project` 当前存在：

- `packages/agent/engine/src/bc/tools/handlers/mcp-handler.ts`
- `packages/agent/engine/src/bc/tools/mcp-bridge.service.ts`
- `packages/agent/engine/src/bc/tools/tool.service.ts`
- `packages/agent/engine/src/bc/tachu/engine-factory.ts`
- `packages/agent/engine/src/bc/session/turn.service.ts`
- `packages/agent/engine/src/bc/session/tachu-sse-mapper.ts`

这些位置是工具调用、MCP bridge、工具结果进入模型、SSE 输出、最终回答 guard 的主要落点。

### 2.2 风险管控资产事实

完整业务本体资产不在 `biz-ontology-platform/ontology_backup`，而在：

```text
/Users/ghy/test/bizont-kaihe/ontology
```

为避免运行调试直接依赖原始目录，当前已复制一份独立调试资产副本到：

```text
/Users/ghy/work/biz-ontology-platform/ontology_workspaces/bizont-kaihe/ontology
```

风险管控目录：

```text
/Users/ghy/work/biz-ontology-platform/ontology_workspaces/bizont-kaihe/ontology/风险管控
```

已核实事实：

- 风险管控目录存在。
- 风险管控有 24 个实体 YAML。
- 风险管控有 20 条 `_question_bank.yaml` 问题。
- 风险管控有 23 条 entity `query_examples`。
- `SmRiskUnit.yaml` 中存在：
  - `inherent_risk_level`：固有风险等级；
  - `control_risk_level`：控制后风险等级；
  - `risk_level`：单元当前风险等级；
  - `tenant`；
  - `deleted`；
  - 枚举映射 `MAJOR=重大`、`GENERAL=一般`、`LOW=低`。

结论：

- 首批风险管控 eval 必须基于仓库内独立调试副本 `/Users/ghy/work/biz-ontology-platform/ontology_workspaces/bizont-kaihe/ontology/风险管控` 抽取候选；原始 `/Users/ghy/test/bizont-kaihe/ontology` 只作为来源事实，不作为运行时依赖。
- 不能再只依赖 `biz-ontology-platform/ontology_backup` 判断业务域是否存在。
- 实施时必须把 ontology root 做成显式配置，不能隐式依赖 `/Users/ghy/test/bizont-kaihe/ontology` 原始目录。

### 2.3 外部事实依据

以下公开文档支撑本次设计方向：

- MCP tools 规范支持工具 `inputSchema`、`outputSchema`、`structuredContent`、`_meta` 等结构化边界：  
  <https://modelcontextprotocol.io/specification/2025-06-18/server/tools>
- MCP progress 规范支持 `_meta.progressToken` 与 `notifications/progress`：  
  <https://modelcontextprotocol.io/specification/2025-03-26/basic/utilities/progress>
- OpenAI Apps SDK 明确区分 `structuredContent`、`content`、`_meta`，且 `_meta` 可用于组件/客户端侧，不应直接暴露给模型：  
  <https://developers.openai.com/apps-sdk/reference/>
- Snowflake Cortex Analyst 基于 semantic model / semantic view 生成 SQL，歧义时返回 suggestions：  
  <https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst/rest-api>
- Snowflake Verified Query Repository 使用已验证问题 + SQL 提升相似问题准确性和可信度：  
  <https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst/verified-query-repository>
- Snowflake suggestions 需要人工 Accept/Edit/Dismiss，不自动生效：  
  <https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst/verified-query-suggestions>
- Tableau Agent 会索引字段 caption、description、data role、data type、样例值，并遵守 row/column-level security：  
  <https://help.tableau.com/current/online/en-us/web_author_einstein.htm>
- Tableau conversational analytics 使用 semantic query path，复杂/歧义时澄清意图：  
  <https://help.salesforce.com/s/articleView?id=analytics.tua_metric_questions.htm&language=en_US&type=5>
- ThoughtSpot Spotter Semantics 强调 governed semantic foundation、human-verified definitions、deterministic query generation、row/column-level security：  
  <https://www.thoughtspot.com/product/spotter-semantics>
- Power BI Q&A 最佳实践明确：缺少表关系时，报表和 Q&A 都无法解释如何 join；表/列同义词用于匹配用户自然语言：  
  <https://learn.microsoft.com/en-us/power-bi/natural-language/q-and-a-best-practices>
- Tableau Ask Data Lens 面向不同受众选择字段子集，并可配置字段名和值的同义词；这说明成熟产品不会把整库字段原样暴露给自然语言问数：  
  <https://help.tableau.com/current/online/en-us/ask_data_lenses.htm>
- Tableau Ask Data 数据准备建议通过字段别名、值别名、同义词和清晰字段名降低自然语言歧义：  
  <https://www.tableau.com/learn/whitepapers/preparing-data-nlp-in-ask-data>
- Databricks AI/BI Genie Space 支持示例 SQL、函数、instructions；其 Knowledge Store 包含本地化元数据、实体匹配、join relationships、measures、filters、dimensions 等受控语义资产：  
  <https://docs.databricks.com/aws/genie/set-up>  
  <https://docs.databricks.com/gcp/en/genie/add-instructions>
- Looker LookML 通过 Explore/join 定义受控关系，通过 access_grant 作用于 model、Explore、join、view、field 等层级：  
  <https://docs.cloud.google.com/looker/docs/reference/param-explore-join>  
  <https://docs.cloud.google.com/looker/docs/reference/param-model-access-grant>

采用解释：

- 成熟产品共同方向不是“靠提示词别泄漏 SQL”，而是通过 semantic layer、verified query、人审建议、受控查询生成、安全投影、eval 来治理问数链路。
- 业务主体列表、跨域问数的成熟方向也不是“让 LLM 自由拼多条 SQL”，而是先在语义层声明关系、可用字段、实体匹配、示例/已验证查询和权限约束，再由平台生成受控计划。
- `business_query_plan` 是本系统内部工程化 scene 名称，不是外部产品通用术语。

---

## 3. 总体落地边界

### 3.1 两仓库职责

```text
biz-ontology-platform
  ├─ platform service：业务问数核心
  ├─ mcp adapter：ask_business_data 薄适配
  ├─ frontend：管理端页面同步改造
  ├─ ontology assets：风险管控等本体资产
  ├─ eval runner：自动门阀
  └─ tests：后端 + 前端

cube-ai-project
  ├─ agent MCP host：工具可见性与结果投影
  ├─ MCP bridge：progress / structured result / _meta 处理
  ├─ final answer guard：最终回答防泄漏
  ├─ descriptors / custom agents：工具暴露规则
  └─ tests：agent engine / MCP / SSE / guard

ghcloud-new/prod/cube/apps/ai-application/app
  ├─ 应用对话 UI：thinking 渲染、工具卡、单行状态、feed/prose/steps 展示
  ├─ 工具中文名映射：ask_business_data → 业务问数
  └─ tests：thinking 纯函数与工具标签
```

### 3.2 禁止事项

1. 禁止普通 agent 继续看到 `query_database`。
2. 禁止通过换名字保留低层 SQL MCP tool。
3. 禁止让 LLM 直接生成最终 SQL。
4. 禁止把 SQL、MCP URI、tool args、raw id/code 放进普通用户最终回答。
5. 禁止把 `review_state=ai` 的 question bank 样例直接当 verified query。
6. 禁止只改后端不改前端。
7. 禁止只做 prompt 约束，不做工具结果投影与最终 guard。
8. 禁止在业务层直接依赖 Qdrant client；Qdrant 只能在 adapter 层。
9. 禁止在代码里写死 `/Users/ghy/test/bizont-kaihe/ontology`。

---

## 4. 执行步骤总览

本节是执行顺序，不是优先级拆分。每一步都必须完成。

```text
步骤 1：冻结配置与资产来源
步骤 2：biz 后端新增 business_query platform service
步骤 3：biz 后端重写 SQL executor 与 policy/display 投影
步骤 4：biz MCP 新增 ask_business_data，物理清理旧工具
步骤 5：biz 前端同步改造
步骤 6：biz 配置闭环、关键词闭环、现有语义资产复用与调试入口补齐
步骤 7：业务主体列表/明细查询与字段过滤配置闭环
步骤 8：跨业务域/跨连接多步问数编排
步骤 9：cube MCP host 工具结果投影与最终回答 guard
步骤 10：MCP progress/status 标准链路
步骤 11：风险管控 eval 50 条候选生成与人工确认
步骤 12：跨仓库集成测试与性能基线
步骤 13：合入门阀检查
```

---

## 5. 步骤 1：冻结配置与资产来源

### 5.1 目标

让开发、测试、生产都使用显式配置的 ontology root、embedding、vector repository、timeouts、policy 行为，避免本地路径和运行环境不一致。

### 5.2 biz-ontology-platform 配置项

建议配置结构：

```yaml
business_query:
  ontology:
    # 产品默认模板必须保持通用，不绑定具体客户、项目、业务域。
    # 具体业务域只能出现在部署配置、本地调试样例、测试、文档或本体资产中。
    root: ${BIZ_ONTOLOGY_ROOT}
    # domains 是可路由候选域清单，不是默认绑定域。
    # ask_business_data 每次根据用户问题在候选域中做语义/关键词路由。
    domains: {}

  timeouts:
    chat_total_ms: 60000
    sql_statement_ms: 30000
    llm_plan_ms: 8000

  llm_fallback:
    scene: business_query_plan
    timeout_ms: 8000
    max_attempts: 1

  semantic_index:
    enabled: false
    # 本地/生产启用 Qdrant 前必须先重建索引并通过门阀验证。
    # 冻结配置路径：business_query.semantic_index.repository，可选 memory|qdrant。
    # 不再同时引入 vector_repository.adapter，避免双路径配置。
    repository: memory
    dirty_behavior:
      default: keyword_fallback
      domains: {}

    qdrant:
      url: ${BUSINESS_QUERY_QDRANT_URL}
      api_key: ${BUSINESS_QUERY_QDRANT_API_KEY}
      collection: biz_ontology_semantic_index
      vector_name: text
      distance: cosine
      timeout_seconds: 5
      prefer_grpc: false
      create_collection_if_missing: true

    embedding:
      provider: qwen
      model: qwen3.7-text-embedding
      api_key: ${BIZ_ONTOLOGY_QWEN_EMBEDDING_API_KEY}
      base_url: ${BIZ_ONTOLOGY_QWEN_EMBEDDING_BASE_URL}
      batch_size: 20
      max_input_tokens:
      document_instruction: ''
      query_instruction: "Represent this query for retrieving business ontology domains, entities, fields and metrics."

  access_policy:
    default_behavior: fail_closed

  display_policy:
    default_raw_id_code_visible: false
    enum_unknown_strategy: raw_value
    max_columns: 20
```

本地风险管控调试样例必须放在独立样例配置中，例如 `biz-ontology-platform/config.business-query.bizont-kaihe.example.yaml`：

```yaml
business_query:
  ontology:
    root: ./ontology_workspaces/bizont-kaihe/ontology
    domains:
      risk_control:
        connection: 风险管控
        path: 风险管控
        description: 风险管控业务域
```

强制规则：

- `backend/config.py` 和 `config.yaml.template` 不得写死 `风险管控`、`risk_control`、`bizont-kaihe` 或开发者本机路径。
- 不允许再引入 `business_query.ontology.default_domain` 或 `BIZ_BUSINESS_QUERY_DOMAIN` 这类固定业务域选择入口；风险管控只能作为本地验证/部署配置中的候选域，不得成为产品运行时隐式默认域。
- `ask_business_data` 必须依赖 `business_query.ontology.domains` 候选清单做运行时路由；没有 domains 候选域时必须 fail-closed。
- `connection/path` 不得从 domain key 隐式猜测，避免环境变量绕过显式配置。
- 允许出现具体业务域名称的位置仅限：部署配置、独立 example、测试夹具、文档说明、已复制的本体调试资产。

### 5.3 `.env.example` 必须新增

```bash
BIZ_ONTOLOGY_ROOT=/path/to/ontology
BIZ_ONTOLOGY_QWEN_EMBEDDING_API_KEY=
  BIZ_ONTOLOGY_QWEN_EMBEDDING_BASE_URL=
BUSINESS_QUERY_QDRANT_URL=
BUSINESS_QUERY_QDRANT_API_KEY=
```

### 5.3.1 Qdrant 语义索引当前实现事实

截至本轮实现，`biz-ontology-platform` 已落地：

- `backend/services/business_query/semantic_index.py`
  - `SemanticVectorRepository` 抽象；
  - `InMemorySemanticVectorRepository` 测试/降级实现；
  - `QdrantSemanticVectorRepository` HTTP REST adapter；
  - `QwenEmbeddingProvider` OpenAI-compatible `/embeddings` adapter；
  - ontology YAML → domain/entity/field `SemanticDocument` 构建；
  - `rebuild_semantic_index()` 全量重建；
  - `search_semantic_entities()` 查询期向量召回。
- `ask_business_data` 查询链路已接入 `semantic_index.enabled=true` 时的向量候选，最终仍回到 YAML 实体和 SQL 安全执行器，不允许向量结果直接生成 SQL。
- 新增 API：
  - `GET /api/ai/business-query/semantic-index/status`
  - `POST /api/ai/business-query/semantic-index/rebuild`
- `backend/requirements.txt` 已新增 `qdrant-client>=1.12.0`；当前 adapter 使用已存在的 `httpx` 走 HTTP REST，业务层不直接依赖 Qdrant SDK。

本地验证事实：

- Qwen embedding 连通性已用无业务内容 `hello` 验证，返回 1024 维 float 向量。
- Qdrant HTTP adapter 已用无业务内容 dummy point 在本地 Qdrant 容器完成 `ensure_collection / upsert / search` smoke test。
- 未经用户显式授权，不执行完整风险管控 ontology embedding 重建，因为这会把业务本体文本发送到外部 embedding 服务。

### 5.4 验收

- 不存在硬编码 `/Users/ghy/test/bizont-kaihe/ontology`。
- 生产路径不存在硬编码业务域/客户/调试资产名称。审计命令：

  ```bash
  rg -n "风险管控|risk_control|bizont-kaihe|/Users/ghy/test|SmRisk" \
    backend mcp frontend docker scripts config.yaml.template .gitignore \
    -g '!backend/tests/**' -g '!ontology_workspaces/**' -g '!frontend/src/tests/**'
  ```

  期望结果为空。
- 启动时能打印当前 ontology root、semantic index adapter、embedding model，但不得打印 key。
- ontology root 缺失时 fail fast 或返回管理端可理解错误。
- 问数域配置必须通过 `business_query.ontology.domains` 显式声明；不得在代码中硬编码 `风险管控` 作为唯一目录。
- 本体资产不直接复制进 `biz-ontology-platform/ontology`，避免覆盖平台自带 examples/索引；调试副本放在 `biz-ontology-platform/ontology_workspaces/bizont-kaihe/ontology`。
- 当前默认配置事实：`backend/config.py` 与 `config.yaml.template` 的 `business_query.ontology.domains={}`，默认不绑定任何业务域；显式加载 `config.business-query.bizont-kaihe.example.yaml` 时，`risk_control` 只作为候选域 key，platform 每次按问题路由到 `connection=风险管控/path=风险管控`，可加载 24 个实体。
- 风险管控目录缺失时，eval 生成任务必须阻断。
- Qdrant adapter smoke test 必须证明真实写入/查询本地 Qdrant，而不是只测配置字段。
- `semantic_index.enabled=true` 前必须先完成 `POST /api/ai/business-query/semantic-index/rebuild`，且 status 显示 `repository=qdrant`、`collection_exists=true`。
- 若 `dirty_behavior=fail_closed` 且 semantic index 不可用，`ask_business_data` 必须安全失败，不得静默回退。

### 5.5 2026-08-17 补充：配置闭环与缺口清单

本节来自启动验证阶段的缺口复盘。结论：当前页面能管理业务域树、本体实体关联和索引重建入口，但问数运行时仍依赖 `config.yaml -> business_query.ontology.domains`。这会造成“用户在页面看起来配置了业务域，但 `ask_business_data` 未必可用”的双配置源问题。该问题不是优化项，属于落地计划缺口，必须补齐。

本轮暂不做权限与审计；权限、审计作为后续独立治理事项。除权限/审计外，本节缺口均纳入本次问数配置闭环范围。

#### 5.5.1 页面必须能启用/禁用问数候选域

事实：

- `frontend/src/views/BusinessDomainPage.vue` 现在管理的是业务域树与实体传播关系；
- 问数运行时读取的是 `business_query.ontology.domains`；
- 二者不是同一个持久化对象。

必须补齐：

- 业务域页面选中节点后，显示“问数候选域配置”；
- 支持“启用为问数候选域 / 取消问数候选域”；
- 启用后写入 `business_query.ontology.domains.<domain_key>`；
- 写入内容必须包含 `connection/path/description/source`；
- `source.kind=business_domain`，并记录 `source.business_domain_id`、`source.business_domain_name`；
- 禁止重新引入 `default_domain` 或 `BIZ_BUSINESS_QUERY_DOMAIN`；
- 页面必须明确说明：`domains` 是候选路由清单，不是默认业务域绑定。

短期合法性规则：

- 一个问数候选域只能对应一个 database connection；
- 如果父级业务域传播到多个 connection，页面必须禁止启用，并提示选择更细的子域；
- 如果节点没有传播到任何实体，禁止启用。

验收：

- 新增/更新后端 API 只 patch 当前业务域对应的 `business_query.ontology.domains.<key>`，不得整段覆盖配置；
- 页面启用后无需手写 `config.yaml` 即可被 `ask_business_data` 路由读取；
- 删除候选域后，`ask_business_data` 不再把该业务域作为候选路由范围；
- `rg -n "default_domain|BIZ_BUSINESS_QUERY_DOMAIN" backend frontend mcp config.yaml.template` 只允许出现在“禁止再引入”的文档或回归测试中。

#### 5.5.2 关键词配置必须闭环

事实：

- 设计已确认采用“关键词 + 向量/embedding 召回”；
- 目前仅依赖实体 display_name、description、字段、enum、向量候选不足以支撑 B 端业务简称、行业词、内部叫法；
- 页面未提供问数关键词配置，用户无法修正召回质量。

必须补齐三层关键词：

1. 业务域关键词：用于 domain 路由，如“风险管控、隐患、风险清单”；
2. 实体关键词/同义词：用于 entity 选择，如“风险单元、风险点、危险源”；
3. 字段关键词/同义词：用于 filter/group/display field 选择，如“等级、风险级别、固有风险”。

本轮落地边界：

- 业务域页面必须能维护候选域 `keywords`；
- `ask_business_data` 的 domain router 必须读取 `business_query.ontology.domains.<key>.keywords`；
- 实体/字段关键词本轮可先复用已有实体 YAML 的 `entity.synonyms`、`attributes[*].display_name/description/enum_values`，不强制新增实体编辑页面；
- 关键词修改后必须提示语义索引需要重建，或在 status 中显示 dirty。

验收：

- 配置业务域关键词后，不重启后端即可影响关键词路由；
- 查询包含业务域关键词时，routing diagnostics 能显示命中的 domain keyword；
- 修改关键词后，语义索引状态必须出现“需重建”或等价提示；
- 关键词不得只保存不生效。

#### 5.5.3 现有 synonyms/query_examples/_question_bank 必须有明确定位

事实：

- 实体 YAML 已存在 `entity.synonyms` 和 `entity.query_examples`；
- 系统已有 `_question_bank.yaml`；
- MCP `search_ontology` 已把 keywords/synonyms/query_examples 作为检索资产；
- 当前 `ask_business_data` 主路径未完整复用这些资产。

缺口：

- 建模阶段沉淀的同义词没有完整进入问数路由；
- query_examples 没有作为意图样例进入语义索引；
- `_question_bank` 和新问数链路关系不明确；
- prompt 中声明“可参考 query_examples/_question_bank”，但 `ask_business_data` 能力不完全匹配。

必须补齐：

- 语义索引构建内容必须纳入：
  - domain keywords；
  - entity display_name/description/synonyms；
  - field display_name/description/enum_values/attribute aliases；
  - query_examples 中的 question/intent_tag；
  - 可安全使用的 `_question_bank` question/expected_signals。
- `_question_bank` 中 SQL 不得进入普通用户输出；如进入索引，只能作为内部意图样例，不作为最终答案或 SQL 模板直出。
- prompt 能力声明必须与工具能力对齐：如果 `ask_business_data` 尚未使用某类资产，prompt 不得暗示该资产已经参与普通问数计划。

验收：

- 重建索引返回各类文档数量：domain/entity/field/synonym/query_example/question_bank；
- query_examples 中的问法能提升对应实体召回；
- 普通用户输出仍不出现 SQL、MCP URI、tool args；
- 独立旧 `QuestionBankPage` 不再保留为可访问页面；`_question_bank` 资产由 Eval 页面/语义索引构建流程复用，不提供旧问数入口。

#### 5.5.4 语义索引必须具备 dirty/fingerprint

事实：

- 业务域、候选域关键词、实体 YAML、synonyms、query_examples 变化后，向量索引可能过期；
- 当前 status 只显示 enabled/repository/health，不足以判断索引是否覆盖当前配置。

必须补齐：

- 重建索引时记录配置与资产 fingerprint；
- fingerprint 至少覆盖：
  - `business_query.ontology.domains`；
  - domain keywords；
  - 参与索引的实体 YAML；
  - synonyms/query_examples；
  - embedding model、collection、vector_name；
- status 返回 `dirty: true/false`、`indexed_at`、`indexed_fingerprint`、`current_fingerprint`；
- 页面在 dirty=true 时提示“配置或本体已变更，需要重建问数索引”。

验收：

- 改关键词后 status 变 dirty；
- 改实体 YAML 后 status 变 dirty；
- 重建成功后 dirty=false；
- `dirty_behavior=fail_closed` 且索引不可用/过期时，问数安全失败，不静默回退。

#### 5.5.5 语义索引内容必须可解释

缺口：

- 用户不知道索引里到底有 domain/entity/field/synonym/query_example 哪些内容；
- 重建后只看总数，不能判断关键词和样例是否进入索引。

必须补齐：

```json
{
  "domain_count": 1,
  "entity_count": 24,
  "domain_keyword_count": 12,
  "entity_doc_count": 24,
  "field_doc_count": 300,
  "synonym_doc_count": 80,
  "query_example_doc_count": 40,
  "question_bank_doc_count": 20
}
```

验收：

- rebuild API 返回索引内容分布；
- status API 返回最后一次索引内容摘要；
- 页面展示摘要，避免“点了重建但不知道重建了什么”。

#### 5.5.6 问数调试入口与路由解释

事实：

- 当前配置完后，用户仍需通过外部 MCP/Agent 才能验证 `ask_business_data`；
- 调试链路过长，无法快速判断问题出在候选域、关键词、向量索引、本体字段还是 SQL 执行。

必须补齐：

- biz 前端提供“问数调试”入口；
- 可输入 question，调用 platform service；
- 展示安全 answer；
- 管理端可展示脱敏 diagnostics；
- diagnostics 需要包含 routing trace：

```json
{
  "domain_candidates": [],
  "selected_domain": "",
  "entity_candidates": [],
  "matched_keywords": [],
  "matched_synonyms": [],
  "semantic_candidates": [],
  "selected_entity_reason": ""
}
```

安全边界：

- 普通 MCP 输出不得暴露 routing diagnostics；
- 管理端 diagnostics 不得展示 SQL 原文、真实 API key、tenant token、raw rows；
- 如需显示 SQL 计划，只能显示脱敏/摘要/安全原因，不显示完整 SQL。

验收：

- 页面能直接验证“风险清单有哪些”等问法；
- 页面能解释为什么选中某个 domain/entity；
- 调试入口输出不含 SQL、MCP URI、tool args、raw id/code。

#### 5.5.7 MCP 配置导出验证问题必须动态化

事实：

- `mcp_config_exporter` 当前存在固定风险管控验证问题，如“按固有风险等级统计风险单元数量”；
- 风险管控只能作为本地验证样例，不能作为产品默认导出验证语句。

必须补齐：

- 如果没有启用问数候选域，导出配置只验证 `list_business_domains/search_ontology/read_ontology`；
- 如果存在候选域，动态从候选域实体生成一条业务问数验证问题；
- 验证问题不得写死 `风险管控/risk_control/SmRisk*`。

验收：

- 产品默认配置导出的 MCP 验证问题不含风险管控样例；
- 加载风险管控样例配置后，验证问题可基于该候选域动态生成；
- 硬编码扫描不命中生产代码。

#### 5.5.8 业务域页面顶部 connection 语义必须澄清

事实：

- 截图中顶部连接下拉可能是“报警管理”，但选中业务域可以是“风险管控”；
- 顶部连接影响建模/视图上下文，不等于问数候选域 connection；
- 问数候选域 connection 应由传播实体实际 connection 决定。

必须补齐：

- 问数候选域配置区明确显示：
  - 当前页面连接上下文；
  - 该业务域传播实体实际 connection；
  - 问数候选域最终使用的 connection；
- 若存在多 connection，禁止启用并提示选择子域；
- 若顶部连接和传播实体 connection 不一致，不阻断，但必须解释二者差异。

验收：

- 用户不需要猜“顶部连接”是否决定问数 connection；
- 页面启用前能看清问数实际使用哪个 connection。

#### 5.5.9 Eval 必须与候选域配置绑定

缺口：

- 评测集生成目前从已配置候选域中选第一个有实体的域，多个候选域时对象不明确；
- 关键词变更后旧 eval set 可能失效；
- 业务域页面启用候选域后不能直接跳转评测。

必须补齐：

- Eval 页面支持选择 `domain_key`；
- 业务域页面提供“生成该候选域评测集/跳转评测”；
- eval set 写入 `domain_key/source/keywords/config_fingerprint`；
- 运行 eval 前校验 fingerprint，过期则要求重新生成；
- 首批 50 条 eval 仍需人工 review 后才能作为合入门阀。

验收：

- 多候选域时不会随机选择评测对象；
- 修改关键词后旧 eval set 标记过期；
- 评测报告显示 domain_key 与配置 fingerprint。

#### 5.5.10 Display policy 至少页面只读可见

事实：

- `hide_fields`、`enum_unknown_strategy`、`max_columns` 直接影响用户可见结果；
- 当前主要在 config 中维护，页面不可见。

本轮最低要求：

- 页面只读显示当前 display policy：
  - hide_fields 数量和列表；
  - enum_unknown_strategy；
  - max_columns；
- 如果本轮不做编辑，文案必须说明“展示策略当前由配置管理”；
- 后续可扩展为页面编辑，但不能让用户误以为字段丢失是 bug。

验收：

- 问数调试结果旁能看到当前 display policy 摘要；
- 当字段被隐藏时，调试诊断能说明是展示策略过滤。

#### 5.5.11 配置保存必须使用局部 patch，且不得展开 env placeholder

事实：

- `get_config()` 会将 `${ENV}` 替换为真实环境变量；
- 如果页面保存使用 `get_config()+save_config()` 整段写回，可能把真实 key 写入 `config.yaml`。

必须补齐：

- 新增 business_query config service 读取原始 YAML；
- 写配置时只 patch 目标字段；
- 保存候选域、关键词、semantic_index 配置时不得覆盖其他配置段；
- API key、Qdrant key 必须保留 `${VAR}` placeholder 或脱敏，不得因保存动作落盘真实值。

验收：

- 测试设置环境变量真实 key 后，页面保存关键词，不会把真实 key 写入 `config.yaml`；
- 修改一个候选域不会删除其他候选域；
- 修改 semantic_index 不会覆盖 database/llm/ai_assist。

#### 5.5.12 旧页面/旧入口处理原则

用户已确认：需要废弃的旧页面可以直接物理删除，不需要保留兼容。

本轮决策：

- 独立旧 `QuestionBankPage.vue` 不再作为可访问页面保留；
- `_question_bank` 作为内部语义资产 / eval 候选来源继续复用；
- 需要人工 review、评测集生成、门阀报告的能力并入 `EvalPage.vue` 或新的问数评测区域；
- 如果实现中复用旧组件代码，最终路由、菜单、页面标题、文案不得再出现旧 question bank 问数入口语义；
- 旧 `resolve_business_query`、旧 `fast_path`、旧 SQL 调试入口：
  - 不保留普通用户入口；
  - 不保留隐藏可访问页面；
  - 不保留旧文案。

验收：

- 路由扫描不出现可访问的旧 `QuestionBankPage`；
- MCP runtime info / config export 不出现旧工具；
- 前端普通用户可触达页面不提供 SQL 执行或旧问数入口。

#### 5.5.13 热更新与用户提示

缺口：

- 页面保存候选域/关键词后，后端配置理论上可立即生效；
- 但向量索引需要重建；
- 是否需要重启 MCP/后端没有页面提示。

必须补齐：

- 保存候选域/关键词后返回 `requires_rebuild: true`；
- 页面提示“配置已生效；向量召回需重建索引后生效”；
- 文档明确：配置读取是否热生效、MCP 是否需重启；
- 如果某处存在缓存，必须清理缓存或返回明确重启提示。

验收：

- 用户保存关键词后能立刻用关键词 fallback 路由；
- 语义索引状态提示需要重建；
- 不让用户猜是否需要重启。

#### 5.5.14 新增/改造 API 合同必须冻结

缺口：

- 只写“页面支持启用/禁用候选域、重建索引、问数调试”，不足以让前后端并行实现；
- 若不冻结 API contract，后端、前端、测试会各自理解字段名，最终出现页面可点但运行时不可用。

必须冻结以下最小 API 合同。

候选域状态：

```http
GET /api/business-domains/nodes/{node_id}/business-query-domain
```

成功响应：

```json
{
  "enabled": true,
  "domain_key": "risk_control",
  "connection": "风险管控",
  "path": "风险管控",
  "source": {
    "kind": "business_domain",
    "business_domain_id": "d_domain_32",
    "business_domain_name": "风险管控"
  },
  "keywords": ["风险管控", "隐患"],
  "entity_count": 24,
  "eligible": true,
  "ineligible_reason": null,
  "requires_rebuild": false
}
```

启用/更新候选域：

```http
PUT /api/business-domains/nodes/{node_id}/business-query-domain
Content-Type: application/json
```

请求：

```json
{
  "domain_key": "risk_control",
  "keywords": ["风险管控", "隐患", "风险清单"]
}
```

成功响应必须包含：

```json
{
  "enabled": true,
  "domain_key": "risk_control",
  "connection": "风险管控",
  "path": "风险管控",
  "keywords": ["风险管控", "隐患", "风险清单"],
  "requires_rebuild": true
}
```

禁用候选域：

```http
DELETE /api/business-domains/nodes/{node_id}/business-query-domain
```

语义索引状态：

```http
GET /api/ai/business-query/semantic-index/status?domain_key={domain_key}
```

成功响应至少包含：

```json
{
  "enabled": true,
  "repository": "qdrant",
  "dirty": false,
  "indexed_at": "2026-08-17T00:00:00Z",
  "indexed_fingerprint": "...",
  "current_fingerprint": "...",
  "content_summary": {
    "domain_count": 1,
    "entity_count": 24,
    "field_doc_count": 300,
    "synonym_doc_count": 80,
    "query_example_doc_count": 40,
    "question_bank_doc_count": 20
  },
  "last_error": null
}
```

重建语义索引：

```http
POST /api/ai/business-query/semantic-index/rebuild
Content-Type: application/json
```

请求：

```json
{
  "domain_key": "risk_control"
}
```

问数调试：

```http
POST /api/ai/business-query/debug
Content-Type: application/json
```

请求：

```json
{
  "question": "风险清单有哪些？",
  "domain_key": "risk_control"
}
```

成功响应：

```json
{
  "status": "answered",
  "answer": {
    "summary": "...",
    "columns": [],
    "rows": [],
    "warnings": []
  },
  "diagnostics": {
    "routing_trace": {
      "domain_candidates": [],
      "selected_domain": "risk_control",
      "entity_candidates": [],
      "matched_keywords": [],
      "matched_synonyms": [],
      "semantic_candidates": [],
      "selected_entity_reason": ""
    }
  },
  "display_policy": {
    "hide_fields": [],
    "enum_unknown_strategy": "raw_value",
    "max_columns": 20
  }
}
```

评测集生成/运行：

```http
POST /api/ai/business-query/eval-sets
POST /api/ai/business-query/eval-runs
```

要求：

- eval-set 请求必须包含 `domain_key`；
- eval-set 响应必须返回 `config_fingerprint`；
- eval-run 必须校验 fingerprint，过期时返回 `stale_eval_set`。

错误码：

```text
business_query_domain_not_eligible
business_query_domain_multi_connection
business_query_domain_empty_entities
business_query_config_patch_failed
business_query_semantic_index_dirty
business_query_semantic_index_failed
business_query_eval_set_stale
business_query_debug_unsafe_diagnostics
```

验收：

- 前端 API client 与后端 router 使用同一字段；
- 所有 API 响应不得包含 SQL 原文、真实 API key、token、raw rows；
- API contract 变化必须先改文档和测试。

#### 5.5.15 问数准确性门阀必须量化

缺口：

- 当前安全门阀足够强，但准确性门阀只写了人工验收和 50 条 eval；
- 如果没有分项准确性指标，可能出现“安全不泄漏但答错业务问题也合入”的漏洞。

本轮首批 50 条人工确认 eval 的最低通过门阀：

```text
安全泄漏类：100%
非问数误召回拦截：100%
domain routing 命中率：100%
entity 命中率：≥ 90%
field/filter/group-by 命中率：≥ 85%
answer presentation 合规率：≥ 95%
clarification 触发正确率：≥ 90%
整体 answered/clarified 正确率：≥ 90%
```

定义：

- `domain routing 命中`：selected_domain 与 eval expected.domains 匹配；
- `entity 命中`：selected entities 覆盖 expected.entities；
- `field/filter/group-by 命中`：查询计划字段、过滤条件、分组字段覆盖 expected 中声明的 required fields/filters/dimensions；
- `presentation 合规`：最终用户可见 answer 不出现 forbidden fields/patterns，且枚举/字段名按 display policy 展示；
- `clarification 触发正确`：歧义或跨域问题返回澄清，不硬猜；
- `非问数误召回拦截`：如知识库问题“证实方法有哪些？”不得错误进入业务问数执行。

验收：

- eval report 必须输出每个分项指标；
- 任一安全泄漏、非问数误召回拦截失败，直接不允许合入；
- 准确性指标低于门阀时，不允许用“模型波动”作为放行理由，必须沉淀失败样例并修复 routing/semantic asset/plan validator。

口径说明：

- domain routing 是安全边界的一部分，不能按 95% 放行；错域可能导致错误业务数据或越域查询，因此首批人工确认 eval 中必须 100%；
- entity/field/filter/group-by 属于语义准确性，首轮允许低于 100%，但不得低于上述门阀；
- 安全泄漏和非问数误召回仍是 100%。

#### 5.5.16 `_verified_queries.yaml`、`_metrics.yaml` 与维度建模必须进入计划

缺口：

- 关联设计文档已确认拆分 `_question_bank.yaml` / `_verified_queries.yaml` / `_eval_set.yaml`，并新增 connection/domain 级 `_metrics.yaml`；
- 主执行计划此前只写了 `verified_query_repository.py`、`metric_catalog.py`，没有明确 YAML 文件结构、生成/读取规则和验收；
- 维度建模只散落在 eval 字段和准确性指标里，没有定义来源、匹配和 SQL plan 约束。

必须补齐资产结构：

```text
<ontology-root>/<connection-or-domain>/
  _question_bank.yaml       # AI/人工沉淀的问题候选；不能直接作为 verified
  _verified_queries.yaml    # 人工确认后的可复用问数模板；SQL 仅 audit_only
  _metrics.yaml             # 业务指标、聚合口径、维度口径、可用过滤条件
  _eval_set.yaml            # 人工确认后的门阀用例
```

`_verified_queries.yaml` 最小结构：

```yaml
queries:
  - id: vq_risk_unit_by_level
    question_patterns:
      - 按固有风险等级统计风险单元数量
    domain_key: risk_control
    entities:
      - SmRiskUnit
    intent: aggregate
    plan:
      metrics:
        - risk_unit_count
      dimensions:
        - inherent_risk_level
      filters: []
    sql:
      visibility: audit_only
      fingerprint: "..."
    review:
      state: verified
      verified_by: manual
      verified_at: "2026-08-17T00:00:00Z"
```

`_metrics.yaml` 最小结构：

```yaml
metrics:
  - key: risk_unit_count
    display_name: 风险单元数量
    entity: SmRiskUnit
    expression:
      type: count
      field: id
    allowed_dimensions:
      - inherent_risk_level
      - risk_unit_type
    allowed_filters:
      - inherent_risk_level
      - deleted
      - tenant

dimensions:
  - key: inherent_risk_level
    display_name: 固有风险等级
    entity: SmRiskUnit
    field: inherent_risk_level
    enum_ref: SmRiskUnit.inherent_risk_level
```

维度建模规则：

- dimension 可以来自实体字段、枚举字段、外键引用、时间字段或 `_metrics.yaml` 显式声明；
- 维度必须有 `display_name`，否则不得直接展示技术字段名；
- group-by 只能使用 `allowed_dimensions` 或实体 YAML 中明确可聚合/可分组的字段；
- LLM fallback 只能建议 dimension key，最终必须由 `MetricCatalog/PlanValidator` 校验；
- 字段存在但未被允许作为维度时，不得自动 group-by。

验收：

- `_verified_queries.yaml` 不存在时系统仍可动态问数，但不能伪装 verified 命中；
- `_verified_queries.yaml` 存在并命中时，plan provenance 必须标记 `verified_query`；
- `_verified_queries.yaml` 中 SQL 不进入普通用户 answer、MCP content、模型上下文；
- `_metrics.yaml` 中 metric/dimension 能进入 semantic index 与 eval expected；
- 缺失 metric/dimension 时，复杂聚合问题应返回澄清或低置信失败，不硬猜；
- eval report 必须输出 metric/dimension 命中率。

#### 5.5.17 业务主体列表/明细查询与跨域多步问数必须进入计划

本节来自 2026-08-17 对启动验证和真实问题的复盘。用户提出的问题包括：

- “查询某个业务主体的列表数据”；
- “查询某个用户的待辨识单元列表或数量”；
- 先查 OUAA 用户域拿到用户标识，再查询风险管控域数据。

事实边界：

- 当前 `ask_business_data` 已能识别 `明细/列表/有哪些/列出/查询/查一下/分别/具体` 这类 detail/lookup 意图；
- 当前 detail/lookup 计划可生成 `SELECT 展示字段 FROM 实体视图 LIMIT N`；
- 当前 where 条件主要来自枚举值命中和安全执行器强制条件；
- 当前缺少“业务主体值解析”，例如 `张三`、`某公司`、`某组织`、`某租户`、`某设备` 先解析为受控实体标识；
- 当前缺少跨业务域/跨连接多步计划；不能声称已经支持 OUAA → 风险管控这类问题；
- 本体资产中存在 `external_reference` 概念，但它尚未进入 `ask_business_data` 主链路的多步编排和校验。

成熟产品事实依据：

- Power BI Q&A 文档明确：缺少表关系时，Q&A 与报表无法解释如何 join；表/列同义词用于匹配自然语言；
- Tableau Ask Data Lens 通过字段子集、字段/值同义词和推荐问题把自然语言问数约束在受控语义空间内；
- Databricks Genie Knowledge Store 把 join relationships、measures、filters、dimensions、entity matching 作为受控语义资产，而不是让模型自由猜 SQL；
- Looker 通过 Explore/join/access_grant 管理语义关系和访问边界。

采用解释：

- 对“某主体列表/明细”不能退回任意 SQL；
- 对“先查 A 域再查 B 域”的问题，不能让 LLM 自由调用低层 SQL 工具，也不能生成跨连接 SQL JOIN；
- 必须由 platform service 做受控多步编排，MCP 仍只暴露 `ask_business_data`。

##### 5.5.17.1 单域列表/明细查询能力

必须新增实体级列表配置。建议落点可以是实体 YAML 的 `entity.business_query.list_profile`，也可以是 domain asset；具体实现可调整，但页面必须是结构化表单，不允许让用户直接写 where 或 SQL。

建议结构：

```yaml
business_query:
  list_profile:
    enabled: true
    default_limit: 20
    max_limit: 100
    default_sort:
      - field: created_time
        direction: desc
    display_fields:
      - name
      - status
      - owner_name
      - created_time
    filter_fields:
      - field: status
        operators: [eq, in]
        value_match:
          type: enum
      - field: owner_user_id
        operators: [eq, in]
        value_match:
          type: resolver
          resolver: ouaa_user
          output: user_id
      - field: org_id
        operators: [eq, in]
        value_match:
          type: resolver
          resolver: ouaa_org
          output: org_id
```

规则：

- `display_fields` 只能从实体真实字段中选择，并继续受 display policy 隐藏字段约束；
- `filter_fields` 只能配置字段、操作符和值匹配来源，不允许直接配置 SQL 片段；
- 业务值过滤必须先走受控 value matching / entity resolver；
- 解析不到值时返回 `needs_clarification` 或 `failed`，不得把原始用户文本拼进 SQL；
- 多命中时必须追问，除非该 filter 明确允许 `in` 且命中数量小于配置上限；
- 列表数据默认分页/限流；不得无上限返回；
- debug 可展示受控 plan 和过滤命中原因；普通用户不可见 SQL、raw id、内部诊断。

示例：

```text
问题：列出张三负责的待辨识风险单元

解析：
- 实体：风险单元
- 意图：detail/list
- 主体值：张三 → ouaa_user resolver → user_id
- 过滤：
  - owner_user_id in ${resolver.ouaa_user.user_ids}
  - identify_status = pending
- 输出：
  - 风险单元名称、风险等级、所属区域、状态、更新时间等允许展示字段
```

##### 5.5.17.2 业务主体解析能力

必须新增受控 `EntityResolver`，用于把自然语言中的业务主体词解析为内部可过滤值。

建议内置 resolver 类型：

```yaml
business_query:
  resolvers:
    ouaa_user:
      domain_key: ouaa
      entity: User
      match_fields:
        - real_name
        - account
        - phone
      output_fields:
        - user_id
        - display_name
      ambiguity:
        strategy: clarify
        max_candidates: 5

    ouaa_org:
      domain_key: ouaa
      entity: Organization
      match_fields:
        - name
        - short_name
        - code
      output_fields:
        - org_id
        - display_name
      ambiguity:
        strategy: clarify
        max_candidates: 5
```

强制规则：

- resolver 输出默认属于内部中间变量，不进入普通用户最终回答；
- resolver 本身也必须走对应 domain 的 tenant/deleted/权限上下文；
- resolver 不能返回任意字段，只能返回 `output_fields`；
- resolver 查询必须限流；
- `ambiguity.strategy=clarify` 时，多命中必须追问；
- 如果配置为允许多值 `in`，必须有上限和审计记录。

##### 5.5.17.3 跨业务域/跨连接多步问数编排

新增 `BusinessQueryOrchestrator` 或等价模块，负责把一个自然语言问题拆成多个受控步骤。

推荐主流程：

```text
BusinessQueryService.ask(question, caller_context)
  ↓
DomainRouter：识别候选业务域，可多域
  ↓
IntentRouter：判断单域查询 / 多步主体解析 / 跨域查询
  ↓
EntityResolver：解析用户、组织、租户、设备等主体值
  ↓
MultiStepPlanBuilder：构造 steps
  ↓
MultiStepPlanValidator：校验每一步 domain/entity/field/filter/output
  ↓
StepExecutor：逐步执行，每一步仍走 SQLGenerator + SQLExecutor
  ↓
IntermediateContext：保存安全中间变量
  ↓
ResultSemanticProjector：只投影最终业务答案
```

多步 plan 最小结构：

```yaml
queries:
  - id: vq_pending_risk_units_by_user
    question_patterns:
      - "{user}的待辨识风险单元列表"
      - "{user}的待辨识风险单元数量"
    intent: multi_step
    steps:
      - id: resolve_user
        type: entity_resolve
        domain_key: ouaa
        entity: User
        input_slot: user
        resolver: ouaa_user
        output:
          user_ids: user_id
          display_names: display_name

      - id: query_risk_units
        type: business_query
        domain_key: risk_control
        entity: SmRiskUnit
        intent: detail_or_aggregate
        filters:
          - field: identify_user_id
            operator: in
            value: "${step.resolve_user.user_ids}"
          - field: identify_status
            operator: eq
            value: pending
        output:
          mode: list_or_count
```

注意：

- 上例字段名是说明性例子，真实字段必须来自 ontology 和页面配置，不能写死；
- `${step.resolve_user.user_ids}` 是平台内部中间变量，不是 caller context；
- `${context.xxx}` 仍只表示调用方上下文，例如 tenant、当前登录用户、组织范围；
- 跨连接问题默认不得生成单条 SQL JOIN；
- 同一连接内是否允许 join，必须依赖显式 relationship/join 配置和 PlanValidator；没有关系配置时 fail-closed。

##### 5.5.17.4 external_reference 与 join relationship 的使用边界

必须把关系分成两类：

1. 同连接受控 join：
   - 可在 semantic layer 声明 relationship；
   - SQLGenerator 可以生成受控 join；
   - 每个实体仍要注入自身安全条件；
   - join 字段必须在关系配置中显式声明。

2. 跨连接 external_reference：
   - 不生成 SQL JOIN；
   - 通过多步查询实现；
   - 第一步查询目标连接得到安全中间值；
   - 第二步把中间值作为受控 filter；
   - 中间值不得普通用户可见。

建议关系结构：

```yaml
relationships:
  - type: external_reference
    name: risk_unit_identify_user
    source:
      domain_key: risk_control
      entity: SmRiskUnit
      field: identify_user_id
    target:
      domain_key: ouaa
      entity: User
      field: user_id
    cardinality: many_to_one
    usage:
      allowed_for_filter: true
      allowed_for_display: false
      resolver: ouaa_user
```

##### 5.5.17.5 前端配置必须补齐

`biz-ontology-platform` 前端至少需要新增或扩展以下页面能力：

- 本体编辑器 / 实体页：
  - 列表展示字段配置；
  - 可过滤字段配置；
  - 字段操作符配置；
  - 字段 value_match 类型配置；
  - 字段关联 resolver 配置；
  - 字段默认排序和最大返回数配置。
- 业务域页：
  - resolver 列表；
  - cross-domain relationship / external_reference 只读概览和编辑入口；
  - multi-step verified query 表格化编辑；
  - 语义索引重建时把 resolver、relationship、multi-step template 纳入 content_summary。
- 问数对话验证页：
  - debug 展示多步执行过程；
  - 普通回答仍只展示最终安全结果；
  - 可输入本次 caller_context；
  - 多命中澄清要在页面上可见。
- Eval 页面：
  - 新增单域列表、主体解析、跨域多步用例分类；
  - 门阀报告显示 resolver 命中率、澄清正确率、跨域步骤成功率。

##### 5.5.17.6 后端模块与校验

建议新增或拆分：

```text
backend/services/business_query/
  list_profile.py
  value_matcher.py
  entity_resolver.py
  relationship_catalog.py
  multi_step_plan.py
  multi_step_validator.py
  orchestrator.py
```

强制校验：

- 没有 `list_profile.enabled=true` 的实体，不得执行列表类问题，只能返回澄清/不支持；
- 没有 `filter_fields` 声明的字段，不得被自然语言过滤；
- 没有 resolver 的业务主体词，不得作为 SQL literal；
- resolver 多命中且未允许多值时，必须 `needs_clarification`；
- external_reference 缺失时，不得跨域传递中间变量；
- step output 只能引用前置 step 明确声明的 output；
- step output 不能越权进入普通 answer；
- 每一步 executor 都必须复用 tenant/deleted/context_filters；
- debug diagnostics 必须脱敏，但可展示 step 名称、domain、entity、intent、命中数量、耗时和失败原因。

##### 5.5.17.7 测试与门阀

必须新增自动化测试：

- 单域列表：
  - “列出风险单元”命中 list_profile；
  - 只返回 allowed display fields；
  - 未配置 list_profile 时 fail-closed；
  - 过滤字段未声明时 fail-closed。
- 主体解析：
  - 用户名唯一命中后可作为中间变量；
  - 用户名 0 命中返回未找到；
  - 用户名多命中返回澄清；
  - resolver 输出 user_id 不进普通 answer。
- 跨域多步：
  - OUAA resolver step → 风险域 query step；
  - 缺 external_reference 时 fail-closed；
  - step output 引用不存在时 fail-closed；
  - 跨连接不生成 SQL JOIN；
  - 每一步都注入 tenant/deleted/context_filters。
- 前端：
  - list_profile 表格化编辑；
  - resolver 表格化编辑；
  - relationship/multi-step template 表格化编辑；
  - 保存后语义索引 dirty；
  - 问数验证页能展示多步 debug；
  - 多命中澄清 UI 正确展示。
- Eval：
  - 新增至少 10 条主体列表/明细用例；
  - 新增至少 10 条主体值过滤用例；
  - 新增至少 10 条跨域多步用例；
  - 新增至少 5 条歧义澄清用例。

门阀：

- 安全泄漏仍 100%；
- 跨域错误执行 0 容忍；
- 未配置关系/过滤/resolver 时必须 fail-closed，0 容忍；
- 跨域多步 eval 中 domain routing、step order、resolver ambiguity handling 必须 100%；
- 列表 answer 不得出现未授权 raw id/code；
- 列表行数不得超过 `max_limit`；
- 性能报告必须拆出 resolver、query step、projection、LLM answer 各阶段耗时。

#### 5.5.18 grill-me 决策冻结：业务主体列表、resolver、跨域多步与分页

本节是 2026-08-17 通过 `/grill-me` 与用户逐项确认后的冻结结论。后续实现必须逐条对齐；如果实现需要偏离任一条，必须先回到文档和用户确认，不允许“边写边改口径”。

##### 5.5.18.1 决策记录表

| # | 决策项 | 冻结结论 |
| --- | --- | --- |
| 1 | 跨业务域/跨连接多步问数由谁编排 | `biz-ontology-platform` 的 platform service 编排；MCP/Agent 只调用高层 `ask_business_data`，不做自由接力 |
| 2 | 新增语义资产落点 | `list_profile` 与 `relationships/external_reference` 在实体 YAML；`_resolvers.yaml`、`_multi_step_queries.yaml` 在 domain 级 |
| 3 | 列表/明细准入 | 必须显式 `list_profile.enabled=true`；未配置 fail-closed |
| 4 | resolver 多命中 | 默认澄清；0 命中未找到；1 命中继续；多命中仅在 `allow_multi=true` 且语义允许时进入受控 `IN`；禁止默认取第一个 |
| 5 | 跨连接 external_reference | 永远不生成 SQL JOIN，只能 platform 多步执行 |
| 6 | 同连接 JOIN | 允许同连接 1-hop 受控 JOIN；必须显式 relationship；必须 PlanValidator 校验 |
| 7 | resolver 安全等级 | resolver 与普通 query step 同安全等级，必须走 tenant/deleted/context_filters |
| 8 | resolver 匹配策略 | `exact_then_fuzzy`：先精确，后受控模糊；模糊多命中必须澄清 |
| 9 | 列表分页默认值 | 默认 page size 20，单页最大 100；实体级可覆盖但不能超过全局最大 |
| 10 | 分页调用方式 | 同时支持 `page/page_size` 与 `page_token`；“下一页”优先使用 `page_token` |
| 11 | page_token 实现 | 服务端状态 token；token 只是引用 ID，真实 plan/page state 存服务端 |
| 12 | page state 存储 | 本轮使用 Redis，TTL 默认 15 分钟；审计专项后置 |
| 13 | resolver 澄清候选展示 | 由 resolver `display_fields` 控制，并受 display policy 约束；未配置只展示 `display_name` |
| 14 | 账号/手机号/邮箱/工号展示 | 默认脱敏；未配置 mask 的敏感字段不得展示给普通用户 |
| 15 | 列表字段展示配置 | `list_profile.display_fields` 支持 per-field label/mask/enum_ref/formatter 等配置；全局 display policy 永远兜底 |
| 16 | contains/like | 支持受控 contains/like；必须字段显式声明，默认不开 |
| 17 | 过滤值语义归一 | enum/dict 字段允许 LLM 从已声明候选集合中选择；禁止自由生成过滤值 |
| 18 | resolver domain | 支持独立 `business_query.resolver_domains`；OUAA 当前可开放为普通候选域，但架构要支持 resolver-only |
| 19 | 权限过滤 hook | 本轮只定义 contract/扩展点，不接真实 OUAA 权限服务；权限专项后置 |
| 20 | 动态多步计划 | 允许 LLM fallback 动态生成多步 plan proposal，但必须完全落在已配置 resolver/relationship/list_profile/metrics/filter_fields 内 |
| 21 | LLM 参与边界 | LLM 只输出结构化 plan proposal；不接触 SQL，不接触 raw rows，不自由编排工具 |
| 22 | 中间结果给 LLM | 可给 LLM 脱敏中间结果用于澄清/话术；raw id、tenant、SQL、raw code 不给 LLM；第二步变量替换由 platform 执行 |
| 23 | 成功动态计划沉淀 | 自动沉淀只能进入 pending candidate，人工审核后才可 verified；不保存 SQL，只保存 plan + audit metadata |
| 24 | 前端页面分工 | 实体页配 `list_profile/relationship/usage`；业务域页配 `_resolvers.yaml/_multi_step_queries.yaml/_metrics.yaml/_verified_queries.yaml` |
| 25 | 问数验证页 | 管理端必须展示多步 timeline；普通用户只看安全 progress/thinking |
| 26 | 数量与列表模板 | 跨域多步“数量”和“列表”拆成两个模板；可复用 resolver step，但输出 contract 分开 |
| 27 | 列表排序 | `list_profile` 必须有 `default_sort`；若无稳定排序，显式 `stable_sort: none`，且不返回 `next_page_token` |
| 28 | 同连接 JOIN 分页排序 | 列表分页排序只允许主实体字段；joined entity 字段本轮不能作为分页排序字段 |
| 29 | 跨连接多步分页 | 允许；page session 保存 resolver 安全输出、最终 query safe plan、page state、context hash、expires_at |
| 30 | page_token 过期 | 不自动重放查询；返回 `PAGE_TOKEN_EXPIRED`，提示重新查询 |
| 31 | 执行顺序 | 必须先写回本文档，再编码实现 |

##### 5.5.18.2 冻结后的资产结构

```text
<ontology-root>/<domain-path>/
  EntityA.yaml
    entity.business_query.list_profile        # 实体列表/明细配置
    relationships[]                           # 同连接 relationship / 跨连接 external_reference
      business_query.usage                    # 是否允许用于 filter/display/join/resolver

  _metrics.yaml                               # 单域指标/维度/允许过滤条件
  _verified_queries.yaml                      # 单步 verified query；不保存可执行 SQL
  _resolvers.yaml                             # domain 级主体解析器
  _multi_step_queries.yaml                    # 跨域/多步 verified query；数量/列表模板分开
  _question_bank.yaml                         # AI/人工候选问题；不能直接 verified
  _eval_set.yaml                              # 门阀用例与人工 review 状态
```

强制规则：

- `_verified_queries.yaml` 继续只承载单步模板；
- `_multi_step_queries.yaml` 承载多步模板；
- 动态多步成功案例不得直接写入 verified 文件，只能进入 pending candidate；
- SQL 原文不进入 `_verified_queries.yaml` / `_multi_step_queries.yaml` 可执行字段，只允许 audit metadata。

##### 5.5.18.3 配置 contract

```yaml
business_query:
  list_defaults:
    default_page_size: 20
    max_page_size: 100

  pagination:
    state_store: redis
    ttl_seconds: 900

  resolver_domains:
    ouaa:
      connection: ouaa
      path: ouaa
      enabled: true
      usage: resolver_only

  access_hooks:
    enabled: false
    providers:
      ouaa:
        type: http
        endpoint: ""
        context_mapping:
          user: context.user_id
          tenant: context.tenant
        output_schema: business_query_access_policy_v1
```

规则：

- `business_query.ontology.domains` 是普通问数可路由域；
- `business_query.resolver_domains` 是内部主体解析域；
- resolver 可以引用普通 domain 或 resolver domain；
- resolver domain 不自动进入普通问数路由；
- `access_hooks.enabled=true` 但 provider 不可用时必须 fail-closed；本轮不实现真实权限获取。

##### 5.5.18.4 entity `list_profile` schema

```yaml
business_query:
  list_profile:
    enabled: true
    default_page_size: 20
    max_page_size: 50
    stable_sort: default
    default_sort:
      - field: updated_time
        direction: desc

    display_fields:
      - field: risk_unit_name
        label: 风险单元名称
      - field: owner_mobile
        label: 负责人电话
        mask: phone_last4
      - field: inherent_risk_level
        label: 固有风险等级
        enum_ref: SmRiskUnit.inherent_risk_level

    filter_fields:
      - field: risk_unit_name
        operators: [contains, eq]
        min_keyword_length: 2
      - field: identify_status
        operators: [eq, in]
        value_match:
          type: enum
      - field: identify_user_id
        operators: [eq, in]
        value_match:
          type: resolver
          resolver: ouaa_user
          output: user_id
```

规则：

- 没有 `enabled=true` 不允许列表/明细；
- `display_fields` 必须来自实体真实字段，并受全局 display policy 兜底；
- 敏感字段没有 mask 不允许保存；
- `filter_fields` 未声明的字段不得被自然语言过滤；
- contains/like 默认不开，必须字段显式声明；
- `stable_sort: none` 时只允许第一页，不返回 `next_page_token`；
- 同连接 JOIN 分页排序只能使用主实体字段。

##### 5.5.18.5 `_resolvers.yaml` schema

```yaml
resolvers:
  - key: ouaa_user
    domain_key: ouaa
    entity: User
    match:
      strategy: exact_then_fuzzy
      exact_fields:
        - account
        - phone
        - employee_no
      fuzzy_fields:
        - real_name
        - display_name
      fuzzy_operator: contains
      min_keyword_length: 2
      max_candidates: 5
    output_fields:
      - user_id
      - display_name
    display_fields:
      - field: display_name
      - field: account
        mask: account_partial
      - field: mobile
        mask: phone_last4
      - field: org_name
    ambiguity:
      strategy: clarify
      allow_multi: false
      max_candidates: 5
```

规则：

- resolver 输出默认是内部中间变量，不进入普通用户最终回答；
- resolver 查询必须注入目标实体的 tenant/deleted/context_filters；
- 0 命中返回未找到；
- 1 命中继续；
- 多命中默认澄清；
- `allow_multi=true` 且问题语义允许多值时，才可进入受控 `IN`；
- `user_id/id/tenant/deleted/raw code` 默认禁止展示；
- 账号、手机号、邮箱、工号等可识别个人信息默认必须 mask。

##### 5.5.18.6 `_multi_step_queries.yaml` schema

数量模板和列表模板必须拆开。

```yaml
queries:
  - id: vq_pending_risk_unit_count_by_user
    question_patterns:
      - "{user}的待辨识风险单元数量"
    intent: multi_step_aggregate
    steps:
      - id: resolve_user
        type: entity_resolve
        resolver: ouaa_user
        input_slot: user
        output:
          user_ids: user_id
          display_names: display_name

      - id: count_risk_units
        type: business_query
        domain_key: risk_control
        entity: SmRiskUnit
        intent: aggregate
        filters:
          - field: identify_user_id
            operator: in
            value: "${step.resolve_user.user_ids}"
          - field: identify_status
            operator: eq
            value: pending
        metrics:
          - risk_unit_count

  - id: vq_pending_risk_unit_list_by_user
    question_patterns:
      - "{user}的待辨识风险单元列表"
    intent: multi_step_list
    steps:
      - id: resolve_user
        type: entity_resolve
        resolver: ouaa_user
        input_slot: user
        output:
          user_ids: user_id
          display_names: display_name

      - id: list_risk_units
        type: business_query
        domain_key: risk_control
        entity: SmRiskUnit
        intent: list
        pagination:
          default_page_size: 20
        filters:
          - field: identify_user_id
            operator: in
            value: "${step.resolve_user.user_ids}"
          - field: identify_status
            operator: eq
            value: pending
```

规则：

- `${context.xxx}` 只表示调用上下文；
- `${step.xxx.yyy}` 只表示平台内部中间变量；
- step output 只能引用前置 step 明确声明的 output；
- step output 不存在必须 fail-closed；
- 跨连接 external_reference 不生成 SQL JOIN；
- 同连接 JOIN 只允许 1-hop，并必须显式 relationship；
- LLM fallback 只能输出 plan proposal；PlanValidator 通过后由平台 SQLGenerator 生成 SQL。

##### 5.5.18.7 分页与 page session contract

请求支持：

```json
{
  "question": "张三的待辨识风险单元列表",
  "page": 1,
  "page_size": 20,
  "page_token": ""
}
```

响应支持：

```json
{
  "status": "answered",
  "answer": {
    "summary": "共匹配到若干条，当前展示第 1 页。",
    "columns": [],
    "rows": [],
    "pagination": {
      "page": 1,
      "page_size": 20,
      "has_more": true,
      "next_page_token": "opaque-token-id"
    }
  }
}
```

Redis page session 最小内容：

```json
{
  "token": "opaque-token-id",
  "context_hash": "...",
  "original_question_fingerprint": "...",
  "resolver_outputs": {},
  "safe_plan_snapshot": {},
  "page_state": {},
  "expires_at": "..."
}
```

规则：

- token 只作为引用 ID，不携带可篡改 plan；
- “下一页”不重新跑 resolver；
- context hash 不匹配时 token 失效；
- token 过期返回 `PAGE_TOKEN_EXPIRED`，不自动重放查询；
- Redis 不可用时第一页可返回，但不得返回 `next_page_token`，并在 debug diagnostics 说明原因。

##### 5.5.18.8 API contract 必须先冻结

后端必须新增或扩展 API，但实现前必须先写测试固定 contract。

推荐 domain asset 类型扩展：

```ts
type BusinessQueryDomainAssetKind =
  | 'metrics'
  | 'verified_queries'
  | 'resolvers'
  | 'multi_step_queries'
```

实体级能力不建议塞进 domain asset，应通过本体实体保存接口维护：

```ts
entity.business_query.list_profile
entity.relationships[].business_query.usage
```

管理端问数验证页 stream 事件必须能表达多步 timeline：

```ts
type BusinessQueryStepEvent = {
  name: string
  title: string
  status: 'running' | 'succeeded' | 'failed' | 'needs_clarification'
  domain_key?: string
  entity?: string
  intent?: string
  duration_ms?: number
  safe_detail?: string
}
```

普通 MCP content 不得包含 diagnostics；管理端 debug 可见脱敏 diagnostics。

##### 5.5.18.9 前端页面 contract

本体编辑器 / 实体页必须补：

- `list_profile.enabled`；
- 默认 page size / max page size；
- default_sort / stable_sort；
- display_fields 表格；
- filter_fields 表格；
- value_match 类型；
- field mask / enum_ref / label；
- relationship business_query usage。

业务域页必须补：

- `_resolvers.yaml` 表格化编辑；
- `_multi_step_queries.yaml` 表格化编辑；
- 单步 `_verified_queries.yaml` 保持独立；
- semantic index content_summary 增加 resolver / relationship / multi_step_template；
- 保存任一问数资产后标记 semantic dirty。

问数验证页必须补：

- 多步 timeline；
- resolver 命中数量；
- 澄清候选展示；
- page/page_size/page_token 调试；
- 普通回答仍只展示安全结果。

##### 5.5.18.10 实现前必须补的测试清单

后端：

- `_resolvers.yaml` 读取/保存/校验；
- `_multi_step_queries.yaml` 读取/保存/校验；
- `list_profile` 保存与字段引用校验；
- `resolver exact_then_fuzzy`；
- resolver 0/1/多命中；
- resolver 必须注入 tenant/deleted/context_filters；
- 同连接 1-hop JOIN validator；
- 跨连接 external_reference 不生成 JOIN；
- LLM plan proposal 不能输出 SQL；
- page session Redis TTL；
- `PAGE_TOKEN_EXPIRED`；
- Redis 不可用时第一页可返回但无 next token。

前端：

- list_profile 表格化编辑；
- resolver 表格化编辑；
- multi-step query 表格化编辑；
- relationship usage 编辑；
- 多步 timeline 展示；
- 澄清候选脱敏展示；
- 保存后 semantic dirty。

Eval：

- 单域列表至少 10 条；
- 主体值过滤至少 10 条；
- 跨域多步数量至少 5 条；
- 跨域多步列表至少 5 条；
- 歧义澄清至少 5 条；
- 安全泄漏仍 100%；
- 跨域错误执行 0 容忍。

#### 5.5.19 实现前最后缺口清单：计划 vs 当前代码事实

本节是开始编码前的最终对照清单。它只记录有代码/文档证据支撑的事实，不把设计意图当作已实现能力。实现 PR 必须按本节顺序推进，并在每完成一项后更新第 0 节追踪矩阵和本节状态。

##### 5.5.19.1 当前代码事实摘要

已核对事实：

- `backend/services/business_query/service.py` 当前 `ask_business_data()` 是单域路由、单个 `QueryPlan`、单次 SQL executor、单次安全投影；没有 orchestrator、multi-step plan、resolver step、page session。
- `service.py` 当前 `_detail_requested()` 能识别“明细/列表/列出/查询”等词，但 `_plan()` 对 detail/lookup 只生成 `SELECT 展示字段 FROM 实体视图 LIMIT N`，where 主要来自 `_enum_filters()` 枚举命中；没有 `list_profile` 准入、业务主体值解析、分页 token。
- `catalog_assets.py` 当前 `VerifiedQueryDefinition` 只有 `id/question_patterns/domain_key/entities/intent/plan`；没有 `steps`、resolver、multi-step schema。
- `settings.py` 当前 `_ASSET_FILES` 只支持 `metrics` 与 `verified_queries`；domain asset API 不支持 `resolvers` 与 `multi_step_queries`。
- `frontend/src/api/index.ts` 当前 `BusinessQueryDomainAssetKind = 'metrics' | 'verified_queries'`，前端 contract 尚未扩展。
- `BusinessDomainPage.vue` 当前只表格化编辑 `_metrics.yaml` 与 `_verified_queries.yaml`；没有 resolver/multi-step query 页面。
- `OntologyEditorPage.vue` 当前有普通 relationships 与 tenant/deleted 结构化约束，但没有 `list_profile`、relationship `business_query.usage`；跨库关系提示仍写“由 LLM 在 Agent 层接力查询合并”，与冻结决策冲突。
- `BusinessQueryChatPage.vue` 当前已走 stream，并可编辑 caller_context，但没有 page/page_size/page_token，也没有 resolver 澄清候选专门 UI 或 multi-step timeline contract。
- 后端测试当前覆盖 business_query service/settings/chat/semantic/eval 基础链路，但没有 list_profile、resolver、multi-step、page token、Redis TTL、PAGE_TOKEN_EXPIRED、同连接 JOIN validator、跨连接不 JOIN 的测试。

##### 5.5.19.2 缺口与实现顺序

| 顺序 | 缺口 | 当前事实依据 | 必须实现 | 验收证据 |
| --- | --- | --- | --- | --- |
| G1 | 后端 asset contract 不支持新资产 | `_ASSET_FILES` 只有 `metrics/verified_queries`；前端 asset kind 也只有两项 | 新增 `resolvers/multi_step_queries` asset kind；读取/保存/校验 `_resolvers.yaml`、`_multi_step_queries.yaml` | 后端 settings 测试 + 前端 API 测试 |
| G2 | 缺少 `list_profile` 数据模型与校验 | 实体保存链路没有 `business_query.list_profile` schema；列表现在自动 fallback 到展示字段 | 在实体 YAML 支持 `business_query.list_profile`；保存时校验字段、mask、operators、default_sort/stable_sort | 后端实体保存/校验测试 + OntologyEditorPage 测试 |
| G3 | 缺少 resolver 模型与执行器 | 没有 `entity_resolver.py` / resolver runtime；当前过滤只支持枚举 | 新增 resolver catalog/runtime；支持 `exact_then_fuzzy`、0/1/多命中、display_fields 脱敏、tenant/deleted/context_filters 注入 | resolver 单测覆盖 0/1/多命中、敏感字段脱敏、安全约束 |
| G4 | 缺少多步 plan schema 与 validator | `_verified_queries.yaml` 没有 steps；`ask_business_data()` 只执行单 plan | 新增 `_multi_step_queries.yaml` schema、MultiStepPlan、MultiStepPlanValidator、`${step.xxx}` 引用校验 | multi-step schema/validator 测试 |
| G5 | runtime 缺少 orchestrator | `ask_business_data()` 直接 `_resolve_domain_plan()` 后执行 executor | 新增 BusinessQueryOrchestrator；优先 multi-step verified，未命中可 LLM plan proposal，全部经 validator | service/orchestrator 测试：单步不回归、多步可执行 |
| G6 | 跨连接 `external_reference` 未进入主链路 | 本体有 relationships UI，但主链路不消费 external_reference；页面旧文案说 Agent 接力 | relationship catalog 消费 external_reference；跨连接只多步不 JOIN；同连接只允许 1-hop 受控 JOIN | validator 测试：跨连接不 JOIN、缺关系 fail-closed、同连接 1-hop |
| G7 | 列表分页与 page session 缺失 | API/request/response 无 page/page_size/page_token；无 Redis page session | 新增 page/page_size/page_token contract；Redis 状态 token；TTL 900s；PAGE_TOKEN_EXPIRED | page session 单测；Redis unavailable 降级测试 |
| G8 | 投影层缺少 list_profile per-field display | 当前 `_project_rows()` 依赖 display policy/enum，没用 list_profile 字段配置 | 列表结果按 list_profile display_fields 投影；mask/enum_ref/label/formatter；全局 hide_fields 兜底 | projection 测试：敏感字段无 mask 拒绝/隐藏，枚举映射 |
| G9 | LLM fallback 边界未实现 | 当前 chat LLM 只做最终回答；service 内未见 plan proposal 机制 | 新增 plan proposal adapter；LLM 只看脱敏 catalog，只输出 JSON plan proposal，不输出 SQL/raw rows | 测试：proposal 含 SQL fail-closed；未知 field/resolver fail-closed |
| G10 | 前端实体页配置缺口 | OntologyEditorPage 无 list_profile/usage；跨库文案冲突 | 实体页新增 list_profile 表格、filter_fields、display_fields、sort、relationship usage；修正文案为 platform 多步 | Vue 测试 + typecheck |
| G11 | 前端业务域页配置缺口 | BusinessDomainPage 只编辑 metrics/verified_queries | 新增 resolvers 与 multi-step queries 表格化编辑；保存后 semantic dirty | Vue 测试 + API 测试 |
| G12 | 问数验证页缺口 | stream 只有通用 steps，无 multi-step/page/resolver UI | 展示多步 timeline、resolver 澄清候选、分页参数与 next page token | Vue 测试 |
| G13 | semantic index 内容缺口 | 当前 semantic index content_summary 未冻结包含 resolver/relationship/multi_step_template | rebuild 时纳入 resolver、relationship、multi_step_template 文档；status 展示数量 | semantic index 测试 |
| G14 | eval 门阀缺口 | 当前 eval 主要单域基础问数；没有主体列表/跨域多步分类 | 增加 list/resolver/multi_step eval 分类和门阀指标 | eval runner 测试 + 手工评测集 |
| G15 | 文档/代码状态同步缺口 | 第 0 节仍多项 partial/missing；本节刚冻结 | 每完成 G1-G14 后更新第 0 节状态、证据、测试命令 | 文档 diff + 门阀报告 |

##### 5.5.19.3 允许开始编码的条件

以下条件满足后，才允许进入实现：

- 本节 G1-G15 已被用户确认作为实现顺序；
- 不再新增未经确认的资产文件名、API 名、状态枚举；
- 任一实现发现本节 contract 不可行时，先暂停并回到 `/grill-me`；
- 实现时禁止绕过文档，把新配置塞进 raw YAML textarea 或任意 SQL 文本；
- 实现时禁止恢复旧 `query_database` / 旧 Agent 接力跨库语义；
- 每个 G 项至少有对应测试，不允许只做 UI 假入口。

##### 5.5.19.4 首轮编码建议切片

为了避免一次性改太大，首轮编码按以下切片提交/验证：

1. **Contract & asset 层**：G1 + G2 + G4 的 schema/validator，不接 runtime。
2. **Resolver & list runtime**：G3 + G7 + G8，先支持单域列表和主体解析。
3. **Multi-step runtime**：G5 + G6 + G9，支持 OUAA resolver → 风险域 query 的受控多步。
4. **Frontend config**：G10 + G11 + G12，页面补齐并与 API contract 对齐。
5. **Index & eval**：G13 + G14，进入门阀。
6. **状态同步**：G15，更新追踪矩阵和完成证据。

任何切片如果测试失败或 contract 与实现冲突，不允许继续下一个切片。

#### 5.5.20 详细功能实现清单、状态同步与门阀

本节是实现执行用 checklist。后续代码落地必须逐项更新 `状态/证据`，不允许只在最终总结里口头说明。状态定义：

- `todo`：未实现。
- `draft`：已有代码草稿，但未跑测试或未 review，不得视为完成。
- `implemented`：代码实现完成，但尚未通过全部门阀。
- `verified`：对应测试、review、文档状态均完成。
- `blocked`：事实阻塞，必须写明原因和下一步。

> 2026-08-17 当前事实：`biz-ontology-platform/backend/services/business_query/settings.py`、`catalog_assets.py` 已补 resolver / multi-step asset contract 与 loader；`frontend/src/api/index.ts` 已扩展 asset kind。已通过后端 settings 测试、前端 API 测试和前端 typecheck；本切片只完成 asset contract，不代表 runtime/list/resolver/multi-step 已完成。

##### 5.5.20.1 后端 contract / asset 层

| ID | 功能 | 涉及文件 | 实现要求 | 测试门阀 | 当前状态 |
| --- | --- | --- | --- | --- | --- |
| BQ-A01 | 扩展 domain asset 类型 | `backend/services/business_query/settings.py`、`frontend/src/api/index.ts` | 支持 `metrics/verified_queries/resolvers/multi_step_queries`；未知 asset fail-closed | 后端 settings 测试；前端 API 类型测试 | verified |
| BQ-A02 | `_resolvers.yaml` schema 校验 | `settings.py`、后续可拆 `catalog_assets.py` | 校验 key/domain_key/entity/match/output_fields/display_fields/ambiguity；mask 值合法；结构错误拒绝保存 | 新增 `test_business_query_settings.py::test_resolver_asset_*` | verified |
| BQ-A03 | `_multi_step_queries.yaml` schema 校验 | `settings.py`、后续可拆 `catalog_assets.py` | 校验 queries/steps/entity_resolve/business_query/filters/metrics/`${step.xxx}`；禁止无效 step/field/operator | 新增 `test_business_query_settings.py::test_multi_step_asset_*` | verified |
| BQ-A04 | `_verified_queries.yaml` 保持单步语义 | `settings.py`、`catalog_assets.py` | 不把 multi-step 强塞进旧 verified query；数量/列表多步进入 `_multi_step_queries.yaml` | 回归测试：旧 verified 正常；steps 出现在 verified 时拒绝或忽略策略明确 | verified |
| BQ-A05 | catalog loader 类型化 | `catalog_assets.py` | 增加 ResolverDefinition、MultiStepQueryDefinition loader；不执行 SQL | loader 单测 | verified |

##### 5.5.20.2 实体级 `list_profile` 与 relationship usage

| ID | 功能 | 涉及文件 | 实现要求 | 测试门阀 | 当前状态 |
| --- | --- | --- | --- | --- | --- |
| BQ-L01 | `list_profile` 读取模型 | `backend/services/business_query/list_profile.py` 或等价模块 | 从实体 YAML 读取 enabled/page/default_sort/display_fields/filter_fields | 单测读取有效配置 | verified |
| BQ-L02 | `list_profile` 保存校验 | `backend/services/ontology_manager.py` 或实体保存链路、`OntologyEditorPage.vue` | 字段必须存在；敏感字段必须 mask；operators 合法；default_sort 主实体字段；`stable_sort:none` 合法 | 后端保存校验测试；前端保存测试 | implemented |
| BQ-L03 | display_fields 投影 | `service.py` / projector | 多步列表查询已按 `list_profile.display_fields` fail-closed 投影；全局 hide_fields 优先；label/mask/formatter 细粒度投影仍需补齐 | 投影单测：mask、enum、hide_fields | implemented |
| BQ-L04 | filter_fields 受控过滤 | `service.py` | 普通单实体列表只消费 `filter_fields` 声明的 enum/context/contains；用户问题命中未声明枚举/字段值过滤意图时 fail-closed；contains 仅字段显式声明；min_keyword_length 生效 | `test_business_query_service.py::test_single_entity_list_profile_filters_only_declared_fields`、`test_single_entity_list_profile_rejects_undeclared_filter_intent`、context 缺失阻断测试 | implemented |
| BQ-L05 | relationship usage | `OntologyEditorPage.vue`、relationship catalog | relationship 增加 `business_query.usage`；跨连接文案改为 platform service 多步编排，不再说 Agent 接力 | 前端源码契约测试；文案 grep；typecheck | verified |

##### 5.5.20.3 Resolver runtime

| ID | 功能 | 涉及文件 | 实现要求 | 测试门阀 | 当前状态 |
| --- | --- | --- | --- | --- | --- |
| BQ-R01 | resolver catalog | `entity_resolver.py`、`catalog_assets.py` | 加载 `_resolvers.yaml`；支持 resolver domain 与 ordinary domain | catalog 单测 | verified |
| BQ-R02 | exact_then_fuzzy 匹配 | `entity_resolver.py` | 精确字段优先，模糊字段 contains；min_keyword_length；max_candidates | 0/1/多命中测试 | verified |
| BQ-R03 | resolver 安全约束 | `entity_resolver.py`、`sql_executor.py` | resolver 查询也注入 tenant/deleted/context_filters；缺 context fail-closed | 安全约束单测 | implemented |
| BQ-R04 | ambiguity handling | `entity_resolver.py`、`service.py` | 0 命中未找到；多命中澄清；allow_multi 受控 IN；禁止默认取第一个 | ambiguity 单测 | verified |
| BQ-R05 | resolver display projection | projector / policy | display_fields 受 display policy；账号/手机/邮箱/工号默认 mask；raw id 不展示 | 脱敏测试 | implemented |

##### 5.5.20.4 Multi-step orchestrator / validator

| ID | 功能 | 涉及文件 | 实现要求 | 测试门阀 | 当前状态 |
| --- | --- | --- | --- | --- | --- |
| BQ-M01 | MultiStepPlan model | `multi_step_plan.py` | 表达 step、input/output、filters、metrics、pagination、diagnostics | model/serialization 测试 | implemented |
| BQ-M02 | MultiStepPlanValidator | `multi_step_validator.py` | 校验 resolver、relationship、list_profile、metrics/filter_fields、`${step}` 引用；缺配置 fail-closed；resolver 可来自已配置 resolver domain | validator 正反例测试 | verified |
| BQ-M03 | BusinessQueryOrchestrator | `service.py`（当前内聚实现，后续可拆 `orchestrator.py`） | `ask_business_data` 入口消费已验证 multi-step template；单步不回归，多步走 steps | service 测试 | verified |
| BQ-M04 | external_reference 消费 | `multi_step_validator.py`、`service.py` | 跨连接只多步，不 JOIN；缺 external_reference 不传中间变量 | validator + service 测试 | verified |
| BQ-M05 | 同连接 1-hop JOIN | SQLGenerator / validator | 仅同 connection、显式 relationship、1-hop；joined entity 安全约束；分页排序只主实体字段 | join validator 测试 | todo |
| BQ-M06 | LLM plan proposal | `llm_fallback.py` 或等价模块 | LLM 只输出 JSON plan proposal；不输出 SQL；不看 raw rows；非法字段拒绝 | proposal guard 测试 | todo |
| BQ-M07 | pending candidate 沉淀 | asset writer | 动态成功计划只进入 pending candidate，不 verified；不保存 SQL | candidate 写入测试 | todo |

##### 5.5.20.5 Pagination / page token

| ID | 功能 | 涉及文件 | 实现要求 | 测试门阀 | 当前状态 |
| --- | --- | --- | --- | --- | --- |
| BQ-P01 | 请求/响应 contract | `service.py`、`routers/ai.py`、`frontend/src/api/index.ts` | 支持 page/page_size/page_token 入参；multi-step diagnostics 返回 pagination；page_token 服务端状态未完成，仍 fail-safe | contract 测试 | implemented |
| BQ-P02 | Redis page session | `pagination.py` | 已新增 repository 抽象、Redis adapter、memory adapter、TTL 900s 配置、服务端 opaque token；真实 Redis 集成测试未跑 | Redis/mock 单测 | implemented |
| BQ-P03 | PAGE_TOKEN_EXPIRED | `pagination.py` / `service.py` | token 过期不重放；返回 `PAGE_TOKEN_EXPIRED` 安全错误/提示重新查询 | 过期测试 | verified |
| BQ-P04 | Redis 不可用降级 | `pagination.py` / `service.py` | 第一页可返回；缺 Redis URL 或 Redis 不可用时不返回 next token；diagnostics 记录原因 | 降级测试 | verified |
| BQ-P05 | 跨连接多步分页 | `service.py` / `pagination.py` | page session 保存 resolver 输出和安全模板；下一页不重跑 resolver；完整 caller_context hash 不匹配失效 | multi-step pagination 测试 | verified |

##### 5.5.20.6 Frontend 配置与验证页面

| ID | 功能 | 涉及文件 | 实现要求 | 测试门阀 | 当前状态 |
| --- | --- | --- | --- | --- | --- |
| BQ-F01 | API 类型扩展 | `frontend/src/api/index.ts` | `BusinessQueryDomainAssetKind` 增加 resolvers/multi_step_queries；chat/debug payload 增加 page/page_size/page_token；请求响应类型对齐 | API 测试 + typecheck | verified |
| BQ-F02 | 实体页 list_profile UI | `OntologyEditorPage.vue` | 表格编辑 enabled/page/default_sort/display_fields/filter_fields/value_match/mask/enum_ref；写入 `entity.business_query.list_profile` | Vue 源码契约测试 + typecheck；仍需浏览器真实交互 | verified |
| BQ-F03 | relationship usage UI | `OntologyEditorPage.vue` | 编辑 allowed_for_filter/display/join/resolver；跨库文案改 platform service 多步编排；写入 `relationships[].business_query.usage` | Vue 源码契约测试 + typecheck；仍需浏览器真实交互 | verified |
| BQ-F04 | 业务域页 resolver UI | `BusinessDomainPage.vue` | 表格编辑 `_resolvers.yaml`，不暴露 YAML；支持 key/entity/exact_fields/fuzzy_fields/output_fields/display_fields/mask/max_candidates | Vue 源码契约测试 + typecheck；仍需浏览器真实交互 | verified |
| BQ-F05 | 业务域页 multi-step UI | `BusinessDomainPage.vue` | 表格/分步编辑 `_multi_step_queries.yaml`；支持 question_patterns、resolver step、business_query step、filters、aggregate/list、review_state；内部生成 YAML | Vue 源码契约测试 + typecheck；仍需浏览器真实交互 | verified |
| BQ-F06 | 问数验证页 timeline | `BusinessQueryChatPage.vue`、`chat_service.py` | 页面走 event-stream；safe diagnostics 白名单透出 multi_step/pagination；SQL/raw rows 不进入事件 | Vue 测试 + chat_service 测试 | implemented |
| BQ-F07 | semantic dirty 联动 | BusinessDomain/OntologyEditor | 保存 list/resolver/multi-step/relationship 后标记 semantic dirty | Vue/API 测试 | todo |

##### 5.5.20.7 Semantic index / eval / MCP / guard

| ID | 功能 | 涉及文件 | 实现要求 | 测试门阀 | 当前状态 |
| --- | --- | --- | --- | --- | --- |
| BQ-S01 | semantic documents 扩展 | `semantic_index.py` | 纳入 resolver、relationship、multi_step_template、list_profile | semantic index 测试 | todo |
| BQ-S02 | content_summary 展示 | `semantic_index.py`、BusinessDomainPage | status/rebuild 展示新增 asset_type_counts | 测试 + 页面断言 | todo |
| BQ-E01 | eval 分类扩展 | `eval_set.py`、`eval_runner.py` | list/resolver/multi_step_count/multi_step_list/clarification 分类 | eval 测试 | todo |
| BQ-E02 | eval 门阀指标 | eval runner | resolver 命中率、澄清正确率、跨域 step order、列表安全投影 | eval runner 测试 | todo |
| BQ-C01 | MCP contract 更新 | `mcp/server_stdio.py`、`mcp/tools.py`、`mcp/tool_response.py`、MCP contract tests | `ask_business_data` input/output 支持分页；普通 content 无 diagnostics；safe structuredContent 允许透出 `pagination.page_size/has_more/next_page_token/error_code`，不透出 SQL/routing_trace/raw rows | `python3 -m py_compile mcp/server_stdio.py mcp/tools.py mcp/tool_response.py backend/tests/test_business_query_mcp_contract.py`；`pytest -p no:cacheprovider -q backend/tests/test_business_query_mcp_contract.py` | verified |
| BQ-G01 | 应用对话 guard 回归 | cube/ghcloud-new | 新 pagination/timeline 字段不泄漏 SQL/raw id/tool args | cube/ghcloud 测试 | todo |

##### 5.5.20.7.1 已执行门阀记录

2026-08-18，BQ-C01 MCP contract 更新切片：

```bash
cd /Users/ghy/work/biz-ontology-platform
PYTHONPYCACHEPREFIX=/private/tmp/bizont-pycache python3 -m py_compile mcp/server_stdio.py mcp/tools.py mcp/tool_response.py backend/tests/test_business_query_mcp_contract.py
PYTHONPYCACHEPREFIX=/private/tmp/bizont-pycache python3 -m pytest -p no:cacheprovider -q backend/tests/test_business_query_mcp_contract.py
git diff --check
cd /Users/ghy/work/cube-ai-project
git diff --check -- docs/technical-design/2026-08-13-business-query-implementation-plan.md
```

结果：

- Python 编译：通过。
- MCP contract：`7 passed`，1 warning（既有 pytest config warning）。
- `biz-ontology-platform` / `cube-ai-project` diff check：通过。
- 已验证范围：`ask_business_data` MCP inputSchema 支持 `page_size/page_token`；stdio 调用会转发分页参数；tools 薄封装返回安全 JSON；structured payload 仅透出安全 pagination，不透出 diagnostics/SQL/raw rows。
- 未替代范围：该切片不替代真实 MCP host/Agent 端到端对话验收，BQ-G01 仍需真实环境复验。

2026-08-17，BQ-A01~BQ-A05 asset contract 切片：

```bash
cd /Users/ghy/work/biz-ontology-platform
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -p no:cacheprovider backend/tests/test_business_query_settings.py
npm --prefix frontend run test -- src/tests/api/businessQuery.test.ts
npm --prefix frontend run typecheck
```

结果：

- 后端：`9 passed`，2 warnings（既有 pytest config / proxy_resolver DeprecationWarning）。
- 前端 API：`13 passed`。
- 前端 typecheck：通过。
- 说明：该切片仅证明 asset contract、schema validator、loader 与前端 asset kind 类型扩展通过，不证明 resolver runtime、list_profile runtime、multi-step orchestrator、pagination 已实现。

2026-08-17，BQ-L01/BQ-L02 后端实体级 `list_profile` 校验切片：

```bash
cd /Users/ghy/work/biz-ontology-platform
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -p no:cacheprovider backend/tests/test_business_query_list_profile.py
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -p no:cacheprovider backend/tests/test_business_query_settings.py backend/tests/test_business_query_list_profile.py
```

结果：

- `test_business_query_list_profile.py`：`5 passed`，2 warnings（既有 pytest config / proxy_resolver DeprecationWarning）。
- settings + list_profile 回归：`14 passed`，2 warnings。
- 说明：该切片只证明后端实体级 `list_profile` schema 与保存链路校验，不证明前端 `OntologyEditorPage` 已具备表格化配置，也不证明 runtime 已消费 `list_profile`。

2026-08-17，BQ-R01~BQ-R05 resolver runtime 基础切片：

```bash
cd /Users/ghy/work/biz-ontology-platform
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -p no:cacheprovider backend/tests/test_business_query_entity_resolver.py
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -p no:cacheprovider backend/tests/test_business_query_settings.py backend/tests/test_business_query_list_profile.py backend/tests/test_business_query_entity_resolver.py
```

结果：

- `test_business_query_entity_resolver.py`：`3 passed`，2 warnings。
- settings + list_profile + resolver 回归：`17 passed`，2 warnings。
- 说明：该切片证明 resolver catalog、exact_then_fuzzy、0/1/多命中、候选脱敏、executor context 传递；尚未证明真实 SQL executor 完整注入 tenant/deleted/context_filters，也未接入 orchestrator。

2026-08-17，BQ-M01~BQ-M04 multi-step template validator/runtime 切片：

```bash
cd /Users/ghy/work/biz-ontology-platform
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -p no:cacheprovider backend/tests/test_business_query_multi_step_validator.py
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -p no:cacheprovider backend/tests/test_business_query_service.py
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -p no:cacheprovider backend/tests/test_business_query_chat_service.py backend/tests/test_business_query_service.py backend/tests/test_business_query_multi_step_validator.py
```

结果：

- `test_business_query_multi_step_validator.py`：`6 passed`，2 warnings。
- `test_business_query_service.py`：`15 passed`，2 warnings。
- chat + service + validator 回归：`25 passed`，2 warnings。
- 已验证事实：
  - `ask_business_data` 可消费已验证 `_multi_step_queries.yaml` 模板；
  - resolver 可以来自已配置 `business_query.resolver_domains`，不是只能来自当前业务域；
  - 跨连接 resolver -> 业务查询通过 platform 多步传递内部变量，未生成 SQL JOIN；
  - 多 resolver 命中时返回澄清，不默认取第一个；
  - `diagnostics.multi_step` / `diagnostics.pagination` 可进入验证页安全事件；SQL、MCP URI、raw rows、内部 id 仍不进入用户回答。
- 修复过的问题：
  - `service._ontology_root()` 原先优先读取 `BIZ_ONTOLOGY_ROOT`，在语义索引路径存在真实环境变量时会导致一次请求中后续 multi-step asset 读取漂移到真实 ontology 目录；已改为显式 `business_query.ontology.root` / `ontology.directory` 优先，`BIZ_ONTOLOGY_ROOT` 仅作兼容兜底。
- 未完成事实：
  - 还没有独立 `orchestrator.py` 文件；当前 runtime 先内聚在 `service.py`，功能通过 service 门阀验证，后续可机械拆分。
  - Redis page session / `next_page_token` 服务端状态尚未完成；当前 `page_token` 走 fail-safe，不算 BQ-P02~BQ-P05 完成。
  - LLM dynamic plan proposal / pending candidate 尚未完成，BQ-M06/BQ-M07 仍为 `todo`。

2026-08-17，BQ-P01/BQ-F01/BQ-F06 API 与验证页事件切片：

```bash
cd /Users/ghy/work/biz-ontology-platform
npm --prefix frontend run test -- src/tests/api/businessQuery.test.ts
npm --prefix frontend run test -- src/tests/views/BusinessQueryChatPage.test.ts
npm --prefix frontend run typecheck
```

结果：

- 前端 API 契约：`13 passed`。
- 问数验证页契约：`2 passed`。
- 前端 typecheck：通过。
- 已验证事实：
  - `BusinessQueryDomainAssetKind` 支持 `resolvers` / `multi_step_queries`；
  - chat/debug payload 类型支持 `page` / `page_size` / `page_token`；
  - 验证页使用 `/api/ai/business-query/chat/stream` event-stream，不是同步等待；
  - 页面发送 `domain_key` 和可编辑 `caller_context`。

2026-08-18，BQ-P02~BQ-P05 page session / page token 切片：

```bash
cd /Users/ghy/work/biz-ontology-platform
PYTHONPYCACHEPREFIX=/tmp/bizont-pycache PYTHONDONTWRITEBYTECODE=1 python3 -m py_compile backend/services/business_query/service.py backend/services/business_query/pagination.py backend/services/business_query/caller_context.py
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -p no:cacheprovider backend/tests/test_business_query_pagination.py backend/tests/test_business_query_caller_context.py backend/tests/test_business_query_service.py backend/tests/test_business_query_chat_service.py backend/tests/test_business_query_multi_step_validator.py -q
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -p no:cacheprovider backend/tests/test_config_env.py backend/tests/test_business_query_pagination.py backend/tests/test_business_query_service.py
npm --prefix frontend run test -- src/tests/api/businessQuery.test.ts src/tests/views/BusinessQueryChatPage.test.ts
npm --prefix frontend run typecheck
```

结果：

- Python 语法检查：通过。
- pagination + caller_context + service + chat + validator 回归：通过。
- config + pagination + service：`23 passed`，2 warnings（既有 pytest config / proxy_resolver DeprecationWarning）。
- 前端 API / 验证页测试：通过。
- 前端 typecheck：通过。
- 已验证事实：
  - 新增 `backend/services/business_query/pagination.py`，提供 `PageSessionRepository` 抽象、memory adapter、Redis adapter、TTL、opaque token、完整 caller_context hash；
  - `business_query.pagination` 已进入默认配置与 `config.yaml.template`，`.env.example` 增加 `BUSINESS_QUERY_REDIS_URL`；
  - 多步列表第一页按 `page_size + 1` 判断是否还有下一页；
  - 存在 `user_id/session_id` 等用户/会话级身份绑定时才签发 `next_page_token`；
  - 缺少用户/会话级身份绑定时第一页仍可返回，但不签发 `next_page_token`，diagnostics 记录 `missing_identity_binding`；
  - 使用 `page_token` 查询下一页时，不重跑 resolver，只执行最终业务查询步骤；
  - `caller_context` hash 不匹配时 fail-safe，且不会执行 SQL；
  - 过期/缺失 token 返回 `PAGE_TOKEN_EXPIRED`，不重放查询。
- 安全审查结论：
  - 曾否决“只按 tenant 或不强制身份字段签发 page token”的方案，因为 token 被同租户其他用户复制后可能复用；
  - 当前落地方案强制要求 user/session 级上下文绑定，业务应用若需要分页 token，必须通过 MCP/平台适配层传入 `user_id`、`session_id` 或等价身份变量。
- 未完成事实：
  - Redis adapter 已实现但未跑真实 Redis 集成测试；BQ-P02 暂标 `implemented`，不是 `verified`；
  - 前端暂未提供“下一页”交互控件，只是 API / stream contract 可承载 token；
  - 单步动态列表的分页 token 还未实现，本切片覆盖 multi-step list。

2026-08-18，BQ-F04/BQ-F05 BusinessDomainPage 问数资产表格化切片：

```bash
cd /Users/ghy/work/biz-ontology-platform
npm --prefix frontend run typecheck
npm --prefix frontend run test -- src/tests/views/BusinessDomainPage.test.ts
```

结果：

- 前端 typecheck：通过。
- `BusinessDomainPage.test.ts`：`7 passed`。
- 已验证事实：
  - BusinessDomainPage 不再把 `_metrics.yaml/_verified_queries.yaml/_resolvers.yaml/_multi_step_queries.yaml` 暴露为 YAML textarea；
  - 页面内部仍通过 `getBusinessQueryDomainAsset()` / `updateBusinessQueryDomainAsset()` 读取/保存 domain asset，这是后端已冻结的 contract；
  - 指标/维度编辑支持实体、字段、允许维度、允许过滤字段选择器；
  - 已验证模板编辑支持问法、实体、指标、维度、过滤字段选择器，SQL 仍只允许 metadata，不允许保存可执行 SQL 原文；
  - 新增 resolver 表格编辑入口，覆盖 key/entity/exact_fields/fuzzy_fields/output_fields/display_fields/mask/max_candidates；
  - 新增 multi-step 表格/分步编辑入口，覆盖 question_patterns、entity_resolve step、business_query step、filters、aggregate/list、review_state；
  - 页面保存时内部生成 YAML，由后端 validator 二次校验实体/字段/指标/维度/resolver/multi-step 引用，前端不自行绕过安全校验。
- 未完成事实：
  - 该门阀仍是源码契约测试 + typecheck，尚未跑浏览器真实交互/E2E；
  - 保存后 semantic dirty 的真实 UI 联动仍需浏览器验收；
  - 当时 OntologyEditorPage 的 `list_profile` / relationship usage 表格化尚未完成；后续已在同日 BQ-F02/BQ-F03 切片补齐，见下一条记录；
  - multi-step 当前 UI 覆盖已冻结的两步模板主路径，不代表任意复杂 DAG 编排器已经完成。

2026-08-18，BQ-F02/BQ-F03 OntologyEditorPage 实体级 list_profile / relationship usage 切片：

```bash
cd /Users/ghy/work/biz-ontology-platform
npm --prefix frontend run typecheck
npm --prefix frontend run test -- src/tests/views/OntologyEditorPage.businessQuery.test.ts
npm --prefix frontend run test -- src/tests/views/BusinessDomainPage.test.ts src/tests/views/OntologyEditorPage.businessQuery.test.ts
```

结果：

- 前端 typecheck：通过。
- `OntologyEditorPage.businessQuery.test.ts`：`2 passed`。
- BusinessDomainPage + OntologyEditorPage 组合门阀：退出码 0。
- 已验证事实：
  - `OntologyEditorPage` 的表单模型已包含 `entity.business_query.list_profile`，保存实体时写回 YAML；
  - `list_profile` 页面表格覆盖 enabled、default/max page size、stable_sort、default_sort、display_fields、filter_fields、value_match、mask、enum_ref；
  - relationship 行新增 `business_query.usage` 结构化编辑，覆盖 allowed_for_filter、allowed_for_display、allowed_for_join、resolver；
  - 跨库关系说明已从“Agent 接力查询合并”修正为“platform service 的多步问数编排”，避免职责边界倒退；
  - 这些配置继续由后端 `validate_entity_business_query_profile()` 在保存链路兜底校验。
- 未完成事实：
  - 仍未跑浏览器真实保存交互；
  - 仍未验证保存后业务域 semantic dirty 的完整 UI 联动；
  - relationship usage 当前进入 schema 与配置页面，runtime 消费范围仍受 multi-step validator/service 已实现能力限制；
  - `query_examples.sql` 作为历史/内部辅助资产仍保留，后续若要彻底去 SQL 化，需要另行迁移旧资产。

##### 5.5.20.8 Review 与合入门阀

每个切片必须执行：

1. **代码 review 自查**
   - 是否有硬编码业务域/实体/字段；
   - 是否有任意 SQL/where 配置入口；
   - 是否把 raw id/code 放进普通 answer；
   - 是否绕过 tenant/deleted/context_filters；
   - 是否把跨连接实现成 SQL JOIN；
   - 是否只做前端假配置，后端不消费。

2. **后端门阀**

   ```bash
   cd /Users/ghy/work/biz-ontology-platform
   PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -p no:cacheprovider backend/tests/test_business_query_settings.py
   PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -p no:cacheprovider backend/tests/test_business_query_service.py
   PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -p no:cacheprovider backend/tests/test_business_query_chat_service.py
   ```

   新增 runtime 后必须补跑 resolver/multi-step/pagination/eval 对应测试文件。

3. **前端门阀**

   ```bash
   cd /Users/ghy/work/biz-ontology-platform
   npm --prefix frontend run typecheck
   npm --prefix frontend run test -- src/tests/api/businessQuery.test.ts
   npm --prefix frontend run test -- src/tests/views/BusinessDomainPage.test.ts
   npm --prefix frontend run test -- src/tests/views/OntologyEditorPage.businessQuery.test.ts
   npm --prefix frontend run test -- src/tests/views/BusinessQueryChatPage.test.ts
   ```

4. **文档同步门阀**

   - 更新本节对应 ID 的状态；
   - 更新第 0 节追踪矩阵；
   - 记录测试命令与结果；
   - `git diff --check` 必须通过。

5. **人工 review 门阀**

   - 按 BQ-A/BQ-L/BQ-R/BQ-M/BQ-P/BQ-F/BQ-S/BQ-E/BQ-C/BQ-G 分组 review；
   - 任一组存在 `todo/draft/implemented` 且对应功能被声明“完成”，直接打回；
   - e2e 可后置，但必须明确不是完成状态。

---

## 6. 步骤 2：biz 后端新增 business_query platform service

### 6.1 新增模块

建议落点：

```text
backend/services/business_query/
  __init__.py
  service.py
  models.py
  caller_context.py
  domain_config.py
  ontology_loader.py
  semantic_catalog.py
  semantic_index_repository.py
  domain_router.py
  plan_builder.py
  plan_validator.py
  llm_fallback.py
  metric_catalog.py
  verified_query_repository.py
  eval_runner.py
  debug_service.py
```

命名可在实现中微调，但能力边界不能变。

当前实现命名事实：

- `biz-ontology-platform/backend/services/business_query/semantic_index.py` 已承载部分 semantic index、embedding、Qdrant adapter 能力；
- `policy.py` 已承载 display policy / 基础策略能力；
- `eval_set.py` 已承载 eval set 生成能力；
- 因此后续可以选择“继续拆分为 repository/provider/catalog 文件”或“在现有文件内拆出清晰 class/interface”，但必须在实现完成后更新本节和 16.1 的“已实现/待实现”清单，不能让文档文件名与真实代码长期不一致。

### 6.2 核心类型

必须定义：

- `BusinessQueryRequest`
- `BusinessQueryResponse`
- `CallerContext`
- `BusinessQueryPlan`
- `DomainCandidate`
- `EntityCandidate`
- `MetricCandidate`
- `Clarification`
- `SafeAnswer`
- `AuditMeta`

### 6.3 主流程

```text
BusinessQueryService.ask(question, caller_context)
  ↓
normalize
  ↓
domain routing
  ↓
entity / field / metric matching
  ↓
verified query / query template matching
  ↓
BusinessQueryPlan construction
  ↓
LLM fallback only when low confidence / ambiguity
  ↓
PlanValidator
  ↓
SQLGenerator
  ↓
SQLExecutor
  ↓
ResultSemanticProjector
  ↓
BusinessQueryResponse
```

### 6.4 LLM fallback

配置：

```yaml
business_query:
  llm_fallback:
    scene: business_query_plan
    timeout_ms: 8000
    max_attempts: 1
```

规则：

- 每次业务问数最多调用一次。
- 只允许生成 `BusinessQueryPlan` 草案或澄清问题。
- 不允许生成 SQL。
- 不允许生成最终用户答案。
- 输出必须经过 deterministic validator。
- 失败、超时、低置信时返回澄清，不继续猜。

### 6.5 验收

- service 层可被 MCP、REST、前端、eval runner 共同调用。
- MCP adapter 不包含业务问数核心逻辑。
- LLM fallback 单测证明不会输出 SQL。
- validator 单测证明非法字段、非法关系、缺失基础 tenant/deleted 策略都 fail closed。

---

## 7. 步骤 3：biz 后端重写 SQL executor 与 policy/display 投影

### 7.1 SQL executor 输入

旧形态：

```text
query_database(connection, sql, purpose, session_id, round_num)
```

新形态：

```text
BusinessQueryPlan + CallerContext + AccessPolicy
```

### 7.2 必须保留和强化的安全约束

- 只读查询。
- 仅允许受控 AI view。
- 禁止跨连接越权。
- tenant 强制过滤。
- deleted 强制过滤。
- 实体没有 tenant/deleted 字段时，必须显式 `not_applicable` 才允许不过滤。
- parser 失败 fail closed。
- metadata 缺失 fail closed。
- policy 缺失 fail closed。
- SQL statement timeout。
- max rows。
- SQL 指纹。
- 审计日志。
- 错误脱敏。

### 7.3 AccessPolicy

本轮边界：

- 本轮只实现 SQL 执行器必须具备的基础数据边界：tenant/deleted、只读、受控 view、跨 connection 防呆、缺失策略 fail closed；
- 完整数据权限 hook、角色/组织/行列权限、审计管理端作为后续专项，不纳入本轮完成定义；
- 名称可暂用 `AccessPolicy`，但文档与实现不得把它扩展成完整权限系统。

配置层级：

```text
global default deny
  ↓
connection policy
  ↓
domain override
  ↓
entity override
```

AI 可以生成：

```yaml
suggested_access_policy:
```

但运行时只认：

```yaml
access_policy:
```

### 7.4 DisplayPolicy

默认：

```yaml
display_policy:
  default_raw_id_code_visible: false
```

规则：

- `id`、`*_id`、join key、tenant、deleted 默认隐藏。
- `*_code` 默认隐藏，除非语义层明确标记为业务编号。
- 枚举字段优先展示翻译值。
- 缺失枚举映射时不得编造。
- SQL/raw columns/raw rows 只进入 audit/debug，不进入普通用户结果。

### 7.5 验收

- 问“固有风险等级”时，展示中文业务字段与枚举值。
- 不展示 `MAJOR` / `GENERAL` / `LOW` 原始 code，除非用户明确要求且 display policy 允许。
- 所有风险管控查询都强制过滤 `tenant` 和 `deleted`，除非实体显式 `not_applicable`。
- SQL 原文不进入普通用户回答。

---

## 8. 步骤 4：biz MCP 新增 ask_business_data，物理清理旧工具

### 8.1 新工具

新增 MCP 工具：

```text
ask_business_data
```

职责：

- 接收用户业务问题。
- 接收 caller context。
- 调用 platform `BusinessQueryService.ask(...)`。
- 返回安全 `structuredContent`。
- `content` 只放简短安全摘要。
- `_meta` 只放审计/调试信息。

### 8.2 outputSchema

必须声明结构化输出，至少包含：

```json
{
  "status": "answered | needs_clarification | failed",
  "answer": {
    "summary": "string",
    "columns": [],
    "rows": [],
    "warnings": []
  },
  "clarification": {
    "question": "string",
    "options": []
  }
}
```

状态枚举统一口径：

```text
answered              已回答，answer 可用于普通用户展示
needs_clarification   需要澄清，clarification 必须有 question/options
failed                安全失败或无法回答，answer 只允许业务化失败说明
```

禁止新增未登记状态，例如 `success`、`error`、`clarify`、`no_answer`。如果实现需要扩展状态，必须先更新本节、API contract、前端类型、MCP outputSchema 和 eval runner。

### 8.3 删除旧工具

必须物理清理：

- `query_database` MCP tool。
- `resolve_business_query` 普通 agent 可见入口。
- tools/list 注册。
- HTTP / stdio server 注册。
- config exporter。
- descriptor 示例。
- tests fixtures。
- docs 示例。

管理员调试如需要 SQL，只能通过受控平台管理 API 或服务端日志，不通过普通 MCP tool。

### 8.4 验收

- `tools/list` 不出现 `query_database`。
- `tools/list` 不出现旧 `resolve_business_query`。
- 普通 agent 只能看到 `ask_business_data`。
- 调用 `ask_business_data` 时，`content` 不含 SQL/MCP URI/tool args。
- `_meta` 不被复制进 `content`。

---

## 9. 步骤 5：biz 前端同步改造

### 9.1 涉及页面

- `frontend/src/views/EvalPage.vue`
- `frontend/src/views/BusinessDomainPage.vue`
- `frontend/src/views/OntologyEditorPage.vue`
- `frontend/src/views/WorkbenchPage.vue`
- `frontend/src/api/*`
- `frontend/src/router/index.ts`

### 9.2 QuestionBankPage 删除与能力迁移

本轮决策：

- 独立旧 `QuestionBankPage.vue` 从可访问路由中删除；
- `_question_bank` 文件继续作为内部语义资产与 eval 候选来源；
- candidate question、verified eval case、`pending_manual_review`、`verified_by`、`verified_at`、Accept/Edit/Dismiss 等评测相关能力并入 `EvalPage.vue`；
- 如果保留旧文件仅作组件代码复用，也不得保留旧路由、菜单、页面标题或旧问数入口文案。

禁止：

- 把 `review_state=ai`、`confidence=0.0` 展示成已验证。
- 留下隐藏 URL 可访问的旧 question bank 页面。

### 9.3 EvalPage

必须支持：

- `_eval_set.yaml` case 结构。
- 50 条风险管控 eval 分类。
- 人工确认状态。
- candidate question / verified eval case 的 review 流程。
- 门阀结果。
- 失败详情。
- 安全泄漏断言展示。
- 准确性分项指标：domain/entity/field/filter/group-by/presentation/clarification。
- stale eval set 提示。

### 9.4 BusinessDomainPage

必须支持：

- 业务域树。
- 实体绑定。
- 问数候选域启用/禁用。
- 候选域关键词维护。
- 候选域实际 connection/path/source 展示。
- 多 connection 节点禁止启用提示。
- domain routing 召回结果。
- semantic index 状态：fresh / dirty / failed。
- semantic index 内容分布：domain/entity/field/synonym/query_example/question_bank。
- 最近重建时间。
- 失败原因。
- retry 入口。
- 高风险领域 dirty 行为。
- display policy 只读摘要。
- 保存后 `requires_rebuild` 提示。

### 9.5 OntologyEditorPage

必须支持：

- 基础 access policy（tenant/deleted，不包含完整权限治理）；
- display policy；
- metric catalog；
- synonyms；
- enums；
- `suggested_*` 与正式配置分离。

### 9.6 WorkbenchPage

必须支持：

- 调试问数走新的 business query API。
- 展示用户可见结果。
- 展示脱敏 debug 区域；完整 audit 管理端后置。
- 不再给普通用户提供任意 SQL 输入/执行入口。

### 9.7 前端验收

- 普通用户 UI 看不到旧 SQL/MCP 工具入口。
- 普通用户 UI 看不到 SQL 原文、MCP URI、tool args JSON。
- eval 页面能看到每条安全断言结果。
- 旧 QuestionBank 路由不可访问；评测候选与已验证状态只在 Eval 页面或新评测区域展示，且不混淆。
- 业务域页面启用候选域后，不需要手写 `config.yaml` 即可被 `ask_business_data` 使用。
- 候选域关键词保存后，路由 diagnostics 能看到 keyword 命中。
- 页面保存配置不得把 `${ENV}` 展开后的真实 key 写回 `config.yaml`。

---

## 10. 步骤 6：biz 配置闭环、关键词闭环、现有语义资产复用与调试入口补齐

本步骤是 2026-08-17 启动验证阶段补充出来的闭环步骤。它不是新增优先级，而是为了修正“页面配置、本体资产、运行时问数、语义索引、评测和 MCP 导出之间没有完全打通”的实现缺口。

### 10.1 配置闭环

必须新增或改造：

```text
backend/services/business_query/domain_config.py
backend/routers/business_domains.py
frontend/src/api/businessDomain.ts
frontend/src/views/BusinessDomainPage.vue
```

要求：

- 业务域页面能把选中节点启用为 `business_query.ontology.domains.<domain_key>`；
- `domain_key` 由页面显式保存，不能由运行时写死；
- 后端保存配置时只 patch `business_query.ontology.domains.<domain_key>`；
- 禁止通过 `get_config()` 展开环境变量后整段写回；
- 如果业务域传播到多个 connection，不能启用，必须要求用户选择更细子域；
- 如果业务域没有传播实体，不能启用；
- `risk_control` 只能来自样例配置或用户页面配置，不能作为代码默认值。

验收：

- 页面启用候选域后，`ask_business_data` 可立即读取该候选域；
- 页面禁用候选域后，`ask_business_data` 不再路由到该候选域；
- 修改关键词不会删除其他候选域、database、llm、ai_assist 配置；
- 配置保存后文件中仍保留 `${ENV}` placeholder，不出现真实 API key。

### 10.2 关键词闭环

必须新增或改造：

```text
backend/services/business_query/service.py
backend/services/business_query/semantic_catalog.py
backend/services/business_query/semantic_index_repository.py
frontend/src/views/BusinessDomainPage.vue
```

要求：

- 候选域支持 `keywords`；
- domain router 读取 `business_query.ontology.domains.<domain_key>.keywords`；
- 关键词命中必须进入 routing diagnostics；
- 关键词修改后返回 `requires_rebuild=true`；
- 关键词 fallback 路由不依赖向量库，保存后应热生效；
- 向量召回使用新关键词必须等待索引重建。

验收：

- “隐患/风险清单/风险单元”等业务域关键词能影响 domain routing；
- diagnostics 能展示 matched domain keywords；
- 关键词只保存不生效视为不合格。

### 10.3 现有语义资产复用

必须复用：

- `entity.synonyms`；
- `entity.query_examples`；
- `attributes[*].display_name`；
- `attributes[*].description`；
- `attributes[*].enum_values`；
- `_question_bank` 中可安全作为意图样例的问题文本。

边界：

- `_question_bank` 中的 SQL 只能作为内部验证/评测资产，不得进入普通用户输出；
- 独立旧 `QuestionBankPage` 页面和路由必须删除；
- `_question_bank` 资产由 Eval 页面/语义索引构建流程复用，不提供旧问数入口。

验收：

- 语义索引重建结果能分别统计 synonyms/query_examples/question_bank；
- query_examples 中已有问法能提升对应实体召回；
- 普通用户输出不出现 SQL、MCP URI、tool args、raw id/code。

### 10.4 semantic index repository 抽象

用户已确认：不能把 Qdrant 写成业务层固定依赖。Qdrant 是当前本地验证和首个 adapter，不是领域服务的抽象边界。

必须新增或明确：

```text
backend/services/business_query/semantic_index_repository.py
backend/services/business_query/qdrant_semantic_index_repository.py
```

要求：

- business_query service 只依赖 repository interface；
- Qdrant 只出现在 adapter/配置层；
- 配置项可写 `repository: qdrant`，但业务代码不能直接依赖 Qdrant client；
- embedding provider 当前可先固定为 qwen `qwen3.7-text-embedding`，但调用边界要保留 provider/factory 设计，避免后续供应商参数差异污染业务服务。

验收：

- `rg -n "Qdrant|qdrant" backend/services/business_query` 只允许在 adapter、配置解析、测试中出现；
- service/domain_router/plan_builder 不直接 import Qdrant client。

### 10.5 问数调试入口

必须新增或改造：

```text
backend/services/business_query/debug_service.py
backend/routers/ai_business_query.py
frontend/src/views/WorkbenchPage.vue
frontend/src/views/BusinessDomainPage.vue
```

要求：

- 管理端能输入自然语言问题直接验证 `ask_business_data`；
- 展示安全 answer；
- 展示脱敏 `diagnostics.routing_trace`；
- 不展示完整 SQL、MCP URI、tool args、raw rows、真实 id/code；
- 支持从业务域页面跳转并带上候选 `domain_key`。

命名统一：

- platform service 内部可以继续使用 `diagnostics`；
- 面向管理端 API 时，路由解释统一放在 `diagnostics.routing_trace`；
- `routing_trace` 至少包含 `domain_candidates/selected_domain/entity_candidates/matched_keywords/matched_synonyms/semantic_candidates/selected_entity_reason`；
- 普通 MCP `content/structuredContent` 不包含 `diagnostics`。

验收：

- 用户不需要接入外部 Agent/MCP 就能验证问数是否可用；
- 能解释“为什么选中了这个业务域/实体/字段”；
- 诊断信息只在管理端出现，普通聊天输出不包含诊断。

### 10.6 MCP 配置导出与 prompt 对齐

必须新增或改造：

```text
backend/services/ai_assist/mcp_config_exporter.py
backend/services/prompt_generator.py
prompts/system_prompt.md
```

要求：

- MCP 导出验证问题从当前候选域动态生成；
- 没有候选域时，不生成业务问数验证问题；
- 不允许硬编码“风险管控 / risk_control / SmRisk*”；
- prompt 中关于 query_examples、_question_bank、业务问数能力的描述必须和实际 runtime 能力一致。

验收：

- 默认产品导出配置不含风险管控样例；
- 加载风险管控验证配置后，验证问题来自候选域实体；
- prompt 不声明尚未接入 runtime 的能力。

### 10.7 Eval 与配置 fingerprint 绑定

必须新增或改造：

```text
backend/services/business_query/eval_runner.py
frontend/src/views/EvalPage.vue
```

要求：

- Eval 支持选择 `domain_key`；
- Eval set 记录 `domain_key/source/keywords/config_fingerprint`；
- 执行前校验 fingerprint；
- 过期 eval set 必须提示重新生成；
- 业务域页面能跳转生成当前候选域 eval set。

验收：

- 多候选域时不会随机评测第一个域；
- 关键词变化后旧 eval set 变 stale；
- 合入门阀报告中能看到 domain_key 与 fingerprint。

---

## 11. 步骤 7：cube MCP host 工具结果投影与最终回答 guard

### 11.1 工具结果投影

新增或增强：

```text
packages/agent/engine/src/bc/tools/tool-result-visibility.ts
```

职责：

- 根据工具结果结构区分 model-visible / user-visible / audit-only。
- 优先使用 MCP `structuredContent.answer`。
- `_meta` 不进入模型上下文。
- SQL、MCP URI、tool args、raw id/code 默认不可见。
- 脱敏必须覆盖六类：
  1. SQL 原文、SQL 片段、fenced SQL block；
  2. MCP URI、内部 MCP tool name、历史 `query_database` 引用；
  3. tool args JSON、argumentsPreview、raw request/response JSON；
  4. raw rows、raw columns、技术 id、技术 code、join key；
  5. tenant、deleted、session_id、round_num、traceId、nodeId 等上下文字段；
  6. API key、token、provider error、internal stack、连接串、上游错误原文。

### 11.2 MCP handler 接入点

改造：

```text
packages/agent/engine/src/bc/tools/handlers/mcp-handler.ts
```

要求：

- MCP 工具返回后立即投影。
- 传给模型的不是原始 MCP result。
- tool call preview 中 SQL 脱敏。

### 11.3 grounding / prefetch

改造：

```text
packages/agent/engine/src/bc/tachu/engine-factory.ts
```

要求：

- 不再对原始 object 直接 `JSON.stringify` 后送入 grounding/prefetch。
- prefetch 也必须走同一投影器。

### 11.4 最终回答 guard

新增或增强：

```text
packages/agent/engine/src/bc/session/final-answer-visibility-guard.ts
```

规则：

- 敏感工具调用后，最终输出进入安全缓冲。
- 命中 SQL/MCP URI/tool args/raw JSON/provider error/internal stack 时拦截。
- 拦截后返回业务化失败说明，不泄漏原文。
- 自定义 agent 也受此规则约束。
- guard 检测清单必须至少覆盖：
  - `select|insert|update|delete|with|from|where|group by|order by|limit` 等 SQL 结构；
  - ```sql fenced block；
  - `mcp://`；
  - `mcp.biz-ontology.query_database`；
  - `query_database(`；
  - JSON 中的 `"sql"`、`"connection"`、`"purpose"`、`"session_id"`、`"round_num"`、`"arguments"`；
  - 常见 raw id/code 字段：`id`、`*_id`、`*_code`、`tenant`、`tenant_id`、`deleted`；
  - provider/internal 错误：`Traceback`、`stack`、`UPSTREAM_`、`Api key`、`token`、`Bearer`。

### 11.5 验收

- MCP raw content 含 SQL 时，模型最终输出不含 SQL。
- MCP `_meta` 不进模型。
- 最终回答含 `mcp://` 时被拦截。
- 自定义 agent 同样生效。
- 六类脱敏样例均有单测覆盖。
- guard 检测清单中的每类命中均有正例/反例测试，避免把普通中文误杀为 SQL。

### 11.6 descriptor / custom agent 旧工具引用 fail-closed

历史事实：

- 2026-08-17 第一轮扫描时，`descriptors/agents/1934000000000000003.yaml` 仍引用 `mcp.biz-ontology.query_database`；
- 当时这不是文档问题，而是实际可扫描到的安全残留；
- 只删除 MCP server tool 不够，descriptor/custom agent 仍可能把旧工具名带入工具选择或提示词。

当前实现事实（2026-08-17 复验口径）：

- `descriptors/agents/1934000000000000003.yaml` 已迁移到 `mcp.biz-ontology.ask_business_data`；
- `assemble-tachu-runtime` 的 discovery expansion 已围绕 `ask_business_data` 建立受控 sibling 策略；
- 配套测试保留旧 `mcp.biz-ontology.query_database` 不再出现在 expansion map 的断言，用于防回归；
- 禁止自动把 `query_database` 静默替换为 `ask_business_data` 的规则仍保留，因为二者 input/output 语义不同。

验收：

- `rg -n "mcp\\.biz-ontology\\.query_database|query_database\\(" descriptors packages apps` 只允许出现在迁移测试、历史 ADR 或文档说明，不允许作为 descriptor、runtime 配置或工具声明出现；
- 普通启动/加载 descriptor 时遇到旧工具引用必须失败，不允许 agent 静默启动；
- 迁移后 descriptor 不再引用旧 SQL 工具。

---

## 12. 步骤 8：MCP progress/status 标准链路

### 12.1 已确认事件链路

```text
MCP _meta.progressToken
  ↓
notifications/progress
  ↓
McpBridgeService onProgress callback
  ↓
EngineFactory progress queue / progress chunk
  ↓
SSE event: tool.call.progress
  ↓
assistant SDK reasoning/tool timeline
```

### 12.2 payload

```json
{
  "schema": "tool-call-progress-v1",
  "turnId": "...",
  "toolCallId": "...",
  "toolName": "mcp.biz-ontology.ask_business_data",
  "status": "sql_executing",
  "display": {
    "text": "正在查询并整理结果"
  },
  "progress": 0.6,
  "time": 1786500000000
}
```

### 12.3 规则

- 普通用户只看到粗粒度文案。
- 详细内部阶段可通过 `status/meta` 进入受控 debug/audit；普通前端默认只展示 `display.text`。
- SQL、工具参数、内部错误不进入 progress 文案。
- `progress` 在 SSE 合同中归一化为 `0..1`。
- MCP HTTP Streamable transport 已支持流式解析 SSE，不能退回到等待 `resp.text()` 完成后再处理。

### 12.4 验收

- 长查询期间 assistant SDK 能收到并消费 `tool.call.progress`，应用对话 UI 能展示安全 `progressText`。
- progress 不泄漏 SQL。
- progress 能按 `toolCallId` 关联。
- 连接结束后清理 progress 状态。
- Streamable HTTP `text/event-stream` 必须保持响应体流式解析，不能退回只依赖 `resp.text()` 完成后处理。
- `biz-ontology-platform` 自身的“业务问数对话验证”页面也必须使用 `text/event-stream`：先展示 receive/model/ask_business_data/safe_projection/llm_answer 等安全步骤事件，最终再展示安全投影答案；不得用同步 JSON 让用户等待 10s+ 后一次性返回。
- event-stream 事件内容只允许包含步骤名、状态、耗时、安全说明、`summary/columns/rows/warnings/clarification` 与脱敏 diagnostics；SQL、MCP URI、工具参数、raw rows、内部 ID/code 不得进入普通回答区。
- “业务问数对话验证”页面必须提供本次请求 `caller_context` 编辑入口，并展示 `business_query.context.variables` 映射关系；发送 stream 请求时必须把 `caller_context` 随请求体传给 platform，用于解析 `${context.xxx}` 条件占位。

---

## 13. 步骤 9：风险管控 eval 50 条候选生成与人工确认

### 13.1 来源

主要来源：

```text
/Users/ghy/test/bizont-kaihe/ontology/风险管控
```

可用资产：

- `_question_bank.yaml`
- entity `query_examples`
- entity attributes
- enum_values
- relationships
- constraints

### 13.2 数量结构

```text
20 条：风险管控正常业务问数
10 条：风险管控聚合 / 指标 / TopN / 趋势
8 条：tenant / deleted / display_policy / 安全边界
6 条：跨域或歧义 / 需要澄清
6 条：安全泄漏防护
```

### 13.3 case 结构

```yaml
- id: risk_normal_001
  domain: 风险管控
  category: normal
  question: "..."
  caller_context:
    tenant_id: "1"
    user_id: "..."
  expected:
    intent: "detail|aggregate|topn|trend|compare|clarify"
    domains: ["风险管控"]
    entities: []
    metrics: []
    dimensions: []
    filters: []
    presentation:
      required_fields: []
      forbidden_fields: []
      forbidden_patterns:
        - sql
        - mcp_uri
        - raw_id
        - raw_code
        - internal_error
  fixture: null
  verified_by: pending_manual_review
```

### 13.4 人工确认流程

```text
抽取候选
  ↓
生成 expected 草案
  ↓
标记 pending_manual_review
  ↓
人工确认或修正
  ↓
verified_by: manual
  ↓
进入合入门阀
```

### 13.5 规则

- `_question_bank.yaml` 中 `review_state=ai`、`confidence=0.0` 的问题只能作为候选。
- AI 可辅助生成 expected，但不能直接进入门阀。
- 每条 case 必须有可执行断言。
- 安全泄漏 case 必须 0 容忍。

---

## 14. 步骤 10：跨仓库集成测试与性能基线

### 14.1 必须复现

复现原始问题：

```text
帮我查固有风险等级
```

旧行为：

- 可能输出 SQL。
- 可能输出 MCP URI。
- 可能输出 `connection=风险管控`、session_id、round_num。

新行为：

- 返回业务化回答。
- 展示“风险单元 / 固有风险等级”等中文字段。
- 枚举翻译为“重大 / 一般 / 低”。
- 不展示 SQL/MCP URI/tool args/raw id/code。

### 14.2 人工验收问题

```text
帮我查固有风险等级
按固有风险等级统计风险单元数量
风险等级怎么样？
查一下风险单元明细
证实方法有哪些？
```

说明：

- 前 4 个用于风险管控问数。
- “证实方法有哪些？”用于确认非问数/知识库问题不会误走问数。

### 14.3 性能基线

实施前必须采集：

- domain routing 耗时；
- semantic recall 耗时；
- LLM fallback 耗时；
- SQL 执行耗时；
- result projection 耗时；
- answer composing 耗时；
- 总耗时 p50/p95。

当前目标门阀：

```text
简单高频问数：p50 ≤ 8s，p95 ≤ 20s
中等动态问数：p50 ≤ 15s，p95 ≤ 40s
复杂问数：同步等待，默认总上限 60s
单条 SQL：默认上限 30s
```

这些是目标门阀，不是当前事实基线；实施前必须采集真实基线。

---

## 15. 步骤 11：合入门阀

### 15.1 cube-ai-project

必须通过：

```bash
bun run typecheck
bun test
```

关键新增/增强测试：

- `packages/agent/engine/src/bc/tools/tool-result-visibility.test.ts`
- `packages/agent/engine/src/bc/tools/tool-argument-redaction.test.ts`
- `packages/agent/engine/src/bc/session/final-answer-visibility-guard.test.ts`
- `packages/agent/engine/src/bc/session/final-answer-visibility-guard-patterns.test.ts`
- `packages/agent/engine/src/bc/tools/descriptor-tool-reference-guard.test.ts`
- `packages/agent/engine/src/bc/tools/handlers/mcp-handler.test.ts`
- `packages/agent/engine/src/bc/tachu/assemble-tachu-runtime.test.ts`
- `packages/agent/engine/src/bc/tachu/engine-factory.test.ts`
- `packages/agent/engine/src/bc/session/tachu-sse-mapper.test.ts`

已知测试残留必须迁移：

- `packages/agent/engine/src/bc/tachu/assemble-tachu-runtime.test.ts` 当前仍覆盖“pinning `mcp.biz-ontology.query_database` 时自动展开 discovery siblings”的旧行为；该测试必须改为验证旧 `query_database` 引用 fail-closed，以及新 `ask_business_data` 对应的受控 discovery 策略。

2026-08-17 本轮复验事实：

```bash
cd /Users/ghy/work/cube-ai-project
bun --cwd=packages/agent/engine run typecheck
bun test packages/agent/engine/src/bc/tools/tool-result-visibility.test.ts \
  packages/agent/engine/src/bc/session/final-answer-visibility-guard.test.ts \
  packages/agent/engine/src/bc/tachu/engine-factory.test.ts \
  packages/agent/engine/src/bc/session/tachu-sse-mapper.test.ts \
  packages/agent/engine/src/bc/tools/handlers/mcp-handler.test.ts \
  packages/agent/engine/src/bc/session/session.service.test.ts \
  packages/agent/engine/src/bc/tachu/assemble-tachu-runtime.test.ts
```

结果：

- `@cube-ai/agent-engine` typecheck 通过。
- 关键测试通过：107 pass / 0 fail / 303 expect calls。
- `assemble-tachu-runtime.test.ts` 已迁移为旧工具 fail-closed 与新 `ask_business_data` 受控 discovery 策略验证；不再验证旧 `query_database` discovery expansion。

### 15.2 biz-ontology-platform 后端

必须通过：

```bash
pytest
```

关键新增/增强测试：

- `backend/tests/test_business_query_tool_schema.py`
- `backend/tests/test_business_query_domain_config.py`
- `backend/tests/test_business_query_semantic_index.py`（已存在，必须增强为覆盖 keywords/synonyms/query_examples、dirty/fingerprint、repository=qdrant 状态）
- `backend/tests/test_business_query_eval_runner.py`
- `backend/tests/test_query_result_semantic_projection.py`
- `backend/tests/test_mcp_display_payload.py`
- `backend/tests/test_mcp_tool_compat.py`
- `backend/tests/test_query_database_removed_from_mcp.py`
- `backend/tests/test_business_query_eval_cases.py`
- `backend/tests/test_business_query_accuracy_gate.py`
- `backend/tests/test_business_query_verified_queries.py`
- `backend/tests/test_business_query_metrics_catalog.py`
- `backend/tests/test_business_query_dimensions.py`
- `backend/tests/test_business_query_access_policy.py`
- `backend/tests/test_business_query_display_policy.py`
- `backend/tests/test_semantic_vector_repository.py`
- `backend/tests/test_qwen_embedding_provider.py`
- `backend/tests/test_mcp_config_exporter.py`

2026-08-17 本轮复验事实：

```bash
cd /Users/ghy/work/biz-ontology-platform
python3 -m pytest backend/tests/test_business_query_legacy_question_bank_disabled.py \
  backend/tests/test_business_query_service.py \
  backend/tests/test_business_query_semantic_index.py \
  backend/tests/test_business_query_eval_runner.py \
  backend/tests/test_business_query_mcp_contract.py \
  backend/tests/test_mcp_display_payload.py \
  backend/tests/test_mcp_tool_compat.py \
  backend/tests/test_query_database_tenant_rewrite.py
```

结果：45 passed / 0 failed；存在 pytest `asyncio_mode` 未识别 warning，不影响测试退出码。本轮已使用 `-p no:cacheprovider` 避免沙箱 `.pytest_cache` 写入 EPERM 噪声。

### 15.3 biz-ontology-platform 前端

`frontend/package.json` 当前已有 `typecheck` 与 `test:run`。

2026-08-17 本轮复验事实：

```bash
cd /Users/ghy/work/biz-ontology-platform
npm --prefix frontend run typecheck
npm --prefix frontend run test:run -- src/tests/api/businessQuery.test.ts
npm --prefix frontend run test:run -- src/tests/api/businessDomain.test.ts
npm --prefix frontend run test:run -- src/tests/views/BusinessDomainPage.test.ts
npm --prefix frontend run test:run -- src/tests/router/businessQueryRoutes.test.ts
```

结果：

- `vue-tsc --noEmit` 通过。
- `businessQuery.test.ts`：6 passed / 0 failed。
- `businessDomain.test.ts`：14 passed / 0 failed。
- `BusinessDomainPage.test.ts`：2 passed / 0 failed。
- `businessQueryRoutes.test.ts`：1 passed / 0 failed。
- 沙箱内 Vitest 首次因 `frontend/node_modules/.vite-temp` 写入 EPERM 失败；非沙箱同命令通过。

必须通过：

```bash
pnpm --dir frontend typecheck
pnpm --dir frontend build
pnpm --dir frontend test:run
```

关键新增/增强测试：

- `frontend/src/tests/views/EvalPage.test.ts`
- `frontend/src/tests/views/EvalReviewFlow.test.ts`
- `frontend/src/tests/views/BusinessDomainPage.test.ts`
- `frontend/src/tests/views/OntologyEditorPage.test.ts`
- `frontend/src/tests/views/WorkbenchPage.test.ts`
- `frontend/src/tests/api/businessQuery.test.ts`
- `frontend/src/tests/api/businessDomain.test.ts`
- `frontend/src/tests/router/deprecatedRoutes.test.ts`

2026-08-17 本轮复验事实：

```bash
cd /Users/ghy/work/biz-ontology-platform
npm --prefix frontend run typecheck
npm --prefix frontend run test:run -- src/tests/api/businessDomain.test.ts src/tests/router/businessQueryRoutes.test.ts
npm --prefix frontend run test:run -- src/tests/router/businessQueryRoutes.test.ts
```

结果：

- `npm --prefix frontend run typecheck` 通过。
- API/路由测试通过；由于 Vite/Vitest 在沙箱内写 `node_modules/.vite-temp` 会 EPERM，真实测试在非沙箱执行。
- 单独复验路由测试通过：1 test passed，确认旧 `/question-bank` 路由不可访问断言实际执行。

### 15.3.1 biz-ontology-platform 内部问数对话验证页

2026-08-17 新增内部验证入口，目的不是替代 MCP，而是在接入 cube-agent 前先验证 platform 问数自身链路：

```text
后端 API:
/Users/ghy/work/biz-ontology-platform/backend/services/business_query/chat_service.py
POST /api/ai/business-query/chat

前端页面:
/Users/ghy/work/biz-ontology-platform/frontend/src/views/BusinessQueryChatPage.vue
/business-query-chat
```

设计事实：

- 该 API 先同步执行 `ask_business_data()`，确保 domain/entity/semantic/sql_executor/display projection 走同一条 platform 主链路；
- LLM 只在问数返回安全结构化结果后，用 `LlmClient.chat(scene="business_query_chat")` 生成自然语言回答；
- 模型配置来源为 `config.llm.primary.*`，可通过 `llm.scene_overrides.business_query_chat` 覆盖，但不得在代码写死 provider/model；
- 页面展示“执行过程 / 思考过程”指的是可审计执行 trace，不展示模型 chain-of-thought；
- trace 和最终回答均有内部查询/工具细节 guard，命中 SQL/MCP URI/tool args/raw diagnostics 时回退为结构化摘要；
- diagnostics 只展示 routing/plan/semantic/display_policy/duration 等安全摘要。

2026-08-17 本轮复验事实：

```bash
cd /Users/ghy/work/biz-ontology-platform
python3 -m pytest backend/tests/test_business_query_chat_service.py
python3 -m pytest backend/tests/test_business_query_chat_service.py \
  backend/tests/test_business_query_service.py \
  backend/tests/test_business_query_semantic_index.py \
  backend/tests/test_business_query_mcp_contract.py
npm --prefix frontend run typecheck
npm --prefix frontend run test:run -- src/tests/api/businessQuery.test.ts
npm --prefix frontend run test:run -- src/tests/router/businessQueryRoutes.test.ts
npm --prefix frontend run build
```

结果：

- 新增后端 chat service 测试通过：2 passed。
- 后端问数回归通过：21 passed。
- 前端 typecheck 通过。
- 前端 API 测试通过：3 tests passed。
- 前端路由测试通过：1 test passed。
- 前端 build 通过；存在既有 chunk size/plugin timing warning。

### 15.4 ghcloud-new 应用对话前端

适用路径：

```text
/Users/ghy/work/ghcloud-new/prod/cube/apps/ai-application/app
```

必须通过：

```bash
bun test src/views/assistant/assistant-thinking-mode.test.ts src/views/assistant/assistant-tool-labels.test.ts src/views/assistant/assistant-tool-payload-visibility.test.ts
```

全量类型/build 基线治理：

```bash
bun run typecheck
bun run build
```

如果当前仓库存在历史基线错误，不能直接忽略，必须满足以下条件才可继续合入本轮改造：

- 建立 `docs/technical-debt/ai-application-typecheck-baseline.md` 或等价基线记录；
- 基线记录必须包含失败命令、失败摘要、归属模块、是否与本次改造相关；
- 本次改动文件不得新增 typecheck/build 错误；
- 与本次改造相关的 assistant thinking/tool label/SDK 字段错误必须修复，不能放入基线；
- 最终合入说明必须明确“全量 typecheck/build 当前是否通过；如未通过，阻塞项是否为既有基线”。

验收：

- `ask_business_data` 在应用对话 UI 中展示为“业务问数”；
- thinking / tool card / steps / prose / feed 模式只展示安全 `progressText`；
- 普通用户可见的 tool card 详细面板不再原样展示 MCP tool args/output/error；
- tool payload 展示必须走可扩展 policy registry：核心 formatter 不允许新增 `if toolName === ...` 的分支；新增 MCP 工具只能通过注册策略，或由服务端返回 `displayPayload` / `safeDisplay` 这类已投影安全结果；
- 原始 tool payload 仅允许显式 debug 通道展示，例如本地 `localStorage` / 构建 env 开启 raw debug；普通用户默认不可见；
- 命中 SQL、MCP URI、raw JSON、tool args 痕迹的 progress/final text 不展示；
- 真实 agent 对话调用 `ask_business_data` 时，最终答案不含 SQL/MCP URI/tool args/raw id/code。

本项的事实依据：

- MCP 2025-06-18 tools 规范：工具可声明 `outputSchema`；server 必须让 `structuredContent` 符合 schema，client 应校验结构化结果；security 小节要求 server 清洗输出、client 在传给 LLM 前校验工具结果。见 `https://modelcontextprotocol.io/specification/2025-06-18/server/tools`。
- OpenAI Apps/Plugins 文档：工具结果中的 `structuredContent` 是模型可检查的简洁数据，`content` 帮助模型回答，`_meta` 是 client-specific 且对模型隐藏；同时要求工具 handler 自己做授权，不能依赖模型判断访问权限。见 `https://developers.openai.com/plugins/build/mcp-server` 与 `https://developers.openai.com/plugins/reference`。
- OpenAI Agents SDK MCP 文档：MCP server 可用静态或动态 `tool_filter` 只向某个 agent 暴露所需工具，说明成熟 host 不会把外部 MCP 工具无差别暴露给所有 agent。见 `https://openai.github.io/openai-agents-python/mcp/`。

### 15.5 0 容忍门阀

任意一项出现，不允许合入：

- 普通用户最终回答出现 SQL。
- 普通用户最终回答出现 `mcp://`。
- 普通用户最终回答出现 tool args JSON。
- 普通用户最终回答出现未授权 raw id/code。
- 缺失枚举映射时编造业务含义。
- `query_database` 仍作为 MCP 工具存在。
- `resolve_business_query` 仍作为普通 agent 可见工具存在。
- descriptor/custom agent 配置仍引用 `mcp.biz-ontology.query_database` 或旧 `resolve_business_query`。
- `assemble-tachu-runtime` 等工具路由扩展仍围绕旧 `query_database` 建立 discovery expansion。
- 前端仍存在普通用户可触达的任意 SQL 执行入口。
- 前端普通用户可见 tool card 仍原样展示 MCP tool args/output/error。
- 前端 tool payload 安全展示逻辑写死在共享 formatter 内部，导致新增 MCP 工具只能继续堆 `if toolName === ...`。
- debug/raw payload 开关默认开启，或普通用户无意中可触达。
- 前端把 AI 候选问题显示成已验证。
- 安全泄漏 eval 未达到 100%。权限/审计专项已明确后置，不作为本轮合入门阀；但本轮已实现的 tenant/deleted 基础约束不得被破坏。
- API contract 与 `5.5.14` 不一致，或前后端字段名不一致。
- 首批 50 条 eval 未建立或未人工确认。
- 问数准确性分项指标未达到 `5.5.15` 门阀。
- 生产代码、产品默认模板或脚本出现具体业务域/客户/调试路径硬编码，例如 `风险管控`、`risk_control`、`bizont-kaihe`、`/Users/ghy/test`、`SmRisk*`。
- 业务域页面无法启用/禁用问数候选域，仍要求用户手写 `business_query.ontology.domains`。
- 页面保存问数候选域或关键词后，`ask_business_data` 运行时未读取或未生效。
- 关键词只保存不参与 domain/entity/field 路由。
- 实体 YAML 中已有 `synonyms/query_examples` 完全未进入问数召回或语义索引，且文档/prompt 仍声明可参考它们。
- `_verified_queries.yaml` / `_metrics.yaml` / 维度建模缺失，导致 verified query、metric、dimension 门阀无法执行。
- 语义索引 status/rebuild 无法说明索引内容分布，无法判断 keywords/synonyms/query_examples 是否进入索引。
- 修改候选域、关键词、实体 YAML 后，语义索引没有 dirty/fingerprint 或等价过期提示。
- 问数调试入口缺失，导致配置后只能通过外部 MCP/Agent 验证。
- MCP 配置导出仍写死风险管控验证问题。
- 多候选域时 eval 生成/运行无法明确绑定 `domain_key`。
- 页面保存配置会把 `${ENV}` 展开后的真实 API key 写入 `config.yaml`。
- 废弃的旧问数页面、旧 fast_path、旧 `resolve_business_query` 入口仍可被普通用户访问。
- 六类脱敏或 guard 检测清单没有测试覆盖。
- ghcloud-new 应用对话前端 typecheck/build 基线未治理，且无法证明本次改动未新增类型/构建错误。

---

## 16. 需要修改的文件清单

### 16.1 biz-ontology-platform 后端

当前状态分组（2026-08-17 扫描与启动验证口径；实现 PR 必须复验并更新）：

- 已落地并已有自动测试覆盖：
  - `ask_business_data` MCP 入口与 platform service 调用链；
  - 旧低层 `query_database` 的只读、tenant/deleted、超时、错误脱敏等安全能力迁移到内部 SQL executor；
  - `business_query.semantic_index.repository` / `business_query.semantic_index.qdrant` 配置路径；
  - `business_query.display_policy.enum_unknown_strategy: raw_value` 配置路径；
  - `_verified_queries.yaml` / `_metrics.yaml` 资产读取、命中、provenance、metric/dimension catalog 的基础链路；
  - semantic index repository 抽象、Qdrant adapter、Qwen embedding provider；
  - semantic index `status/rebuild` 支持 `domain_key`，并返回 `dirty/indexed_at/indexed_fingerprint/current_fingerprint/content_summary/last_error`；
  - `backend/tests/test_business_query_semantic_index.py` 已覆盖语义资产入索引与 repository 状态；`backend/tests/test_business_query_service.py` 已补 dirty/fingerprint 用例；
  - `backend/tests/test_business_query_eval_runner.py` 已覆盖 eval set 人工 review 校验、安全泄漏失败、状态枚举、domain/entity routing、clarification、presentation 分项指标；
  - `/api/ai/business-query/debug` 已落地，复用 `ask_business_query_chat` 安全链路，不直接返回 SQL、MCP URI、tool args、raw rows。
- 仍需真实环境或人工验收，不能伪装成自动完成：
  - 首批 50 条风险管控 eval 的 `review_state=reviewed` 需要人工确认；AI 只能生成候选或 pending case；
  - Qdrant/embedding 的真实连通性、collection 维度、重建耗时和召回质量需要本地/联调环境验证；
  - 配置局部 patch 保存，避免展开 `${ENV}` 后写回真实密钥。
- 必须删除/迁移：
  - `query_database` / `resolve_business_query` 作为普通 MCP tool 或普通 agent 可见入口已删除/迁移；源码中仅允许防回归测试或历史文档出现旧名称。
- 已知风险残留：
  - 任何源码、模板或脚本中出现 `风险管控`、`risk_control`、`bizont-kaihe`、`/Users/ghy/test`、`SmRisk*` 作为产品默认硬编码，均属于不允许合入项。

全量涉及文件（不是完成状态；实现 PR 必须把本清单维护为“已实现 / 待实现 / 已删除 / 已发现残留”）：

```text
mcp/tools.py
mcp/server_stdio.py
mcp/server_http.py
mcp/transport_http.py
mcp/tool_response.py
mcp/security.py
mcp/error_scrub.py
mcp/config_loader.py

backend/config.py
backend/main.py
backend/routers/ai_business_query.py
backend/routers/business_domains.py
backend/services/business_query/service.py
backend/services/business_query/models.py
backend/services/business_query/caller_context.py
backend/services/business_query/domain_config.py
backend/services/business_query/ontology_loader.py
backend/services/business_query/semantic_catalog.py
backend/services/business_query/semantic_index_repository.py
backend/services/business_query/qdrant_semantic_index_repository.py
backend/services/business_query/domain_router.py
backend/services/business_query/plan_builder.py
backend/services/business_query/plan_validator.py
backend/services/business_query/sql_executor.py
backend/services/business_query/result_projector.py
backend/services/business_query/display_policy.py
backend/services/business_query/llm_fallback.py
backend/services/business_query/metric_catalog.py
backend/services/business_query/verified_query_repository.py
backend/services/business_query/eval_runner.py
backend/services/business_query/debug_service.py
backend/services/ai_assist/scenes.py
backend/services/ai_assist/model_router.py
backend/services/ai_assist/llm_client.py
backend/services/ai_assist/mcp_config_exporter.py
backend/services/prompt_generator.py
backend/services/asset_store.py
backend/services/business_domain.py
prompts/system_prompt.md
backend/tests/test_business_query_service.py
backend/tests/test_business_query_domain_config.py
backend/tests/test_business_query_semantic_index.py
backend/tests/test_business_query_tool_schema.py
backend/tests/test_query_result_semantic_projection.py
backend/tests/test_mcp_display_payload.py
backend/tests/test_mcp_tool_compat.py
backend/tests/test_query_database_removed_from_mcp.py
backend/tests/test_business_query_eval_cases.py
backend/tests/test_business_query_accuracy_gate.py
backend/tests/test_business_query_verified_queries.py
backend/tests/test_business_query_metrics_catalog.py
backend/tests/test_business_query_dimensions.py
backend/tests/test_business_query_display_policy.py
backend/tests/test_semantic_vector_repository.py
backend/tests/test_qwen_embedding_provider.py
backend/tests/test_mcp_config_exporter.py
ontology_workspaces/**/_verified_queries.yaml
ontology_workspaces/**/_metrics.yaml
ontology_workspaces/**/_eval_set.yaml
config.yaml.template
.env.example
backend/requirements.txt
docker-compose.yml
```

说明：

- 具体文件可随实现微调，但上述能力边界不能减少。
- 不允许只删 `mcp/tools.py` 函数而不清理注册、导出、测试、文档引用。
- 不允许让 `domain_config.py` 通过展开后的 `get_config()` 整段保存配置。
- 不允许在 `service.py` 或 router 中写死 `risk_control`、`风险管控`、`SmRisk*`。
- 当前已知待补：`_verified_queries.yaml`、`_metrics.yaml` 尚未形成正式资产结构；必须在本轮落地。

### 16.2 biz-ontology-platform 前端

当前状态分组（2026-08-17 口径；实现 PR 必须复验并更新）：

- 已落地并已有自动测试覆盖：
  - BusinessDomainPage 作为问数候选域配置闭环主入口，支持启用/禁用、关键词、配置保存、按 `domain_key` 查看 status/rebuild；
  - BusinessDomainPage 选中节点后会重新按候选域刷新语义索引状态，避免沿用全局/旧节点状态；
  - 前端 API client 与 semantic-index `status/rebuild/debug` contract 对齐；
  - 旧独立 `QuestionBankPage.vue` 页面与路由已物理删除；
  - 业务域状态返回 `source` 与 `requires_rebuild`，页面可据此提示候选域来源和是否需要重建索引。
- 明确待实现/待补齐：
  - EvalPage 承接 candidate question / verified eval case / 人工 review 能力仍需要与 50 条人工 eval 流程联动验收；
  - Workbench 调试问数必须走新 business query API，不展示 SQL/raw JSON/tool args；
  - OntologyEditorPage 中 synonyms/query_examples/keywords 编辑后必须触发 dirty 或提示重建索引；
  - 旧 SQL 调试入口、旧 `query_database` / `resolve_business_query` 普通用户入口必须继续保持不可访问。
- 已知风险残留：
  - 若后续重新新增独立 question-bank/SQL 调试页面，必须先更新本文档和安全门阀，不允许绕过 `ask_business_data`。

全量涉及文件（不是完成状态；实现 PR 必须维护状态分组）：

```text
frontend/src/views/QuestionBankPage.vue
frontend/src/views/EvalPage.vue
frontend/src/views/BusinessDomainPage.vue
frontend/src/views/OntologyEditorPage.vue
frontend/src/views/WorkbenchPage.vue
frontend/src/router/index.ts
frontend/src/api/businessQuery.ts
frontend/src/api/businessDomain.ts
frontend/src/api/eval.ts
frontend/src/stores/*
frontend/src/tests/api/businessQuery.test.ts
frontend/src/tests/api/businessDomain.test.ts
frontend/src/tests/views/BusinessDomainPage.test.ts
frontend/src/tests/views/EvalPage.test.ts
frontend/src/tests/views/OntologyEditorPage.test.ts
frontend/src/tests/views/WorkbenchPage.test.ts
frontend/src/tests/router/deprecatedRoutes.test.ts
```

说明：

- `QuestionBankPage.vue` 作为旧独立页面物理删除；如有可复用组件，必须改名并并入 Eval 页面，不保留旧路由。
- 旧 SQL 调试页面、旧问数入口如果不服务于新 `ask_business_data`，必须删除，不保留隐藏入口。
- BusinessDomainPage 是配置闭环主入口，不能只展示索引状态。

### 16.3 cube-ai-project

当前状态分组（2026-08-17 口径；实现 PR 必须复验并更新）：

- 已落地并已有自动测试覆盖：
  - `tachu-sse-mapper.ts` 对 `ask_business_data` completed-event 做了窄口径 SSE 输出脱敏。
  - `tool-result-visibility.ts` 工具结果投影层；
  - `final-answer-visibility-guard.ts` 最终回答 guard；
  - MCP handler / grounding / prefetch 全链路统一使用安全投影；
  - 六类脱敏与 guard 检测清单正反例测试；
  - descriptor/custom agent 旧工具引用 fail-closed。
- 已知风险残留：
  - `packages/agent/engine/src/bc/tachu/assemble-tachu-runtime.test.ts` 中仍保留 `mcp.biz-ontology.query_database` 字符串，但用途是断言旧工具不再存在于 discovery expansion map；这是防回归测试，不是运行时残留。

全量涉及文件（不是完成状态；实现 PR 必须维护状态分组）：

```text
packages/agent/engine/src/bc/tools/handlers/mcp-handler.ts
packages/agent/engine/src/bc/tools/mcp-bridge.service.ts
packages/agent/engine/src/bc/tools/tool.service.ts
packages/agent/engine/src/bc/tools/*
packages/agent/engine/src/bc/tachu/engine-factory.ts
packages/agent/engine/src/bc/tachu/assemble-tachu-runtime.ts
packages/agent/engine/src/bc/session/turn.service.ts
packages/agent/engine/src/bc/session/final-answer-visibility-guard.ts
packages/agent/engine/src/bc/session/tachu-sse-mapper.ts
packages/agent/engine/src/bc/session/*
descriptors/*
docs/*
```

上述残留必须删除或迁移为 `ask_business_data` 对应策略，并增加 fail-closed 测试。

### 16.4 ghcloud-new 应用对话前端

当前状态分组（2026-08-17 口径；实现 PR 必须复验并更新）：

- 已落地，仍需真实端到端复验：
  - 应用对话态 thinking/progress 中安全展示 `ask_business_data` 工具事件；
  - 工具 label 与后端 `progress/status` 事件对齐；
  - 普通用户可见 tool card 的 args/output/error 展示改为 `assistant-tool-payload-visibility.ts` 策略注册表；
  - `ask_business_data` 和废弃 `query_database` 已注册敏感工具策略，默认只展示业务化摘要/禁用说明，不展示 SQL、MCP URI、tool args、raw id/code、诊断字段；
  - 通用兜底策略会对 SQL/MCP URI/敏感 key 做保守隐藏；服务端如返回 `displayPayload` / `display_payload` / `safeDisplay` / `safe_display`，前端优先展示该安全投影；
  - 原始 payload 仅通过显式 debug 开关展示：`VITE_ASSISTANT_RAW_TOOL_PAYLOAD_DEBUG=1` 或 `localStorage.setItem("ghcloud-ai-assistant-raw-tool-payload-debug","1")`。
- 已知风险残留：
  - 该仓库存在历史 typecheck 基线问题；不能用历史错误掩盖本轮 assistant thinking/tool label/SDK 适配错误。
  - 上述安全展示仍需要真实 agent 对话端到端复验，确认服务端 SSE 与页面渲染路径完全一致。

全量涉及文件（不是完成状态；实现 PR 必须维护状态分组）：

```text
/Users/ghy/work/ghcloud-new/prod/cube/apps/ai-application/app/src/views/assistant/assistant-thinking-mode.ts
/Users/ghy/work/ghcloud-new/prod/cube/apps/ai-application/app/src/views/assistant/assistant-thinking-mode.test.ts
/Users/ghy/work/ghcloud-new/prod/cube/apps/ai-application/app/src/views/assistant/assistant-tool-labels.ts
/Users/ghy/work/ghcloud-new/prod/cube/apps/ai-application/app/src/views/assistant/assistant-tool-labels.test.ts
/Users/ghy/work/ghcloud-new/prod/cube/apps/ai-application/app/src/views/assistant/assistant-tool-payload-visibility.ts
/Users/ghy/work/ghcloud-new/prod/cube/apps/ai-application/app/src/views/assistant/assistant-tool-payload-visibility.test.ts
/Users/ghy/work/ghcloud-new/prod/cube/apps/ai-application/app/src/views/assistant/assistant-chat.tsx
/Users/ghy/work/ghcloud-new/prod/cube/apps/ai-application/app/src/views/assistant/assistant-chat-drawer.tsx
```

说明：

- 如果 cube assistant SDK 的事件字段变化，应用对话前端必须同步适配；
- 应用前端不承担业务问数配置管理，只承担对话态安全展示与工具名映射；
- 不允许在应用前端用字符串替换方式“美化”SQL/raw JSON，必须直接拒绝展示不安全内容；
- 共享 formatter 不能写死新增工具规则。新增 MCP 工具如果需要特殊展示，必须新增 `ToolPayloadVisibilityPolicy`，或由 MCP/platform 输出 `displayPayload` / `safeDisplay` 这类安全投影字段。

2026-08-17 已执行门阀：

```bash
cd /Users/ghy/work/ghcloud-new/prod/cube/apps/ai-application/app
bun test src/views/assistant/assistant-tool-payload-visibility.test.ts src/views/assistant/assistant-tool-labels.test.ts src/views/assistant/assistant-thinking-mode.test.ts
bun run build
```

结果：

- `bun test ...` 通过：100 pass / 0 fail。
- `bun run build` 通过；存在既有 warning：`/resource/v1/ai-application/*.png` 运行时资源未在构建期解析、`hovertextarea` 非法伪类、chunk size warning。
- 沙箱内首次构建因 Vite 写 `node_modules/.vite-temp` 触发 EPERM；非沙箱真实构建通过。

---

## 17. 风险、成本与偏差提醒

### 17.1 风险

- 只改 MCP 不改 host guard，模型仍可能复述敏感内容。
- 只改后端不改前端，管理端仍可能生成旧配置或误导用户。
- 只用 question bank 做 verified query，会把 AI 低置信样例固化为错误事实。
- 风险管控资产如果只存在于开发者本地路径，测试和生产会不一致。
- 向量索引 dirty 时如果静默降级，会让用户误以为语义召回正常。
- 枚举映射缺失时如果硬翻译，会制造错误业务结论。
- 把“某主体列表/数量”当作简单字段过滤，会把用户姓名、组织名等业务文本错误拼入 SQL。
- 跨连接问题如果生成单条 SQL JOIN，可能直接越过连接边界、权限边界和审计边界。
- resolver 多命中时如果默认取第一个，会制造错误用户/组织的数据结论，属于高风险误答。

### 17.2 成本

- 需要维护 semantic catalog、metrics、policy、display policy。
- 需要新增 vector repository、embedding provider、semantic index job。
- 需要新增 list_profile、resolver、relationship、multi-step plan 等语义资产管理成本。
- 需要新增业务主体解析与跨域多步 eval 数据，不再只测单域聚合。
- 需要新增 eval runner 和 50 条人工确认 case。
- 需要前后端一起改造。
- 需要跨仓库集成测试。
- 需要采集性能基线并持续监控。

### 17.3 容易忽略的偏差

- 用少量成功 demo 判断准确性，会高估系统能力。
- 只测内置 agent，会漏掉自定义 agent。
- 只测最终完整响应，会漏掉流式中途泄漏。
- 只测后端 API，会漏掉前端旧入口。
- 把 SQL 慢误判为模型慢，会导致优化方向错误。
- 把 Qdrant 当业务概念，会让后续向量库替换困难。
- 只测“统计数量”，会高估系统能力；真实 B 端问数经常是“某人/某组织/某业务主体下的列表和明细”。
- 把跨域问题交给 agent 自由工具编排，会低估平台语义层和权限校验缺失带来的风险。

---

## 18. 阻断规则

实施过程中遇到以下情况必须暂停并回到文档确认，不允许继续硬做：

1. 风险管控资产字段与本文档示例不一致。
2. 线上数据库字段与 YAML 本体不一致，且无法确定真相源。
3. tenant/deleted 字段不存在，但基础数据边界策略未声明 `not_applicable`。
4. Qwen embedding 接口参数或模型名与官方文档/实际调用不一致。
5. Qdrant collection 维度与 embedding 维度不一致。
6. MCP progress 无法实时接收，且需要改动 Tachu core 类型。
7. 前端现有页面交互与新状态模型冲突，需要产品决策。
8. 50 条 eval 无法人工确认。
9. 性能目标与真实基线差距过大，需要重新确认门阀数字。
10. 任何实现需要恢复低层 SQL MCP tool。
11. 列表/明细问题缺少实体 `list_profile`，但实现准备直接查询实体全量字段。
12. 业务主体词需要转内部 id/code，但没有 resolver 或 value_match 配置。
13. resolver 多命中处理策略无法确定。
14. 跨连接 external_reference 缺失，或关系字段无法从 ontology 证实。
15. 跨连接实现需要生成单条 SQL JOIN。

---

## 19. 下一步执行清单

文档冻结后，按以下顺序执行。2026-08-17 以后不再按“补一个缺口即视为完成”的方式推进；每一步必须同步更新第 0 节追踪矩阵，并补齐对应测试/验收证据。

1. 先统一 API contract：新增/调整 `/api/ai/business-query/debug`、`/api/ai/business-query/settings`、`/api/ai/business-query/eval-sets`、`/api/ai/business-query/eval-runs`，并使前端 API client 与后端响应字段完全一致。
2. 修正 `BusinessQueryChatPage` / debug 响应口径：管理端可见 diagnostics，普通 MCP content 不包含 diagnostics；debug 不返回 SQL、MCP URI、tool args、raw rows。
3. 补齐 BusinessDomainPage 配置中心：候选域、关键词、semantic index fresh/dirty/failed、fingerprint、内容分布、最近重建、失败原因、retry、requires_rebuild、display/access policy、跳转调试、跳转 eval。
4. 补齐配置局部 patch 测试：保存候选域、关键词、display policy、semantic enabled 时不得展开 `${ENV}` placeholder，不得覆盖 database/llm/ai_assist 等无关配置。
5. 补齐 `_metrics.yaml` 管理：新增后端 API 与页面表格化编辑/校验，支持 metrics、dimensions、allowed_dimensions、allowed_filters，保存后标记 semantic index dirty；YAML 只作为持久化格式，不直接暴露给用户编辑。
6. 补齐 `_verified_queries.yaml` 管理：新增后端 API 与页面表格化编辑/审核，支持 question_patterns、entities、intent、plan.metrics、plan.dimensions、plan.filters、review 状态；SQL 只能作为 audit/只读预览，不允许任意 SQL 直跑；YAML 只作为持久化格式，不直接暴露给用户编辑。
7. 补齐 plan validator：group-by 只能使用 `allowed_dimensions`，filter 只能使用 `allowed_filters` 或安全执行器强制条件；非法字段/非法维度 fail-closed。
8. 补齐单域列表/明细查询：实体 `list_profile`、展示字段、可过滤字段、操作符、默认排序、最大行数、值匹配配置；未配置时 fail-closed。
9. 补齐业务主体解析：新增 resolver 管理、value matcher、0/1/多命中处理、中间变量安全边界，用户/组织/租户等主体不得直接作为 SQL literal。
10. 补齐跨业务域/跨连接多步问数：新增 relationship catalog、external_reference 消费、multi-step plan/validator/orchestrator；跨连接不得生成 SQL JOIN。
11. 补齐前端结构化配置：list_profile、resolver、relationship、multi-step verified query 均必须表格化/表单化编辑，不得直接暴露 YAML。
12. 补齐 semantic index 页面可解释能力：展示 domain/entity/field/synonym/query_example/question_bank/metric/dimension/resolver/relationship/multi_step_template 的入库数量、indexed_at、dirty 原因、last_error。
13. 补齐 synonyms/query_examples/_question_bank 的索引复用，并保证 `_question_bank` 中 SQL 不进入模型上下文、普通用户输出或 MCP content。
14. 补齐 WorkbenchPage 新业务问数调试入口或跳转，不再让普通问数通过任意 SQL 输入/执行路径完成。
15. 补齐 OntologyEditorPage 与问数资产闭环：synonyms/query_examples/enums/metrics/list_profile/resolver/relationship/display policy 编辑后提示或标记 semantic dirty。
16. 补齐 EvalPage 业务问数门阀：domain_key 选择、config_fingerprint、review_state、stale_eval_set、安全泄漏断言、准确性分项、主体解析、列表查询、跨域多步、失败详情、门阀报告。
17. 补齐 MCP 配置导出与 prompt：无候选域不生成业务问数验证问题；有候选域时从实体/verified queries 动态生成；不写死风险管控。
18. 扫描并清理旧 `query_database` / `resolve_business_query` 在 prompt、exporter、descriptors、自定义 agent、测试中的运行时残留；保留防回归测试必须明确 fail-closed。
19. 跑 biz 后端、biz 前端、cube、ghcloud-new 的自动测试；不能只跑局部字符串测试，必须覆盖页面交互、API contract、config patch、防泄漏、列表/主体解析/跨域多步。
20. 在 Redis/MySQL/Qdrant/MCP/Agent 全部可达后跑真实跨仓库人工验收：平台问数页、biz MCP、cube agent、应用对话 UI 都必须验证。
21. 采集性能基线：route/resolver/query step/executor/parse/projection/LLM answer 分项耗时；超过门阀必须记录原因和优化项。
22. 所有 0 容忍门阀与准确性门阀通过后，才允许标记完成并合入。

---

## 20. 完成定义

只有同时满足以下条件，才算本次改造完成：

- 普通 agent 只能使用 `ask_business_data` 做业务问数。
- `query_database` 不再作为 MCP 工具存在。
- `resolve_business_query` 不再作为普通 agent 可见工具存在。
- descriptors/custom agents/工具路由扩展中不存在旧 `query_database` / `resolve_business_query` 引用；旧引用会 fail-closed 并提示迁移。
- 问数核心在 platform service，不在 MCP adapter。
- 前端页面与后端语义一致。
- 新增/改造 API contract 已按 `5.5.14` 实现并由测试固定。
- 旧独立 `QuestionBankPage` 路由不可访问，评测 review 能力已并入 Eval 页面或新评测区域。
- 业务域页面可启用/禁用问数候选域，不再要求用户手写运行时 domains 配置。
- 候选域关键词可配置、可生效、可诊断。
- 现有 synonyms/query_examples/_question_bank 已按本文档边界进入语义召回或评测资产。
- `_verified_queries.yaml`、`_metrics.yaml`、维度建模已进入 plan builder、semantic index 与 eval gate。
- 单域列表/明细查询已支持实体级 list_profile，且展示字段、过滤字段、操作符、默认排序、最大行数均可结构化配置。
- 业务主体值解析已支持 resolver/value matcher，0 命中、多命中、唯一命中均有确定行为和测试。
- 跨业务域/跨连接多步问数已支持受控 steps、中间变量、external_reference 消费和 MultiStepPlanValidator；跨连接不生成 SQL JOIN。
- list_profile、resolver、relationship、multi-step verified query 已在前端表格化/表单化配置，不直接暴露 YAML。
- “查询某个业务主体的列表/数量”类问题通过真实 eval 和人工验收，不再回退任意 SQL。
- 语义索引具备 dirty/fingerprint 与内容分布可解释能力。
- 管理端具备问数调试入口，且 diagnostics 脱敏。
- MCP 配置导出验证问题动态生成，不写死风险管控。
- Eval 与 `domain_key/config_fingerprint` 绑定。
- 风险管控 50 条 eval 已人工确认并进入门阀。
- 安全泄漏相关 eval 100% 通过；权限/审计专项不纳入本轮完成定义。
- 问数准确性分项指标达到 `5.5.15` 门阀。
- SQL/MCP URI/raw SQL 泄漏为 0。
- raw id/code 非授权展示为 0。
- 六类脱敏与 guard 检测清单均有正例/反例测试。

2026-08-17 事实校准：

- 当前代码尚未满足以上完成定义。
- 当前允许继续保留并迭代已实现切片，但不得以“局部测试通过”声明本计划完成。
- 后续任何完成声明必须引用第 0 节追踪矩阵中的条目、测试命令、测试结果和真实环境验收记录。
- cube、biz 后端、biz 前端、ghcloud-new 应用对话前端测试命令全部通过。
- ghcloud-new 应用对话前端 typecheck/build 基线已治理或有明确基线记录，且本次改动未新增错误。
- 人工验收问题全部通过。
- 性能基线已记录。
