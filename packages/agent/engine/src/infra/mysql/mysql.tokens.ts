/**
 * MySQL pool DI token — shared infra for BC repositories (sessions, jobs, …).
 *
 * ref: docs/technical-design/prompts/phase-3/domains-index.md §4 (agentic.infra.*)
 */
export const MYSQL_POOL_TOKEN = Symbol.for('agentic.infra.mysql');
