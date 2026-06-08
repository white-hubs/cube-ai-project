import { Module } from '@dangao/bun-server';

/**
 * ErrorMiddlewareModule — P1-02 API envelope.
 *
 * DI module for the error-envelope infrastructure. Currently a thin
 * registration anchor; Phase 2 will inject:
 * - `SfidService` (trace-id generation via Snowflake)
 * - pino `LoggerService` (structured request logging per R22)
 *
 * DI token namespace: `Symbol.for('agentic.api.<name>')` per shared-context §9.3.
 *
 * Phase 2 P2-XX 实装：注入 pino logger + SfidService traceId.
 */
@Module({
  providers: [],
  exports: [],
})
export class ErrorMiddlewareModule {}
