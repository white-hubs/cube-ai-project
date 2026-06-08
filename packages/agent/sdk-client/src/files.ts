import { z } from 'zod';
import type { AgenticClient } from './client';
import type { AgenticClientConfig } from './client';

export const UploadFileRequestSchema = z.object({
  fileName: z.string().min(1).max(255).optional(),
  mimeType: z.string().min(1).max(128),
  base64: z.string().min(1),
});

export const UploadedFileSchema = z.object({
  fileId: z.string().min(1),
  status: z.enum(['UNBOUND', 'BOUND']).optional(),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative().optional(),
  sha256: z.string().optional(),
  previewUrl: z.string().min(1),
});

export type UploadFileRequest = z.infer<typeof UploadFileRequestSchema>;
export type UploadedFile = z.infer<typeof UploadedFileSchema>;

export interface UploadFileInput {
  mimeType: string;
  base64: string;
  fileName?: string;
}

/**
 * Local file upload API — POST `/v1/files` (ADR-0008 §D4 files face).
 */
export class FilesApi {
  constructor(
    private readonly config: AgenticClientConfig,
    private readonly client: AgenticClient,
  ) {}

  async upload(input: UploadFileInput): Promise<UploadedFile> {
    const body = UploadFileRequestSchema.parse({
      mimeType: input.mimeType,
      base64: input.base64,
      ...(input.fileName !== undefined ? { fileName: input.fileName } : {}),
    });
    const raw = await this.client.requestJson<unknown>({
      method: 'POST',
      path: '/v1/files',
      body,
    });
    return UploadedFileSchema.parse(raw);
  }
}
