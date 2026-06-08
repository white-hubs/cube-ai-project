import type { LlmProviderPort, LlmChatRequest } from '@cube-ai/contracts';

/** Resolved LLM call parameters for cube-linear-engine (catalog modelRef + soft inline-key fallback). */
export type CubeEngineLlmConfig = {
  tenant: number;
  modelCode: string;
  legacyApiKey?: string;
  legacyApiBaseUrl?: string;
  temperature: number;
  maxTokens?: number;
  systemPrompt?: string;
};

export function resolveCubeEngineLlmConfig(
  nodeConfig: Record<string, unknown>,
  tenant: number,
): CubeEngineLlmConfig {
  const cfg = nodeConfig;
  const modelRef =
    (typeof cfg['model_ref'] === 'string' && cfg['model_ref'].trim()) ||
    (typeof cfg['modelRef'] === 'string' && cfg['modelRef'].trim()) ||
    '';
  const modelName =
    modelRef ||
    String(cfg['model_name'] ?? cfg['model'] ?? process.env['OPENAI_MODEL'] ?? 'gpt-4o-mini');
  const legacyApiKey =
    typeof cfg['api_key'] === 'string' && cfg['api_key'].trim()
      ? cfg['api_key'].trim()
      : typeof process.env['OPENAI_API_KEY'] === 'string' && process.env['OPENAI_API_KEY'].trim()
        ? process.env['OPENAI_API_KEY'].trim()
        : undefined;
  const legacyApiBaseUrl =
    typeof cfg['openai_api_base'] === 'string' && cfg['openai_api_base'].trim()
      ? cfg['openai_api_base'].trim()
      : typeof process.env['OPENAI_API_BASE'] === 'string' && process.env['OPENAI_API_BASE'].trim()
        ? process.env['OPENAI_API_BASE'].trim()
        : undefined;
  const tempRaw = cfg['temperature'];
  const temp =
    typeof tempRaw === 'number'
      ? tempRaw
      : typeof tempRaw === 'string'
        ? Number(tempRaw)
        : 0.7;
  const maxTokRaw = cfg['max_tokens'];
  const maxTokensParsed =
    typeof maxTokRaw === 'number' ? maxTokRaw : typeof maxTokRaw === 'string' ? Number(maxTokRaw) : Number.NaN;
  const maxTokens = Number.isFinite(maxTokensParsed) ? maxTokensParsed : undefined;
  const system = String(cfg['system_message'] ?? cfg['system_prompt'] ?? cfg['systemMessage'] ?? '');

  return {
    tenant,
    modelCode: modelName,
    legacyApiKey,
    legacyApiBaseUrl,
    temperature: Number.isFinite(temp) ? temp : 0.7,
    maxTokens,
    systemPrompt: system.trim() || undefined,
  };
}

function buildChatRequest(userText: string, llmCfg: CubeEngineLlmConfig): LlmChatRequest {
  const messages: LlmChatRequest['messages'] = [];
  if (llmCfg.systemPrompt) {
    messages.push({ role: 'system', content: llmCfg.systemPrompt });
  }
  messages.push({ role: 'user', content: userText });
  return {
    tenant: llmCfg.tenant,
    modelCode: llmCfg.modelCode,
    messages,
    temperature: llmCfg.temperature,
    maxTokens: llmCfg.maxTokens,
    legacyApiKey: llmCfg.legacyApiKey,
    legacyApiBaseUrl: llmCfg.legacyApiBaseUrl,
  };
}

export async function cubeLlmChatSync(
  llm: LlmProviderPort,
  userText: string,
  llmCfg: CubeEngineLlmConfig,
  signal?: AbortSignal,
): Promise<{ text: string; totalTokens?: number }> {
  const resp = await llm.chat(buildChatRequest(userText, llmCfg), signal);
  return {
    text: resp.content,
    totalTokens: resp.usage?.totalTokens,
  };
}

export async function cubeLlmChatStream(
  llm: LlmProviderPort,
  userText: string,
  llmCfg: CubeEngineLlmConfig,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<{ totalTokens?: number }> {
  let total: number | undefined;
  for await (const chunk of llm.chatStream(buildChatRequest(userText, llmCfg), signal)) {
    if (chunk.type === 'text-delta' && chunk.delta) onDelta(chunk.delta);
    if (chunk.type === 'finish' && chunk.usage?.totalTokens != null) total = chunk.usage.totalTokens;
  }
  return { totalTokens: total };
}
