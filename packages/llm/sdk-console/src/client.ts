import { z } from "zod";

import { type LlmProviderSummary, LlmProviderSummarySchema } from "@cube-ai/contracts/platform";

import { type LlmConsoleConfig, llmConsoleRequestJson } from "./http";

const LlmProviderSummaryPassthroughSchema = LlmProviderSummarySchema.passthrough();
type LlmProviderSummaryWithExtras = LlmProviderSummary & Record<string, unknown>;

const ProviderListSchema = z.union([
  z.array(LlmProviderSummaryPassthroughSchema),
  z.object({ items: z.array(LlmProviderSummaryPassthroughSchema) }),
]);

export class LlmConsoleClient {
  constructor(private readonly config: LlmConsoleConfig) {}

  async listProviders(): Promise<LlmProviderSummaryWithExtras[]> {
    const raw = await llmConsoleRequestJson<unknown>(this.config, "GET", "/providers");
    const parsed = ProviderListSchema.parse(raw);
    return Array.isArray(parsed) ? parsed : parsed.items;
  }

  async getProvider(providerId: string): Promise<LlmProviderSummaryWithExtras> {
    const raw = await llmConsoleRequestJson<unknown>(this.config, "GET", `/providers/${encodeURIComponent(providerId)}`);
    return LlmProviderSummaryPassthroughSchema.parse(raw);
  }

  listProviderTypes(): Promise<unknown> {
    return llmConsoleRequestJson<unknown>(this.config, "GET", "/provider-types");
  }

  listEndpointTypes(): Promise<unknown> {
    return llmConsoleRequestJson<unknown>(this.config, "GET", "/endpoint-types");
  }

  getProviderType(code: string): Promise<unknown> {
    return llmConsoleRequestJson<unknown>(this.config, "GET", `/provider-types/${encodeURIComponent(code)}`);
  }

  createProvider(body: Record<string, unknown>): Promise<unknown> {
    return llmConsoleRequestJson<unknown>(this.config, "POST", "/providers", body);
  }

  updateProvider(id: string, body: Record<string, unknown>): Promise<unknown> {
    return llmConsoleRequestJson<unknown>(this.config, "PUT", `/providers/${encodeURIComponent(id)}`, body);
  }

  deleteProvider(id: string): Promise<void> {
    return llmConsoleRequestJson<void>(this.config, "DELETE", `/providers/${encodeURIComponent(id)}`);
  }

  updateProviderSettings(id: string, body: Record<string, unknown>): Promise<unknown> {
    return llmConsoleRequestJson<unknown>(this.config, "PUT", `/providers/${encodeURIComponent(id)}/settings`, body);
  }

  testProviderConnection(id: string): Promise<unknown> {
    return llmConsoleRequestJson<unknown>(this.config, "POST", `/providers/${encodeURIComponent(id)}/test-connection`);
  }

  listModels(providerId: string): Promise<unknown> {
    return llmConsoleRequestJson<unknown>(this.config, "GET", `/providers/${encodeURIComponent(providerId)}/models`);
  }

  createModel(providerId: string, body: Record<string, unknown>): Promise<unknown> {
    return llmConsoleRequestJson<unknown>(this.config, "POST", `/providers/${encodeURIComponent(providerId)}/models`, body);
  }

  updateModel(providerId: string, modelId: string, body: Record<string, unknown>): Promise<unknown> {
    return llmConsoleRequestJson<unknown>(
      this.config,
      "PUT",
      `/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}`,
      body,
    );
  }

  deleteModel(providerId: string, modelId: string): Promise<void> {
    return llmConsoleRequestJson<void>(
      this.config,
      "DELETE",
      `/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}`,
    );
  }

  testModel(providerId: string, modelId: string): Promise<unknown> {
    return llmConsoleRequestJson<unknown>(
      this.config,
      "POST",
      `/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}/test`,
    );
  }

  getModelRuntimeConfig(providerId: string, modelCode: string): Promise<unknown> {
    return llmConsoleRequestJson<unknown>(
      this.config,
      "GET",
      `/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelCode)}/runtime-config`,
    );
  }

  fetchRemote(providerId: string): Promise<unknown> {
    return llmConsoleRequestJson<unknown>(this.config, "POST", `/providers/${encodeURIComponent(providerId)}/models/fetch-remote`);
  }

  fetchRemotePreview(providerId: string): Promise<unknown> {
    return llmConsoleRequestJson<unknown>(this.config, "POST", `/providers/${encodeURIComponent(providerId)}/models/fetch-remote-preview`);
  }

  importRemote(providerId: string, body: Record<string, unknown>): Promise<unknown> {
    return llmConsoleRequestJson<unknown>(this.config, "POST", `/providers/${encodeURIComponent(providerId)}/models/import-remote`, body);
  }
}

export function createLlmConsoleClient(config: LlmConsoleConfig): LlmConsoleClient {
  return new LlmConsoleClient(config);
}
