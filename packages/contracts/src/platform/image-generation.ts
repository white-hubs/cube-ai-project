import { z } from "zod";

export const ImageGenerationRequestSchema = z.object({
  modelCode: z.string().min(1),
  n: z.number().int().positive().max(4).optional(),
  negativePrompt: z.string().optional(),
  prompt: z.string().min(1),
  referenceImages: z.array(z.string()).optional(),
  seed: z.number().int().optional(),
  size: z.string().optional(),
  tenant: z.number().int(),
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

export const AGENTIC_PLATFORM_IMAGE_GENERATION_TOKEN = Symbol.for("agentic.adapter.platform.image-generation");
