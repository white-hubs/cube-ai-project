/**
 * TenantDescriptorRepository —— 租户级 descriptor 管理面持久层（ADR-0016 §2/§4）。
 *
 * - 唯一权威 = engine 域 MySQL（tenant 隔离），id = 类型前缀 + SFID（服务端生成）。
 * - draft/publish 两态 + append-only 版本历史：编辑产生草稿版本（head_version_no+1，
 *   status 回 draft），publish 移 published_version_no 指针。
 * - 运行时只解析 published head（`resolvePublished`）。
 *
 * 复用 `agentic.infra.mysql` 同一 pool（与 session/turn 同库），tenant 显式入参、不嵌 id。
 */
import { Injectable } from '@dangao/bun-server';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import {
  TENANT_DESCRIPTOR_ID_PREFIXES,
  type DescriptorVersion,
  type TenantDescriptorKind,
  type TenantDescriptorStatus,
  type TenantDescriptorView,
} from '@cube-ai/contracts';
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import { SfidService } from '../../infra/sfid/sfid.service';
import { sharedSfidService } from '../../infra/sfid/shared-sfid';

export interface UpsertDescriptorResult {
  id: string;
  name: string;
  action: 'created' | 'updated';
  headVersionNo: number;
  status: 'draft';
}

export interface TenantDescriptorRepository {
  upsert(
    tenant: number,
    kind: TenantDescriptorKind,
    name: string,
    content: unknown,
    actor?: string,
  ): Promise<UpsertDescriptorResult>;
  findById(tenant: number, id: string): Promise<TenantDescriptorView | null>;
  findByName(
    tenant: number,
    kind: TenantDescriptorKind,
    name: string,
  ): Promise<TenantDescriptorView | null>;
  list(tenant: number, kind: TenantDescriptorKind): Promise<TenantDescriptorView[]>;
  publish(tenant: number, id: string, actor?: string): Promise<TenantDescriptorView>;
  softDelete(tenant: number, id: string, actor?: string): Promise<void>;
  /** 运行时解析：仅返回已发布行，content 为 published 版本内容。未发布 / 不存在 → null。 */
  resolvePublished(tenant: number, id: string): Promise<TenantDescriptorView | null>;
  listVersions(tenant: number, id: string): Promise<DescriptorVersion[]>;
  getVersionContent(tenant: number, id: string, versionNo: number): Promise<unknown | null>;
  rollback(
    tenant: number,
    id: string,
    versionNo: number,
    actor?: string,
  ): Promise<TenantDescriptorView>;
  resolveDraft(tenant: number, id: string): Promise<TenantDescriptorView | null>;
}

interface DescriptorHeadRow extends RowDataPacket {
  id: string;
  tenant: number;
  kind: string;
  name: string;
  owner_user_id?: string | null;
  draft_content_json?: unknown;
  head_version_no: number;
  published_version_no: number | null;
  status: string;
  create_time: Date | string | number;
  update_time: Date | string | number;
}

interface VersionRow extends RowDataPacket {
  version_no: number;
  content_json: unknown;
  create_by: string;
  create_time: Date | string | number;
}

