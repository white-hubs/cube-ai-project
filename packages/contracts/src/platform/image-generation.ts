import { z } from 'zod';

export const ImageGenerationRequestSchema = z.object({
  tenant: z.number().int(),
  modelCode: z.string().min(1),
  prompt: z.string().min(1),
  referenceImages: z.array(z.string()).optional(),
  n: z.number().int().positive().max(4).optional(),
  size: z.string().optional(),
  negativePrompt: z.string().optional(),
  seed: z.number().int().optional(),
});
export type ImageGenerationRequest = z.infer<typeof ImageGenerationRequestSchema>;

export interface GeneratedImage {
  url: string;
}

export interface ImageGenerationResult {
  requestId: string | null;
  model: string;
  images: GeneratedImage[];
}

export interface ImageGenerationPort {
  generate(req: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationResult>;
}

export const AGENTIC_PLATFORM_IMAGE_GENERATION_TOKEN = Symbol.for('agentic.adapter.platform.image-generation');
