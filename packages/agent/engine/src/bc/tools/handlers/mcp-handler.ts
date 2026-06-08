/**
 * McpHandler — 经 McpBridgeService 调用 MCP tools/call。
 */
import { Injectable } from '@dangao/bun-server';
import { AgenticEngineError } from '../../../infra/errors/agentic-error';
import type { ToolHandlerCtx } from '../tool-context';
import type { ToolHandler } from './base-handler';
import { McpBridgeService } from '../mcp-bridge.service';
import { webSearchMcpResultHasZeroResults } from '../web-search-mcp-retry';

export interface McpHandlerInput {
  serverId:  string;
  toolName:  string;
  arguments: Record<string, unknown>;
}

@Injectable()
export class McpHandler implements ToolHandler<McpHandlerInput, unknown> {
  readonly kind = 'mcp' as const;

  constructor(private readonly bridge: McpBridgeService) {}

  async invoke(input: McpHandlerInput, _ctx: ToolHandlerCtx): Promise<unknown> {
    if (!input.serverId || !input.toolName) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'McpHandler requires serverId and toolName',
      );
    }
    const first = await this.bridge.callTool(input.serverId, input.toolName, input.arguments);
    if (
      input.serverId === 'web-search' &&
      input.toolName === 'web_search' &&
      String(input.arguments['categories'] ?? '').trim().toLowerCase() === 'news' &&
      webSearchMcpResultHasZeroResults(first)
    ) {
      return this.bridge.callTool(input.serverId, input.toolName, {
        ...input.arguments,
        categories: 'general',
      });
    }
    return first;
  }
}
