import { Inject, Injectable } from '@dangao/bun-server';
import type { ImageGenerationPort } from '@cube-ai/contracts';
import { AGENTIC_PLATFORM_IMAGE_GENERATION_TOKEN } from '@cube-ai/contracts/platform';
import { AgenticEngineError } from '../../../infra/errors/agentic-error';
import type { ToolHandlerCtx } from '../tool-context';
import type { ToolHandler } from './base-handler';

const DEFAULT_MODEL = 'qwen-image-2.0-pro';

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
    @Inject(AGENTIC_PLATFORM_IMAGE_GENERATION_TOKEN) private readonly imagePort: ImageGenerationPort,
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

    const result = await this.imagePort.generate(
      {
        tenant: ctx.auth.tenant,
        modelCode,
        prompt,
        referenceImages: refs.length > 0 ? refs : undefined,
        n,
        size: typeof input?.size === 'string' && input.size.trim() ? input.size.trim() : undefined,
        negativePrompt:
          typeof input?.negativePrompt === 'string' && input.negativePrompt.trim()
            ? input.negativePrompt.trim()
            : undefined,
        seed:
          typeof input?.seed === 'number' && Number.isFinite(input.seed)
            ? Math.trunc(input.seed)
            : undefined,
      },
      ctx.signal,
    );

    return {
      requestId: result.requestId,
      model: result.model,
      images: result.images,
    };
  }
}
