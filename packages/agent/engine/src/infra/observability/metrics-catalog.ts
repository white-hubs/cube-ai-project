/**
 * MetricsCatalog：10 个核心 metric 名称常量。
 *
 * 命名严格遵循 `agentic_engine_` 前缀约束（metrics.md §1.1）。
 * 完整 97 条 metric 清单见 docs/detailed-design/11-observability/metrics.md §3。
 *
 * 设计参考：docs/technical-design/phase-1/P1-10-observability.md §3.3
 * M1 权威：docs/detailed-design/11-observability/metrics.md §3.1/§3.3/§3.8/§3.13/§3.14
 */

export const MetricsCatalog = {
  /** HTTP 请求耗时直方图 — metrics.md §3.1 */
  HTTP_REQUEST_DURATION: 'agentic_engine_http_request_duration_ms',

  /** 活跃 session 数（gauge）— metrics.md §3.3 */
  SESSION_ACTIVE: 'agentic_engine_sessions_active_count',

  /** Turn 执行耗时直方图 — metrics.md §3.3 */
  TURN_LATENCY: 'agentic_engine_turn_duration_ms',

  /** LLM token 消耗计数（labels: provider, model, direction=IN|OUT）— metrics.md §3 */
  LLM_TOKENS_TOTAL: 'agentic_engine_llm_tokens_total',

  /** Tool 调用次数（labels: tool_kind=BUILTIN|EXT|MCP, outcome）— metrics.md §3.8 */
  TOOL_INVOKE_TOTAL: 'agentic_engine_tool_calls_total',

  /** AuthZ 决策次数（labels: tenant, decision=ALLOW|DENY|REQUIRE_CONSENT|REQUIRE_GRANT）— metrics.md §3.6 */
  GRANT_DECISIONS: 'agentic_engine_authz_decisions_total',

  /** Outbox pending 行数（gauge，labels: channel）— metrics.md §3.14 */
  OUTBOX_PENDING: 'agentic_engine_outbox_pending_count',

  /** Outbox 单事件派发耗时直方图（labels: channel）— metrics.md §3.14 */
  OUTBOX_DISPATCH_LATENCY: 'agentic_engine_outbox_dispatch_duration_ms',

  /** BullMQ job 执行耗时（labels: queue, name）— metrics.md §3.13 */
  BULLMQ_JOB_DURATION: 'agentic_engine_bullmq_job_duration_ms',

  /** 错误计数（labels: error_code，来自 01-api/README.md §16 闭集）— metrics.md §3.17 */
  ERROR_TOTAL: 'agentic_engine_error_total',
} as const;

export type MetricName = typeof MetricsCatalog[keyof typeof MetricsCatalog];

/** 所有 catalog metric 名列表（供自检用） */
export const ALL_CATALOG_METRIC_NAMES: ReadonlyArray<MetricName> =
  Object.values(MetricsCatalog);
