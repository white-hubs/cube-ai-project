import {
  LlmProviderSummarySchema,
  type LlmProviderSummary,
} from '@cube-ai/contracts/platform';
import { llmConsoleRequestJson, type LlmConsoleConfig } from './http';
import { z } from 'zod';

const ProviderListSchema = z.union([
  z.array(LlmProviderSummarySchema),
  z.object({ items: z.array(LlmProviderSummarySchema) }),
]);

export class LlmConsoleClient {
  constructor(private readonly config: LlmConsoleConfig) {}

  async listProviders(): Promise<LlmProviderSummary[]> {
    const raw = await llmConsoleRequestJson<unknown>(this.config, 'GET', '/providers');
    const parsed = ProviderListSchema.parse(raw);
    return Array.isArray(parsed) ? parsed : parsed.items;
  }

  getProvider(providerId: string): Promise<LlmProviderSummary> {
    return llmConsoleRequestJson<LlmProviderSummary>(
      this.config,
      'GET',
      `/providers/${encodeURIComponent(providerId)}`,
    );
  }
}

export function createLlmConsoleClient(config: LlmConsoleConfig): LlmConsoleClient {
  return new LlmConsoleClient(config);
}
