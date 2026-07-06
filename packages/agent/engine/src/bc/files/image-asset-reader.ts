export interface ImageAssetReadInput {
  tenant: number;
  fileId: string;
  userId?: string;
}

export interface ImageAssetReadResult {
  fileId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  bytes: Uint8Array;
}

/**
 * Host seam for reading image bytes by opaque file id.
 */
export interface ImageAssetReader {
  readImageAsset(input: ImageAssetReadInput): Promise<ImageAssetReadResult>;
}
