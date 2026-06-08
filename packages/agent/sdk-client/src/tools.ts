import {
  ToolAckSubmitRequestSchema,
  PublicToolDescriptorSchema,
  type PublicToolDescriptor,
} from '@cube-ai/contracts';
import { z } from 'zod';
import type { AgenticClient } from './client';
import type { AgenticClientConfig } from './client';

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
    const validated = ToolAckSubmitRequestSchema.parse({ toolCallId, result });
    await this.client.requestJson({
      method: 'POST',
      path:   `/v1/sessions/${sessionId}/turns/${turnId}/tool-acks`,
      body:   validated,
    });
  }
}

/**
 * Descriptors API — list public tool descriptors（GET `/v1/descriptors`）.
 */
export class DescriptorsApi {
  constructor(
    _config: AgenticClientConfig,
    private readonly client: AgenticClient,
  ) {}

  async list(opts?: { kind?: 'TOOL'; enabledOnly?: boolean }): Promise<PublicToolDescriptor[]> {
    const query: Record<string, string | undefined> = {
      kind: opts?.kind ?? 'TOOL',
    };
    if (opts?.enabledOnly === true) query.enabledOnly = 'true';
    const raw = await this.client.requestJson<unknown>({
      method: 'GET',
      path:   '/v1/descriptors',
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
      kind: 'TOOL',
      ...(opts?.enabledOnly !== undefined ? { enabledOnly: opts.enabledOnly } : {}),
    });
  }

  /** POST `/v1/tools/:name/invoke` — 返回引擎 JSON 载荷（业务自定义 shape） */
  async invoke(name: string, args: Record<string, unknown>): Promise<unknown> {
    const seg = encodeURIComponent(name);
    return this.client.requestJson<unknown>({
      method: 'POST',
      path:   `/v1/tools/${seg}/invoke`,
      body:   args,
    });
  }
}
