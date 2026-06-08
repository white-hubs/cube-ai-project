import { Module } from '@dangao/bun-server';

/**
 * ErrorsModule — no runtime providers needed; AgenticError subclasses are
 * plain classes imported directly. This module serves as a DI registration
 * anchor so EngineAssembler can track the foundations layer explicitly.
 *
 * Future: Phase 2 adds GlobalExceptionFilter as a bun-server middleware
 * registered here (maps AgenticError subclasses → HTTP responses).
 *
 * ref: docs/technical-design/phase-1/P1-01-foundations.md §6.2
 */
@Module({
  providers: [],
  exports:   [],
})
export class ErrorsModule {}
