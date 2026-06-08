/**
 * ToolHandler 接口 — 所有内置 handler 的公共契约。
 *
 * 权威来源：docs/technical-design/prompts/phase-1/P1-08-tools.md §6.3
 */
import type { HandlerKindValue } from '@cube-ai/contracts';
import type { ToolHandlerCtx } from '../tool-context';

export interface ToolHandler<I = unknown, O = unknown> {
  readonly kind: HandlerKindValue;
  invoke(input: I, ctx: ToolHandlerCtx): Promise<O>;
}
