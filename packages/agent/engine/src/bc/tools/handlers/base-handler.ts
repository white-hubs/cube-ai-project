/**
 * ToolHandler 接口 — 所有内置 handler 的公共契约。
 *
 * 权威来源：docs/technical-design/prompts/phase-1/P1-08-tools.md §6.3
 */
import type { HandlerKindValue } from "@cube-ai/contracts";

import type { ToolHandlerCtx } from "../tool-context";

export interface ToolHandlerProgressEvent {
  progressToken: string | number;
  progress?: number;
  total?: number;
  message?: string;
}

export interface ToolHandlerInvokeOptions {
  toolCallId?: string;
  onProgress?: (event: ToolHandlerProgressEvent) => void | Promise<void>;
}

export interface ToolHandler<I = unknown, O = unknown> {
  readonly kind: HandlerKindValue;
  invoke(input: I, ctx: ToolHandlerCtx, options?: ToolHandlerInvokeOptions): Promise<O>;
}
