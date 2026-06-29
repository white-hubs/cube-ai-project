import { z } from "zod";

import { type AgenticClient, type AgenticClientConfig } from "./client";

export const UploadFileRequestSchema = z.object({
  base64: z.string().min(1),
  fileName: z.string().min(1).max(255).optional(),
  mimeType: z.string().min(1).max(128),
});

export const UploadedFileSchema = z.object({
  fileId: z.string().min(1),
  mimeType: z.string().min(1),
  previewUrl: z.string().min(1),
  sha256: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  status: z.enum(["UNBOUND", "BOUND"]).optional(),
});

export type UploadFileRequest = z.infer<typeof UploadFileRequestSchema>;
export type UploadedFile = z.infer<typeof UploadedFileSchema>;

export interface UploadFileInput {
  mimeType: string;
  base64: string;
  fileName?: string;
}

/**
 * Local file upload API — POST `/files` (ADR-0008 §D4 files face).
 */
export class FilesApi {
  constructor(
    private readonly config: AgenticClientConfig,
    private readonly client: AgenticClient,
  ) {}

  async upload(input: UploadFileInput): Promise<UploadedFile> {
    const body = UploadFileRequestSchema.parse({
      base64: input.base64,
      mimeType: input.mimeType,
      ...(input.fileName !== undefined ? { fileName: input.fileName } : {}),
    });
    const raw = await this.client.requestJson<unknown>({
      body,
      method: "POST",
      path: "/files",
    });
    return UploadedFileSchema.parse(raw);
  }
}
