import { Inject, Injectable } from '@dangao/bun-server';
import type { LlmCatalogPort } from '@cube-ai/contracts';
import { AGENTIC_PLATFORM_LLM_CATALOG_TOKEN } from '@cube-ai/contracts/platform';
import { AgenticEngineError } from '../../../infra/errors/agentic-error';
import type { ToolHandlerCtx } from '../tool-context';
import type { ToolHandler } from './base-handler';

const DEFAULT_DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/api/v1';
const DEFAULT_MODEL = 'qwen-image-2.0-pro';
const GENERATION_PATH = '/services/aigc/multimodal-generation/generation';

export interface ImageQwenInvokeInput {
  prompt: string;
  referenceImages?: string[];
  /** Catalog modelCode; soft fallback to env default when omitted. */
  modelRef?: string;
  model?: string;
  n?: number;
  size?: string;
  negativePrompt?: string;
  watermark?: boolean;
  promptExtend?: boolean;
  seed?: number;
}

export interface ImageQwenInvokeOutput {
  requestId: string | null;
  model: string;
  images: Array<{ url: string }>;
}

function clampInt(n: unknown, def: number, min: number, max: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function resolveModelCode(input: ImageQwenInvokeInput): string {
  return (
    (typeof input.modelRef === 'string' && input.modelRef.trim().length > 0
      ? input.modelRef.trim()
      : undefined) ??
    (typeof input.model === 'string' && input.model.trim().length > 0
      ? input.model.trim()
      : undefined) ??
    process.env.QWEN_IMAGE_MODEL?.trim() ??
    DEFAULT_MODEL
  );
}

@Injectable()
export class QwenImageHandler implements ToolHandler<ImageQwenInvokeInput, ImageQwenInvokeOutput> {
  readonly kind = 'qwenImage' as const;

  constructor(
    @Inject(AGENTIC_PLATFORM_LLM_CATALOG_TOKEN) private readonly catalog: LlmCatalogPort,
  ) {}

  async invoke(raw: unknown, ctx: ToolHandlerCtx): Promise<ImageQwenInvokeOutput> {
    const input = raw as ImageQwenInvokeInput;
    const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
    if (!prompt) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'image.qwen requires non-empty prompt',
      );
    }

    const refsRaw = Array.isArray(input?.referenceImages) ? input.referenceImages : [];
    const refs = refsRaw
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((s) => s.trim());
    if (refs.length > 3) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'image.qwen allows at most 3 referenceImages',
      );
    }

    const n = clampInt(input?.n, 1, 1, 6);
    const modelCode = resolveModelCode(input);
    const runtime = await this.catalog.resolveModelRuntime(
      ctx.auth.tenant,
      modelCode,
      ctx.signal,
    );
    if (!runtime?.apiKey) {
      throw AgenticEngineError.fromCode(
        'UPSTREAM_LLM_UNAVAILABLE',
        `image.qwen: no catalog runtime for modelRef=${modelCode} (M2: configure llm-core catalog)`,
      );
    }

    const baseRaw = runtime.apiBaseUrl?.trim() || DEFAULT_DASHSCOPE_BASE;
    const base = baseRaw.replace(/\/+$/, '');
    const genUrl = `${base}${GENERATION_PATH}`;

    const content: Array<{ image?: string; text?: string }> = [];
    for (const img of refs) {
      content.push({ image: img });
    }
    content.push({ text: prompt });

    const watermark = typeof input?.watermark === 'boolean' ? input.watermark : false;
    const promptExtend = typeof input?.promptExtend === 'boolean' ? input.promptExtend : true;

    const parameters: Record<string, unknown> = {
      n,
      watermark,
      prompt_extend: promptExtend,
    };
    if (typeof input?.negativePrompt === 'string' && input.negativePrompt.trim().length > 0) {
      parameters.negative_prompt = input.negativePrompt.trim();
    } else {
      parameters.negative_prompt = ' ';
    }
    if (typeof input?.size === 'string' && input.size.trim().length > 0) {
      parameters.size = input.size.trim();
    }
    if (typeof input?.seed === 'number' && Number.isFinite(input.seed)) {
      parameters.seed = Math.trunc(input.seed);
    }

    const bodyObj = {
      model: runtime.modelCode ?? modelCode,
      input: {
        messages: [{ role: 'user', content }],
      },
      parameters,
    };

    const genResp = await fetch(genUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runtime.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyObj),
      signal: ctx.signal,
    });

    const genText = await genResp.text();
    let genJson: unknown;
    try {
      genJson = genText ? (JSON.parse(genText) as unknown) : {};
    } catch {
      throw AgenticEngineError.fromCode(
        'INTERNAL_UNKNOWN',
        `DashScope response was not JSON (HTTP ${genResp.status})`,
        { sample: genText.slice(0, 200) },
      );
    }

    if (!genResp.ok) {
      const msg = extractDashScopeErrorMessage(genJson, genResp.status);
      throw AgenticEngineError.fromCode('INTERNAL_UNKNOWN', `DashScope request failed: ${msg}`);
    }

    const urls = extractDashScopeImageUrls(genJson);
    if (urls.length === 0) {
      throw AgenticEngineError.fromCode(
        'INTERNAL_UNKNOWN',
        'DashScope returned no image URLs in output (empty choices or content)',
      );
    }

    return {
      requestId: readRequestId(genJson),
      model: runtime.modelCode ?? modelCode,
      images: urls.map((url) => ({ url })),
    };
  }
}

function readRequestId(doc: unknown): string | null {
  if (!doc || typeof doc !== 'object') return null;
  const o = doc as Record<string, unknown>;
  const a = o.request_id;
  if (typeof a === 'string' && a.length > 0) return a;
  const b = o.requestId;
  if (typeof b === 'string' && b.length > 0) return b;
  return null;
}

function extractDashScopeErrorMessage(doc: unknown, status: number): string {
  if (doc && typeof doc === 'object') {
    const o = doc as Record<string, unknown>;
    const m = o.message;
    if (typeof m === 'string' && m.trim()) return m.trim();
    const c = o.code;
    if (typeof c === 'string' && c.trim()) return `${c.trim()} (HTTP ${status})`;
  }
  return `HTTP ${status}`;
}

function extractDashScopeImageUrls(doc: unknown): string[] {
  const out: string[] = [];
  if (!doc || typeof doc !== 'object') return out;
  const root = doc as Record<string, unknown>;
  const output = root.output;
  if (!output || typeof output !== 'object') return out;
  const choices = (output as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return out;
  const first = choices[0];
  if (!first || typeof first !== 'object') return out;
  const msg = (first as { message?: unknown }).message;
  if (!msg || typeof msg !== 'object') return out;
  const arr = (msg as { content?: unknown }).content;
  if (!Array.isArray(arr)) return out;
  for (const item of arr) {
    if (item && typeof item === 'object' && 'image' in item) {
      const u = (item as { image: unknown }).image;
      if (typeof u === 'string' && u.trim().length > 0) out.push(u.trim());
    }
  }
  return out;
}