function toEpochMs(v: Date | string | number): number {
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function parseJsonColumn(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

function buildId(kind: TenantDescriptorKind, sfid: string): string {
  return `${TENANT_DESCRIPTOR_ID_PREFIXES[kind]}${sfid}`;
}

@Injectable()
export class TenantDescriptorRepositoryImpl implements TenantDescriptorRepository {
  constructor(
    private readonly poolOrNull: Pool | null,
    private readonly sfid: SfidService = sharedSfidService,
  ) {}

  private get pool(): Pool {
    if (!this.poolOrNull) {
      throw AgenticEngineError.fromCode(
        'INTERNAL_UNKNOWN',
        'MySQL pool is not configured — set AGENTIC_ENGINE_MYSQL_URL for descriptor management',
        {},
      );
    }
    return this.poolOrNull;
  }

  private notFound(id: string): never {
    throw AgenticEngineError.fromCode(
      'RESOURCE_NOT_FOUND_DESCRIPTOR',
      `Tenant descriptor not found: ${id}`,
      { descriptorId: id },
    );
  }

  private async headRow(
    conn: Pool | PoolConnection,
    tenant: number,
    id: string,
  ): Promise<DescriptorHeadRow | null> {
    const [rows] = await conn.execute<DescriptorHeadRow[]>(
      `SELECT * FROM tenant_descriptors WHERE id = ? AND tenant = ? AND deleted = 0 LIMIT 1`,
      [id, tenant],
    );
    return rows[0] ?? null;
  }

  private async lockedHeadRow(
    conn: PoolConnection,
    tenant: number,
    id: string,
  ): Promise<DescriptorHeadRow | null> {
    const [rows] = await conn.execute<DescriptorHeadRow[]>(
      `SELECT * FROM tenant_descriptors
       WHERE id = ? AND tenant = ? AND deleted = 0
       FOR UPDATE`,
      [id, tenant],
    );
    return rows[0] ?? null;
  }

  private async versionContent(
    conn: Pool | PoolConnection,
    tenant: number,
    descriptorId: string,
    versionNo: number,
  ): Promise<unknown> {
    const [rows] = await conn.execute<VersionRow[]>(
      `SELECT content_json FROM tenant_descriptor_versions
       WHERE tenant = ? AND descriptor_id = ? AND version_no = ? LIMIT 1`,
      [tenant, descriptorId, versionNo],
    );
    return rows[0] ? parseJsonColumn(rows[0].content_json) : null;
  }

  private draftContent(row: DescriptorHeadRow): unknown {
    return parseJsonColumn(row.draft_content_json);
  }

  private async hasUnpublishedChanges(
    conn: Pool | PoolConnection,
    row: DescriptorHeadRow,
    draftContent: unknown,
  ): Promise<boolean> {
    if (row.published_version_no == null) return true;
    const published = await this.versionContent(
      conn,
      row.tenant,
      row.id,
      Number(row.published_version_no),
    );
    return JSON.stringify(draftContent ?? null) !== JSON.stringify(published ?? null);
  }

  private async nextPublishedVersion(
    conn: Pool | PoolConnection,
    tenant: number,
    descriptorId: string,
  ): Promise<number> {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT COALESCE(MAX(version_no), 0) + 1 AS next_version
       FROM tenant_descriptor_versions
       WHERE tenant = ? AND descriptor_id = ?`,
      [tenant, descriptorId],
    );
    return Number(rows[0]?.next_version ?? 1);
  }

  private toView(
    row: DescriptorHeadRow,
    content: unknown,
    hasUnpublishedChanges: boolean,
  ): TenantDescriptorView {
    return {
      id: row.id,
      kind: row.kind as TenantDescriptorView['kind'],
      name: row.name,
      ownerUserId: row.owner_user_id ?? null,
      status: row.status as TenantDescriptorStatus,
      headVersionNo: Number(row.head_version_no),
      publishedVersionNo:
        row.published_version_no == null ? null : Number(row.published_version_no),
      hasUnpublishedChanges,
      content,
      createTime: toEpochMs(row.create_time),
      updateTime: toEpochMs(row.update_time),
    };
  }

  async upsert(
    tenant: number,
    kind: TenantDescriptorKind,
    name: string,
    content: unknown,
    actor = 'system',
  ): Promise<UpsertDescriptorResult> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_DESCRIPTOR_NAME',
        'Descriptor name must be non-empty',
        { kind },
      );
    }

    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      const [existingRows] = await conn.execute<DescriptorHeadRow[]>(
        `SELECT * FROM tenant_descriptors
         WHERE tenant = ? AND kind = ? AND name = ? AND deleted = 0
         FOR UPDATE`,
        [tenant, kind, trimmedName],
      );
      const existing = existingRows[0] ?? null;
      const now = new Date();
      const contentStr = JSON.stringify(content ?? {});

      let id: string;
      let headVersionNo: number;
      let action: 'created' | 'updated';

      if (!existing) {
        id = buildId(kind, this.sfid.next());
        headVersionNo = 1;
        action = 'created';
        await conn.execute(
          `INSERT INTO tenant_descriptors (
            id, tenant, kind, name, owner_user_id, head_version_no, published_version_no, status,
            draft_content_json,
            deleted, create_by, create_time, update_by, update_time
          ) VALUES (?, ?, ?, ?, ?, 1, NULL, 'draft', CAST(? AS JSON), 0, ?, ?, ?, ?)`,
          [id, tenant, kind, trimmedName, actor, contentStr, actor, now, actor, now],
        );
      } else {
        id = existing.id;
        headVersionNo = Number(existing.head_version_no) + 1;
        action = 'updated';
        await conn.execute(
          `UPDATE tenant_descriptors
           SET head_version_no = ?, status = 'draft', draft_content_json = CAST(? AS JSON),
               update_by = ?, update_time = ?
           WHERE id = ? AND tenant = ? AND deleted = 0`,
          [headVersionNo, contentStr, actor, now, id, tenant],
        );
      }

      await conn.commit();
      return { id, name: trimmedName, action, headVersionNo, status: 'draft' };
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
  }

  async findById(tenant: number, id: string): Promise<TenantDescriptorView | null> {
    const row = await this.headRow(this.pool, tenant, id);
    if (!row) return null;
    const content = this.draftContent(row);
    return this.toView(row, content, await this.hasUnpublishedChanges(this.pool, row, content));
  }

  async findByName(
    tenant: number,
    kind: TenantDescriptorKind,
    name: string,
  ): Promise<TenantDescriptorView | null> {
    const [rows] = await this.pool.execute<DescriptorHeadRow[]>(
      `SELECT * FROM tenant_descriptors
       WHERE tenant = ? AND kind = ? AND name = ? AND deleted = 0 LIMIT 1`,
      [tenant, kind, name.trim()],
    );
    const row = rows[0];
    if (!row) return null;
    const content = this.draftContent(row);
    return this.toView(row, content, await this.hasUnpublishedChanges(this.pool, row, content));
  }

  async list(tenant: number, kind: TenantDescriptorKind): Promise<TenantDescriptorView[]> {
    const [rows] = await this.pool.execute<DescriptorHeadRow[]>(
      `SELECT * FROM tenant_descriptors
       WHERE tenant = ? AND kind = ? AND deleted = 0
       ORDER BY update_time DESC`,
      [tenant, kind],
    );
    const out: TenantDescriptorView[] = [];
    for (const row of rows) {
      const content = this.draftContent(row);
      out.push(this.toView(row, content, await this.hasUnpublishedChanges(this.pool, row, content)));
    }
    return out;
  }

  async publish(tenant: number, id: string, actor = 'system'): Promise<TenantDescriptorView> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const row = await this.lockedHeadRow(conn, tenant, id);
      if (!row) this.notFound(id);
      const now = new Date();
      const content = this.draftContent(row);
      const contentStr = JSON.stringify(content ?? {});
      const versionNo = await this.nextPublishedVersion(conn, tenant, id);

      await conn.execute(
        `INSERT INTO tenant_descriptor_versions (
          descriptor_id, tenant, version_no, content_json, create_by, create_time
        ) VALUES (?, ?, ?, CAST(? AS JSON), ?, ?)`,
        [id, tenant, versionNo, contentStr, actor, now],
      );
      await conn.execute(
        `UPDATE tenant_descriptors
         SET published_version_no = ?, status = 'published',
             update_by = ?, update_time = ?
         WHERE id = ? AND tenant = ? AND deleted = 0`,
        [versionNo, actor, now, id, tenant],
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
    const updated = await this.findById(tenant, id);
    if (!updated) this.notFound(id);
    return updated;
  }

  async softDelete(tenant: number, id: string, actor = 'system'): Promise<void> {
    const deletedMs = Date.now();
    const now = new Date();
    const [res] = await this.pool.execute(
      `UPDATE tenant_descriptors
       SET deleted = ?, update_by = ?, update_time = ?
       WHERE id = ? AND tenant = ? AND deleted = 0`,
      [deletedMs, actor, now, id, tenant],
    );
    const affected = (res as { affectedRows?: number }).affectedRows ?? 0;
    if (affected === 0) this.notFound(id);
  }

  async resolvePublished(tenant: number, id: string): Promise<TenantDescriptorView | null> {
    const row = await this.headRow(this.pool, tenant, id);
    if (!row || row.published_version_no == null) return null;
    const content = await this.versionContent(this.pool, tenant, id, Number(row.published_version_no));
    return {
      ...this.toView(row, content, await this.hasUnpublishedChanges(this.pool, row, this.draftContent(row))),
      // 运行时视图：status 恒为 published，headVersionNo 仍为 head（审计）
      status: 'published',
    };
  }

  async listVersions(tenant: number, id: string): Promise<DescriptorVersion[]> {
    const [rows] = await this.pool.execute<VersionRow[]>(
      `SELECT version_no, content_json, create_by, create_time
       FROM tenant_descriptor_versions
       WHERE tenant = ? AND descriptor_id = ?
       ORDER BY version_no ASC`,
      [tenant, id],
    );
    return rows.map((row) => ({
      versionNo: Number(row.version_no),
      createBy: row.create_by,
      createTime: toEpochMs(row.create_time),
    }));
  }

  getVersionContent(tenant: number, id: string, versionNo: number): Promise<unknown | null> {
    return this.versionContent(this.pool, tenant, id, versionNo);
  }

  async rollback(
    tenant: number,
    id: string,
    versionNo: number,
    actor = 'system',
  ): Promise<TenantDescriptorView> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const row = await this.lockedHeadRow(conn, tenant, id);
      if (!row) this.notFound(id);
      const content = await this.versionContent(conn, tenant, id, versionNo);
      if (content == null) this.notFound(id);
      const now = new Date();
      const nextVersionNo = await this.nextPublishedVersion(conn, tenant, id);
      const nextHeadVersionNo = Number(row.head_version_no) + 1;
      const contentStr = JSON.stringify(content ?? {});

      await conn.execute(
        `INSERT INTO tenant_descriptor_versions (
          descriptor_id, tenant, version_no, content_json, create_by, create_time
        ) VALUES (?, ?, ?, CAST(? AS JSON), ?, ?)`,
        [id, tenant, nextVersionNo, contentStr, actor, now],
      );
      await conn.execute(
        `UPDATE tenant_descriptors
         SET head_version_no = ?, published_version_no = ?, status = 'published',
             draft_content_json = CAST(? AS JSON), update_by = ?, update_time = ?
         WHERE id = ? AND tenant = ? AND deleted = 0`,
        [nextHeadVersionNo, nextVersionNo, contentStr, actor, now, id, tenant],
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw e;
    } finally {
      conn.release();
    }

    const updated = await this.findById(tenant, id);
    if (!updated) this.notFound(id);
    return updated;
  }

  resolveDraft(tenant: number, id: string): Promise<TenantDescriptorView | null> {
    return this.findById(tenant, id);
  }
}
