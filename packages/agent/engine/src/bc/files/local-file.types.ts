export type LocalFileAssetStatus = 'UNBOUND' | 'BOUND';

export interface LocalFileAssetRecord {
  fileId: string;
  tenant: number;
  uploaderUserId: string;
  status: LocalFileAssetStatus;
  storagePath: string;
  fileName: string | null;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  boundSessionId: string | null;
  boundMessageId: string | null;
  expiresAt: number | null;
  deleted: number;
}

export interface UploadLocalFileInput {
  tenant: number;
  uploaderUserId: string;
  fileName?: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface UploadedLocalFile {
  fileId: string;
  status: LocalFileAssetStatus;
  mimeType: string;
  size: number;
  sha256: string;
  previewUrl: string;
}

