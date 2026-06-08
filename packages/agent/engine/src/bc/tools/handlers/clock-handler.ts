/**
 * ClockHandler — 只读返回服务器 UTC 时间（无参）。
 */
import { Injectable } from '@dangao/bun-server';
import { AgenticEngineError } from '../../../infra/errors/agentic-error';
import type { ToolHandlerCtx } from '../tool-context';
import type { ToolHandler } from './base-handler';

export interface ClockUtcOutput {
  iso: string;
  epochMs: number;
}

@Injectable()
export class ClockHandler implements ToolHandler<Record<string, never>, ClockUtcOutput> {
  readonly kind = 'clock' as const;

  async invoke(input: Record<string, never>, _ctx: ToolHandlerCtx): Promise<ClockUtcOutput> {
    if (
      input != null &&
      typeof input === 'object' &&
      !Array.isArray(input) &&
      Object.keys(input as object).length > 0
    ) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'currentDate accepts no arguments (use {})',
      );
    }
    const epochMs = Date.now();
    return { iso: new Date(epochMs).toISOString(), epochMs };
  }
}
