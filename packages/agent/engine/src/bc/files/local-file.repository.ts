import { Inject, Injectable } from '@dangao/bun-server';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL_TOKEN } from '../session/session.tokens';
import type { LocalFileAssetRecord } from './local-file.types';

@Injectable()
export class LocalFileRepository {
  constructor(@Inject(MYSQL_POOL_TOKEN) private readonly pool: Pool | null) {}

  private requirePool(): Pool {
    if (!this.pool) throw new Error('MYSQL_POOL_TOKEN missing');
    return this.pool;
  }

  async insertUnbound(input: Omit<LocalFileAssetRecord, 'deleted' | 'boundSessionId' | 'boundMessageId' | 'status'>): Promise<LocalFileAssetRecord> {
    const p = this.requirePool();
    const now = new Date();
    await p.execute(
      `INSERT INTO file_assets (
        file_id, tenant, uploader_user_id, status, storage_path, file_name,
        mime_type, size_bytes, sha256, bound_session_id, bound_message_id,
        expires_at, deleted, create_time, update_time
      ) VALUES (?, ?, ?, 'UNBOUND', ?, ?, ?, ?, ?, NULL, NULL, ?, 0, ?, ?)`,
      [
        input.fileId,
        input.tenant,
        input.uploaderUserId,
        input.storagePath,
        input.fileName,
        input.mimeType,
        input.sizeBytes,
        input.sha256,
        input.expiresAt !== null ? new Date(input.expiresAt) : null,
        now,
        now,
      ],
    );
    return {
      ...input,
      status: 'UNBOUND',
      boundSessionId: null,
      boundMessageId: null,
      deleted: 0,
    };
  }

  async findByFileId(fileId: string, tenant: number): Promise<LocalFileAssetRecord | null> {
    const p = this.requirePool();
    const [rows] = await p.execute<RowDataPacket[]>(
      `SELECT file_id, tenant, uploader_user_id, status, storage_path, file_name, mime_type,
              size_bytes, sha256, bound_session_id, bound_message_id, expires_at, deleted
       FROM file_assets
       WHERE file_id = ? AND tenant = ? AND deleted = 0`,
      [fileId, tenant],
    );
    if (rows.length === 0) return null;
    return mapRow(rows[0] as RowDataPacket);
  }

  async bindToMessage(input: {
    fileId: string;
    tenant: number;
    sessionId: string;
    messageId: string;
  }): Promise<void> {
    const p = this.requirePool();
    await p.execute(
      `UPDATE file_assets
       SET status = 'BOUND',
           bound_session_id = ?,
           bound_message_id = ?,
           expires_at = NULL,
           update_time = ?
       WHERE file_id = ? AND tenant = ? AND deleted = 0`,
      [BigInt(input.sessionId), BigInt(input.messageId), new Date(), input.fileId, input.tenant],
    );
  }

  async listExpiredUnbound(nowMs: number, limit = 100): Promise<LocalFileAssetRecord[]> {
    const p = this.requirePool();
    const [rows] = await p.execute<RowDataPacket[]>(
      `SELECT file_id, tenant, uploader_user_id, status, storage_path, file_name, mime_type,
              size_bytes, sha256, bound_session_id, bound_message_id, expires_at, deleted
       FROM file_assets
       WHERE status = 'UNBOUND' AND deleted = 0 AND expires_at IS NOT NULL AND expires_at <= ?
       ORDER BY expires_at ASC
       LIMIT ?`,
      [new Date(nowMs), limit],
    );
    return rows.map((row) => mapRow(row));
  }

  async markDeleted(fileId: string, tenant: number): Promise<void> {
    const p = this.requirePool();
    await p.execute(
      `UPDATE file_assets SET deleted = 1, update_time = ? WHERE file_id = ? AND tenant = ? AND deleted = 0`,
      [new Date(), fileId, tenant],
    );
  }
}

function mapRow(row: RowDataPacket): LocalFileAssetRecord {
  const expiresRaw = row.expires_at as string | Date | null | undefined;
  return {
    fileId: String(row.file_id),
    tenant: Number(row.tenant),
    uploaderUserId: String(row.uploader_user_id),
    status: String(row.status) as LocalFileAssetRecord['status'],
    storagePath: String(row.storage_path),
    fileName: row.file_name == null ? null : String(row.file_name),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    sha256: String(row.sha256),
    boundSessionId: row.bound_session_id == null ? null : String(row.bound_session_id),
    boundMessageId: row.bound_message_id == null ? null : String(row.bound_message_id),
    expiresAt:
      expiresRaw == null ? null : new Date(expiresRaw).getTime(),
    deleted: Number(row.deleted ?? 0),
  };
}

