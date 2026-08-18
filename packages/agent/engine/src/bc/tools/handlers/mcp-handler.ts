/**
 * McpHandler — 经 McpBridgeService 调用 MCP tools/call。
 */
import { Injectable } from "@dangao/bun-server";

import { AgenticEngineError } from "../../../infra/errors/agentic-error";
import { assertMcpToolIsNotDeprecatedBizOntologyTool } from "../biz-ontology-tool-guard";
import { McpBridgeService } from "../mcp-bridge.service";
import type { ToolHandlerCtx } from "../tool-context";
import { webSearchMcpResultHasZeroResults } from "../web-search-mcp-retry";
import type { ToolHandler, ToolHandlerInvokeOptions } from "./base-handler";

export interface McpHandlerInput {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

@Injectable()
export class McpHandler implements ToolHandler<McpHandlerInput, unknown> {
  readonly kind = "mcp" as const;

  constructor(private readonly bridge: McpBridgeService) {}

  async invoke(input: McpHandlerInput, ctx: ToolHandlerCtx, options?: ToolHandlerInvokeOptions): Promise<unknown> {
    if (!input.serverId || !input.toolName) {
      throw AgenticEngineError.fromCode("INVALID_ARGUMENT_SCHEMA_VIOLATION", "McpHandler requires serverId and toolName");
    }
    assertMcpToolIsNotDeprecatedBizOntologyTool(input.serverId, input.toolName);
    // ctx.callIdentity 仅在 authPassthrough:'user' 的 server 上被 bridge 消费（否则忽略）。
    const progressToken = options?.toolCallId;
    const first = await this.bridge.callTool(input.serverId, input.toolName, input.arguments, ctx.callIdentity, {
      ...(progressToken ? { progressToken } : {}),
      ...(options?.onProgress ? { onProgress: options.onProgress } : {}),
    });
    if (
      input.serverId === "web-search" &&
      input.toolName === "web_search" &&
      String(input.arguments["categories"] ?? "")
        .trim()
        .toLowerCase() === "news" &&
      webSearchMcpResultHasZeroResults(first)
    ) {
      return this.bridge.callTool(
        input.serverId,
        input.toolName,
        {
          ...input.arguments,
          categories: "general",
        },
        ctx.callIdentity,
        {
          ...(progressToken ? { progressToken } : {}),
          ...(options?.onProgress ? { onProgress: options.onProgress } : {}),
        },
      );
    }
    return first;
  }
}
