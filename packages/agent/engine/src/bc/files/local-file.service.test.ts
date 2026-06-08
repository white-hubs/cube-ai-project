import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ImageAttachment } from '@cube-ai/contracts';
import { LocalFileService } from './local-file.service';
import type { LocalFileAssetRecord } from './local-file.types';

class FakeRepo {
  readonly rows = new Map<string, LocalFileAssetRecord>();

  async insertUnbound(input: Omit<LocalFileAssetRecord, 'deleted' | 'boundSessionId' | 'boundMessageId' | 'status'>) {
    const row: LocalFileAssetRecord = {
      ...input,
      status: 'UNBOUND',
      boundSessionId: null,
      boundMessageId: null,
      deleted: 0,
    };
    this.rows.set(row.fileId, row);
    return row;
  }

  async findByFileId(fileId: string, tenant: number) {
    const row = this.rows.get(fileId);
    return row && row.tenant === tenant && row.deleted === 0 ? row : null;
  }

  async bindToMessage(input: { fileId: string; tenant: number; sessionId: string; messageId: string }) {
    const row = this.rows.get(input.fileId);
    if (!row || row.tenant !== input.tenant) return;
    row.status = 'BOUND';
    row.boundSessionId = input.sessionId;
    row.boundMessageId = input.messageId;
    row.expiresAt = null;
  }

  async listExpiredUnbound(nowMs: number) {
    return [...this.rows.values()].filter((row) => row.status === 'UNBOUND' && row.deleted === 0 && row.expiresAt !== null && row.expiresAt <= nowMs);
  }

  async markDeleted(fileId: string) {
    const row = this.rows.get(fileId);
    if (row) row.deleted = 1;
  }
}

describe('LocalFileService', () => {
  const tmpDir = join(process.cwd(), '.tmp-local-file-service-test');
  let oldDir: string | undefined;
  let oldTtl: string | undefined;

  beforeEach(async () => {
    oldDir = process.env['AGENTIC_ENGINE_LOCAL_FILE_DIR'];
    oldTtl = process.env['AGENTIC_ENGINE_LOCAL_FILE_UNBOUND_TTL_SECONDS'];
    process.env['AGENTIC_ENGINE_LOCAL_FILE_DIR'] = tmpDir;
    process.env['AGENTIC_ENGINE_LOCAL_FILE_UNBOUND_TTL_SECONDS'] = '60';
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    if (oldDir === undefined) delete process.env['AGENTIC_ENGINE_LOCAL_FILE_DIR'];
    else process.env['AGENTIC_ENGINE_LOCAL_FILE_DIR'] = oldDir;
    if (oldTtl === undefined) delete process.env['AGENTIC_ENGINE_LOCAL_FILE_UNBOUND_TTL_SECONDS'];
    else process.env['AGENTIC_ENGINE_LOCAL_FILE_UNBOUND_TTL_SECONDS'] = oldTtl;
    await rm(tmpDir, { recursive: true, force: true });
  });

  test('upload creates an unbound asset and returns previewUrl', async () => {
    const repo = new FakeRepo();
    const sessions = { findById: async () => null };
    const service = new LocalFileService(repo as never, sessions as never);
    const uploaded = await service.upload({
      tenant: 42,
      uploaderUserId: 'u1',
      fileName: 'a.png',
      mimeType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(uploaded.status).toBe('UNBOUND');
    expect(uploaded.previewUrl).toContain(`/v1/files/${uploaded.fileId}/preview`);
  });

  test('unbound preview denies non-uploader', async () => {
    const repo = new FakeRepo();
    const sessions = { findById: async () => null };
    const service = new LocalFileService(repo as never, sessions as never);
    const uploaded = await service.upload({
      tenant: 42,
      uploaderUserId: 'u1',
      fileName: 'a.png',
      mimeType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
    });
    await expect(
      service.buildPreviewResponse(uploaded.fileId, { tenant: 42, userId: 'u2' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED_GRANT_MISSING' });
  });

  test('bindAttachmentsToMessage marks assets bound', async () => {
    const repo = new FakeRepo();
    const sessions = { findById: async () => ({ userId: 'u1' }) };
    const service = new LocalFileService(repo as never, sessions as never);
    const uploaded = await service.upload({
      tenant: 42,
      uploaderUserId: 'u1',
      fileName: 'a.png',
      mimeType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
    });
    const attachments: ImageAttachment[] = [
      { attachmentId: 'att_01', kind: 'image', fileId: uploaded.fileId, mimeType: 'image/png' },
    ];
    await service.bindAttachmentsToMessage({
      tenant: 42,
      sessionId: '1820345678901234567',
      messageId: '1820345678901234568',
      attachments,
    });
    const row = await repo.findByFileId(uploaded.fileId, 42);
    expect(row?.status).toBe('BOUND');
  });

  test('gc deletes expired unbound assets but skips bound assets', async () => {
    const repo = new FakeRepo();
    const sessions = { findById: async () => ({ userId: 'u1' }) };
    const service = new LocalFileService(repo as never, sessions as never);
    const expired = await service.upload({
      tenant: 42,
      uploaderUserId: 'u1',
      fileName: 'a.png',
      mimeType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
    });
    const bound = await service.upload({
      tenant: 42,
      uploaderUserId: 'u1',
      fileName: 'b.png',
      mimeType: 'image/png',
      bytes: new Uint8Array([4, 5, 6]),
    });
    const expiredRow = await repo.findByFileId(expired.fileId, 42);
    if (expiredRow) expiredRow.expiresAt = Date.now() - 1000;
    await service.bindAttachmentsToMessage({
      tenant: 42,
      sessionId: '1820345678901234567',
      messageId: '1820345678901234568',
      attachments: [{ attachmentId: 'att_02', kind: 'image', fileId: bound.fileId, mimeType: 'image/png' }],
    });
    const result = await service.collectExpiredUnboundAssets(Date.now());
    expect(result.deletedFileIds).toContain(expired.fileId);
    expect(result.deletedFileIds).not.toContain(bound.fileId);
  });
});

