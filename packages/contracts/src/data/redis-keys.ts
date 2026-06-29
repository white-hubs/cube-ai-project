/**
 * Redis key prefix constants and key generators.
 *
 * Aligned with:
 *   docs/detailed-design/02-data/redis-keys.md §2 + §3
 *
 * Rules (redis-keys.md §2.2):
 *   - ALL keys MUST start with `agentic:engine:` (regulation §7.1)
 *   - Use `:` as separator, never `_` in key segments
 *   - Single nouns (lock not locks)
 *   - IDs always at the end
 *   - No verbs in key names
 *
 * Domain prefix enum (redis-keys.md §2.1):
 *   auth | authz | descriptor | session | ack | ratelimit | job | outbox | bull | pubsub | debug
 */

/** The mandatory root prefix for ALL engine Redis keys. */
export const REDIS_KEY_ROOT = "agentic:engine" as const;

// ─── Auth domain ───────────────────────────────────────────────────────────

export const RedisKeys = {
  /** `agentic:engine:auth:introspect:{sha256}` — Token introspection cache (60s TTL) */
  authIntrospect: (sha256: string) => `${REDIS_KEY_ROOT}:auth:introspect:${sha256}`,

  /** `agentic:engine:auth:introspect:fail:{sha256}` — Negative introspection cache (10s TTL) */
  authIntrospectFail: (sha256: string) => `${REDIS_KEY_ROOT}:auth:introspect:fail:${sha256}`,

  /** `agentic:engine:auth:jwks:v1` — JWKS cache (6h TTL) */
  authJwks: () => `${REDIS_KEY_ROOT}:auth:jwks:v1`,

  /** `agentic:engine:auth:obo:{userId}:{tenant}:{scopeHash}:{iss}` — OBO token cache */
  authObo: (userId: string, tenant: number, scopeHash: string, iss: string) =>
    `${REDIS_KEY_ROOT}:auth:obo:${userId}:${tenant}:${scopeHash}:${iss}`,

  // ─── AuthZ domain ──────────────────────────────────────────────────────

  /** `agentic:engine:authz:grant:{tenant}:{grantId}` — Grant L2 cache (event-driven expiry) */
  authzGrant: (tenant: number, grantId: string) => `${REDIS_KEY_ROOT}:authz:grant:${tenant}:${grantId}`,

  /** `agentic:engine:authz:grants:session:{sessionId}` — G-C session-scoped grants */
  authzGrantsSession: (sessionId: string) => `${REDIS_KEY_ROOT}:authz:grants:session:${sessionId}`,

  /** `agentic:engine:authz:grants:user:{tenant}:{userId}` — G-B user grant L2 cache */
  authzGrantsUser: (tenant: number, userId: string) => `${REDIS_KEY_ROOT}:authz:grants:user:${tenant}:${userId}`,

  /** `agentic:engine:authz:grants:admin:{tenant}` — G-A L2 cache */
  authzGrantsAdmin: (tenant: number) => `${REDIS_KEY_ROOT}:authz:grants:admin:${tenant}`,

  /**
   * L2: single active grant for (tenant, user, tool) — Phase 3 hot path.
   * ref: P3-03-authz.md §3.1
   */
  authzGrantActiveTool: (tenant: number, userId: string, toolName: string) =>
    `${REDIS_KEY_ROOT}:authz:grant:${tenant}:${userId}:${encodeURIComponent(toolName)}`,

  /** Redis-only pending grant request — grant-lifecycle.md §2.2 */
  authzGrantRequest: (grantRequestId: string) => `${REDIS_KEY_ROOT}:authz:grantReq:${grantRequestId}`,

  // ─── Session domain ────────────────────────────────────────────────────

  /**
   * `agentic:engine:session:turn:lock:{sessionId}` — Turn distributed lock (30s TTL + 10s renewal)
   * Value: `{ turnId, ownerNodeId, acquireTime, deadlineTime }`
   */
  sessionTurnLock: (sessionId: string) => `${REDIS_KEY_ROOT}:session:turn:lock:${sessionId}`,

  /** `agentic:engine:session:sse:buffer:{turnId}` — SSE replay buffer (120s TTL, 200 entries LTRIM) */
  sessionSseBuffer: (turnId: string) => `${REDIS_KEY_ROOT}:session:sse:buffer:${turnId}`,

  /** `agentic:engine:session:sse:conn:{turnId}` — SSE active connection marker (15s TTL + 5s renewal) */
  sessionSseConn: (turnId: string) => `${REDIS_KEY_ROOT}:session:sse:conn:${turnId}`,

  /** `agentic:engine:session:idempotency:{tenant}:{idempotencyKey}` — Turn idempotency (24h TTL) */
  sessionIdempotency: (tenant: number, idempotencyKey: string) => `${REDIS_KEY_ROOT}:session:idempotency:${tenant}:${idempotencyKey}`,

  /** `agentic:engine:session:abort:{turnId}` — Abort broadcast key (60s TTL + explicit DEL) */
  sessionAbort: (turnId: string) => `${REDIS_KEY_ROOT}:session:abort:${turnId}`,

  /** `agentic:engine:session:lifecycle:{sessionId}` — Session lifecycle hash (7d TTL) */
  sessionLifecycle: (sessionId: string) => `${REDIS_KEY_ROOT}:session:lifecycle:${sessionId}`,

  // ─── ACK domain ────────────────────────────────────────────────────────

  /** `agentic:engine:ack:tool:{toolCallId}` — Tool ack waiter (60s TTL) */
  ackTool: (toolCallId: string) => `${REDIS_KEY_ROOT}:ack:tool:${toolCallId}`,

  /** `agentic:engine:ack:grant:{grantRequestId}` — Grant consent ack waiter (60s TTL) */
  ackGrant: (grantRequestId: string) => `${REDIS_KEY_ROOT}:ack:grant:${grantRequestId}`,

  // ─── Outbox domain ─────────────────────────────────────────────────────

  /** `agentic:engine:outbox:relay:cursor:{channel}` — Relay scan cursor (permanent) */
  outboxRelayCursor: (channel: string) => `${REDIS_KEY_ROOT}:outbox:relay:cursor:${channel}`,

  /** `agentic:engine:outbox:relay:leader` — Relay leader lock (30s TTL + renewal) */
  outboxRelayLeader: () => `${REDIS_KEY_ROOT}:outbox:relay:leader`,

  // ─── PubSub channels ───────────────────────────────────────────────────

  /** `agentic:engine:pubsub:descriptor.reload` */
  pubsubDescriptorReload: () => `${REDIS_KEY_ROOT}:pubsub:descriptor.reload`,

  /** `agentic:engine:pubsub:grant.invalidate` */
  pubsubGrantInvalidate: () => `${REDIS_KEY_ROOT}:pubsub:grant.invalidate`,

  /** `agentic:engine:pubsub:session.lifecycle` */
  pubsubSessionLifecycle: () => `${REDIS_KEY_ROOT}:pubsub:session.lifecycle`,

  /** `agentic:engine:pubsub:config.reload` */
  pubsubConfigReload: () => `${REDIS_KEY_ROOT}:pubsub:config.reload`,
} as const;
