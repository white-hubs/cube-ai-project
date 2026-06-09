import { Inject, Injectable } from '@dangao/bun-server';
import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import { SESSION_REPO_TOKEN } from '../session/session.tokens';
import type { SessionRepository } from '../session/repository/session.repository';
import { LocalFileRepository } from './local-file.repository';
import type {
  LocalFileAssetRecord,
  UploadLocalFileInput,
  UploadedLocalFile,
} from './local-file.types';
import type { ImageAttachment } from '@cube-ai/contracts';

const DEFAULT_STORAGE_DIR = join(process.cwd(), '.agentic-local-files');
const DEFAULT_UNBOUND_TTL_SEC = 3600;

@Injectable()
export class LocalFileService {
  private readonly storageDir = process.env['AGENTIC_ENGINE_LOCAL_FILE_DIR']?.trim() || DEFAULT_STORAGE_DIR;
  private readonly unboundTtlMs =
    Number(process.env['AGENTIC_ENGINE_LOCAL_FILE_UNBOUND_TTL_SECONDS'] ?? DEFAULT_UNBOUND_TTL_SEC) * 1000;

  constructor(
    private readonly repo: LocalFileRepository,
    @Inject(SESSION_REPO_TOKEN) private readonly sessions: SessionRepository,
  ) {}

  async upload(input: UploadLocalFileInput): Promise<UploadedLocalFile> {
    const fileId = `file_${crypto.randomUUID().replace(/-/g, '')}`;
    await mkdir(this.storageDir, { recursive: true });
    const fileName = input.fileName?.trim() || `${fileId}${extensionFromMime(input.mimeType)}`;
    const storagePath = join(this.storageDir, `${fileId}${extname(fileName) || extensionFromMime(input.mimeType)}`);
    const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes);
    await writeFile(storagePath, bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const asset = await this.repo.insertUnbound({
      fileId,
      tenant: input.tenant,
      uploaderUserId: input.uploaderUserId,
      storagePath,
      fileName,
      mimeType: input.mimeType,
      sizeBytes: bytes.byteLength,
      sha256,
      expiresAt: Date.now() + this.unboundTtlMs,
    });
    return this.toUploadResponse(asset);
  }

  async buildPreviewResponse(fileId: string, viewer: { tenant: number; userId: string }): Promise<Response> {
    const asset = await this.repo.findByFileId(fileId, viewer.tenant);
    if (!asset) {
      throw AgenticEngineError.fromCode('RESOURCE_NOT_FOUND_SESSION', `File ${fileId} not found`, { fileId });
    }
    await this.authorizePreview(asset, viewer);
    const body = await readFile(asset.storagePath);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': asset.mimeType,
        'Cache-Control': 'private, max-age=60',
      },
    });
  }

  async readImageAsset(input: {
    tenant: number;
    fileId: string;
    userId?: string;
  }): Promise<{ fileId: string; mimeType: string; sizeBytes: number; sha256: string; bytes: Uint8Array }> {
    const asset = await this.repo.findByFileId(input.fileId, input.tenant);
    if (!asset) {
      throw AgenticEngineError.fromCode('RESOURCE_NOT_FOUND_SESSION', `File ${input.fileId} not found`, {
        fileId: input.fileId,
      });
    }
    if (input.userId) {
      await this.authorizePreview(asset, { tenant: input.tenant, userId: input.userId });
    }
    const bytes = await readFile(asset.storagePath);
    return {
      fileId: asset.fileId,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
      bytes,
    };
  }

  async bindAttachmentsToMessage(input: {
    tenant: number;
    sessionId: string;
    messageId: string;
    attachments: ImageAttachment[];
  }): Promise<void> {
    for (const attachment of input.attachments) {
      await this.repo.bindToMessage({
        fileId: attachment.fileId,
        tenant: input.tenant,
        sessionId: input.sessionId,
        messageId: input.messageId,
      });
    }
  }

  async collectExpiredUnboundAssets(nowMs = Date.now()): Promise<{ deletedFileIds: string[] }> {
    const expired = await this.repo.listExpiredUnbound(nowMs);
    const deletedFileIds: string[] = [];
    for (const asset of expired) {
      try {
        await unlink(asset.storagePath);
      } catch {
        // best-effort file deletion; row cleanup still proceeds
      }
      await this.repo.markDeleted(asset.fileId, asset.tenant);
      deletedFileIds.push(asset.fileId);
    }
    return { deletedFileIds };
  }

  private async authorizePreview(asset: LocalFileAssetRecord, viewer: { tenant: number; userId: string }): Promise<void> {
    if (asset.status === 'UNBOUND') {
      if (asset.uploaderUserId !== viewer.userId) {
        throw AgenticEngineError.fromCode('PERMISSION_DENIED_GRANT_MISSING', 'Preview forbidden', {
          fileId: asset.fileId,
        });
      }
      return;
    }
    if (!asset.boundSessionId) {
      throw AgenticEngineError.fromCode('PERMISSION_DENIED_GRANT_MISSING', 'Preview forbidden', {
        fileId: asset.fileId,
      });
    }
    const session = await this.sessions.findById(viewer.tenant, asset.boundSessionId);
    if (!session || session.userId !== viewer.userId) {
      throw AgenticEngineError.fromCode('PERMISSION_DENIED_GRANT_MISSING', 'Preview forbidden', {
        fileId: asset.fileId,
      });
    }
  }

  private toUploadResponse(asset: LocalFileAssetRecord): UploadedLocalFile {
    return {
      fileId: asset.fileId,
      status: asset.status,
      mimeType: asset.mimeType,
      size: asset.sizeBytes,
      sha256: asset.sha256,
      previewUrl: `/files/${asset.fileId}/preview`,
    };
  }
}

function extensionFromMime(mimeType: string): string {
  switch (mimeType) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    default:
      return '.bin';
  }
}

