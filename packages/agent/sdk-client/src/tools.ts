import { z } from "zod";

import { type PublicToolDescriptor, PublicToolDescriptorSchema, ToolAckSubmitRequestSchema } from "@cube-ai/contracts";

import { type AgenticClient, type AgenticClientConfig } from "./client";

const DescriptorsListResponseSchema = z.union([
  z.object({ items: z.array(PublicToolDescriptorSchema) }),
  z.array(PublicToolDescriptorSchema),
]);

/**
 * Tool Acks API.
 * Ref: docs/detailed-design/08-sdk/sdk-core.md §8.1
 */
export class ToolAcksApi {
  constructor(
    _config: AgenticClientConfig,
    private readonly client: AgenticClient,
  ) {}

  /**
   * Submit result for a frontend-event tool call.
   */
  async submit(
    sessionId: string,
    turnId: string,
    toolCallId: string,
    result: { ok: true; output: unknown } | { ok: false; error: { code: string; message: string; retryable?: boolean } },
  ): Promise<void> {
    const validated = ToolAckSubmitRequestSchema.parse({ result, toolCallId });
    await this.client.requestJson({
      body: validated,
      method: "POST",
      path: `/sessions/${sessionId}/turns/${turnId}/tool-acks`,
    });
  }
}

/**
 * Descriptors API — list public tool descriptors（GET `/descriptors`）.
 */
export class DescriptorsApi {
  constructor(
    _config: AgenticClientConfig,
    private readonly client: AgenticClient,
  ) {}

  async list(opts?: { kind?: "TOOL"; enabledOnly?: boolean }): Promise<PublicToolDescriptor[]> {
    const query: Record<string, string | undefined> = {
      kind: opts?.kind ?? "TOOL",
    };
    if (opts?.enabledOnly === true) {
      query.enabledOnly = "true";
    }
    const raw = await this.client.requestJson<unknown>({
      method: "GET",
      path: "/descriptors",
      query,
    });
    const parsed = DescriptorsListResponseSchema.parse(raw);
    return Array.isArray(parsed) ? parsed : parsed.items;
  }
}

/**
 * High-level Tools facade：列表 + 同步调用（invoke）.
 * Ref: P3-15-sdk-impl §3.4
 */
export class ToolsApi {
  constructor(
    _config: AgenticClientConfig,
    private readonly client: AgenticClient,
  ) {}

  async list(opts?: { enabledOnly?: boolean }): Promise<PublicToolDescriptor[]> {
    return this.client.descriptors.list({
      kind: "TOOL",
      ...(opts?.enabledOnly !== undefined ? { enabledOnly: opts.enabledOnly } : {}),
    });
  }

  /** POST `/tools/:name/invoke` — 返回引擎 JSON 载荷（业务自定义 shape） */
  async invoke(name: string, args: Record<string, unknown>): Promise<unknown> {
    const seg = encodeURIComponent(name);
    return this.client.requestJson<unknown>({
      body: args,
      method: "POST",
      path: `/tools/${seg}/invoke`,
    });
  }
}
