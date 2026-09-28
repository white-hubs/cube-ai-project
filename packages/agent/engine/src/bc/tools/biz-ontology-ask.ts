/**
 * 问数专用调用。发现类工具仍走通用 MCP；ask_business_data 只经过这里。
 */
import { Injectable } from "@dangao/bun-server";

import { AgenticEngineError } from "../../infra/errors/agentic-error";
import { ASK_BUSINESS_DATA_TOOL, BIZ_ONTOLOGY_SERVER_ID, askQuestionFromModel } from "./biz-ontology-address";
import type { McpProgressOptions } from "./mcp-bridge.service";
import { McpBridgeService } from "./mcp-bridge.service";
import type { ToolHandlerCtx } from "./tool-context";

export function stampAskArguments(question: string, ctx: ToolHandlerCtx): Record<string, unknown> {
  return {
    question,
    conversation_id: ctx.session.id,
    context: {
      user_id: ctx.auth.user?.userId ?? "",
    },
  };
}

@Injectable()
export class AskBusinessDataProgram {
  constructor(private readonly bridge: McpBridgeService) {}

  async invoke(input: unknown, ctx: ToolHandlerCtx, progress?: McpProgressOptions): Promise<unknown> {
    const callId = String(progress?.progressToken ?? ctx.traceId);
    const allowed = ctx.askStepGate ? await ctx.askStepGate.enter(callId) : true;
    if (!allowed) {
      throw AgenticEngineError.fromCode("INVALID_ARGUMENT_SCHEMA_VIOLATION", "这一步只能调用一次问数。请把问数片段拼成一句后再调用。");
    }
    const raw = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
    const question = askQuestionFromModel(raw.question, ctx.userPrompt);
    if (!question) {
      throw AgenticEngineError.fromCode("INVALID_ARGUMENT_SCHEMA_VIOLATION", "问数问题不能为空。");
    }
    return this.bridge.callTool(
      BIZ_ONTOLOGY_SERVER_ID,
      ASK_BUSINESS_DATA_TOOL,
      stampAskArguments(question, ctx),
      ctx.callIdentity,
      progress,
    );
  }
}
