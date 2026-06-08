/**
 * CorrelationStore：AsyncLocalStorage<Correlation> 在请求生命周期内透明传播。
 *
 * correlation 字段随 pino `mixin` 自动注入每条日志，业务代码无需手动传。
 *
 * 设计参考：docs/technical-design/phase-1/P1-10-observability.md §3.5
 * M1 权威：docs/detailed-design/11-observability/README.md §4
 *         docs/detailed-design/11-observability/logging.md §3.2
 */

import { AsyncLocalStorage } from 'async_hooks';

/** Correlation 三元组 + 可选加固字段（logging.md §3.2） */
export interface Correlation {
  /** OTel traceId（32 hex）；没有 active span 时为 null；禁止空字符串 */
  traceId: string | null;
  /** OTel spanId（16 hex）；同 traceId */
  spanId: string | null;
  /** 租户 INT(10)；从 AuthContext 派生；API-4 禁止从 header 取 */
  tenant: number | null;
  /** SFID 字符串 */
  sessionId: string | null;
  /** SFID 字符串 */
  turnId: string | null;
  /** VARCHAR(64)，`usr_` 前缀例外 */
  userId: string | null;
  /** SFID 字符串；入口中间件自动生成或取 X-Request-Id */
  requestId: string | null;
  /** SFID 字符串；BullMQ Worker 路径 */
  jobId: string | null;
}

export const EMPTY_CORRELATION: Correlation = {
  traceId: null,
  spanId: null,
  tenant: null,
  sessionId: null,
  turnId: null,
  userId: null,
  requestId: null,
  jobId: null,
};

/**
 * 全局 AsyncLocalStorage 实例。
 * pino factory 的 `mixin` 回调每次 log 时读取此 store 并合并到 JSON 输出。
 */
export const correlationStorage = new AsyncLocalStorage<Correlation>();

/** 当前 store 快照；无 context 时返回 EMPTY_CORRELATION */
export function getCurrentCorrelation(): Correlation {
  return correlationStorage.getStore() ?? EMPTY_CORRELATION;
}
