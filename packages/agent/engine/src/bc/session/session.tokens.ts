/**
 * DI tokens for Session BC.
 * All tokens use Symbol.for('agentic.session.*') namespace
 * per regulation §9.3 (cross-agent token de-collision).
 *
 * ref: P1-06 design doc §6
 */
export const TURN_LOCK_SERVICE_TOKEN = Symbol.for('agentic.session.turnLock');
export const SNAPSHOT_SERVICE_TOKEN = Symbol.for('agentic.session.snapshot');
export const SESSION_REPO_TOKEN = Symbol.for('agentic.session.repository');
export const REDIS_CLIENT_TOKEN = Symbol.for('agentic.session.redisClient');
/** Shared mysql2 pool — align P3-04 session-rest + P3-05 turn (`agentic.infra.mysql`). */
export const MYSQL_POOL_TOKEN = Symbol.for('agentic.infra.mysql');
export const TURN_REPO_TOKEN = Symbol.for('agentic.session.turnRepository');
