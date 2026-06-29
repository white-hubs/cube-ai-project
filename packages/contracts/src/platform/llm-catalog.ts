import { z } from "zod";

/**
 * LlmCatalogPort
 * Engine-side abstraction over the AI middle-platform LLM Catalog. The
 * catalog-driven Provider variant in `@cube-ai/agentic-adapters` consumes
 * this port to resolve per-tenant model runtime configuration at chat time.
 *
 * Wire contract: see docs/technical-design/plans/integration/ai-application-endpoints.md §3.
 */

const LlmEndpointTypes = [
  "openai",
  "openai_response",
  "anthropic",
  "gemini",
  "azure_openai",
  "new_api",
  "openai_image",
  "jina_rerank",
  /** ghcloud / Ollama 等 OpenAI 兼容 HTTP 服务；与 `openai` 同走 OpenAICompatProvider */
  "ollama",
  /** 极客智坊原生协议（当前 Catalog 仅接 nano-banana 文生图族） */
  "geekai",
  /** 百炼 OpenAI 兼容对话（compatible-mode/v1） */
  "dashscope",
  /** 百炼万相 / Qwen-Image 等多模态文生图 */
  "dashscope_text2image",
  /** 火山方舟（对话走 OpenAI 兼容；Seed3D 等见 runtime modelTypes） */
  "volcengine_ark",
] as const;
export type LlmEndpointType = (typeof LlmEndpointTypes)[number];

export const LlmEndpointTypeSchema: z.ZodType<LlmEndpointType> = z.enum(LlmEndpointTypes);

export const LlmProviderSummarySchema = z.object({
  /** 管理面列表允许展示尚未配置连接信息的供应商；运行时配置仍要求非空 URL。 */
  apiBaseUrl: z.string().min(1).nullable(),
  enabled: z.boolean(),
  /** Provider primary key from `@ghcloud/ai-application` `GET /ai/llm/providers` (`id`). */
  id: z.string().min(1),
  providerCode: z.string().min(1),
  /**
   * 接入厂商分类（中台 `typeCode`），如 `geekai`、`volcengine_ark`、`dashscope`。
   * 与模型协议无关；实际 HTTP 协议以 `resolveModelRuntime` 返回的 `endpointType` 为准。
   */
  typeCode: z.string().min(1),
});
export type LlmProviderSummary = z.infer<typeof LlmProviderSummarySchema>;

export const LlmModelRuntimeConfigSchema = z.object({
  apiBaseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  displayName: z.string().min(1),
  endpointType: LlmEndpointTypeSchema,
  isFree: z.boolean().default(false),
  modelCode: z.string().min(1),
  modelTypes: z.array(z.string()).default([]),
  providerCode: z.string().min(1),
});
export type LlmModelRuntimeConfig = z.infer<typeof LlmModelRuntimeConfigSchema>;

export interface LlmCatalogPort {
  listProviders(tenant: number, signal: AbortSignal): Promise<LlmProviderSummary[]>;
  resolveModelRuntime(tenant: number, modelCode: string, signal: AbortSignal): Promise<LlmModelRuntimeConfig | null>;
}
