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
}

interface DescriptorHeadRow extends RowDataPacket {
  id: string;
  tenant: number;
  kind: string;
  name: string;
  head_version_no: number;
  published_version_no: number | null;
  status: string;
  create_time: Date | string | number;
  update_time: Date | string | number;
}

interface VersionRow extends RowDataPacket {
  content_json: unknown;
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

  private async versionContent(
    conn: Pool | PoolConnection,
    descriptorId: string,
    versionNo: number,
  ): Promise<unknown> {
    const [rows] = await conn.execute<VersionRow[]>(
      `SELECT content_json FROM tenant_descriptor_versions
       WHERE descriptor_id = ? AND version_no = ? LIMIT 1`,
      [descriptorId, versionNo],
    );
    return rows[0] ? parseJsonColumn(rows[0].content_json) : null;
  }

  private toView(row: DescriptorHeadRow, content: unknown): TenantDescriptorView {
    return {
      id: row.id,
      kind: row.kind as TenantDescriptorView['kind'],
      name: row.name,
      status: row.status as TenantDescriptorStatus,
      headVersionNo: Number(row.head_version_no),
      publishedVersionNo:
        row.published_version_no == null ? null : Number(row.published_version_no),
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
            id, tenant, kind, name, head_version_no, published_version_no, status,
            deleted, create_by, create_time, update_by, update_time
          ) VALUES (?, ?, ?, ?, 1, NULL, 'draft', 0, ?, ?, ?, ?)`,
          [id, tenant, kind, trimmedName, actor, now, actor, now],
        );
      } else {
        id = existing.id;
        headVersionNo = Number(existing.head_version_no) + 1;
        action = 'updated';
        await conn.execute(
          `UPDATE tenant_descriptors
           SET head_version_no = ?, status = 'draft', update_by = ?, update_time = ?
           WHERE id = ? AND tenant = ? AND deleted = 0`,
          [headVersionNo, actor, now, id, tenant],
        );
      }

      await conn.execute(
        `INSERT INTO tenant_descriptor_versions (
          descriptor_id, tenant, version_no, content_json, create_by, create_time
        ) VALUES (?, ?, ?, CAST(? AS JSON), ?, ?)`,
        [id, tenant, headVersionNo, contentStr, actor, now],
      );

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
    const content = await this.versionContent(this.pool, id, Number(row.head_version_no));
    return this.toView(row, content);
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
    const content = await this.versionContent(this.pool, row.id, Number(row.head_version_no));
    return this.toView(row, content);
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
      const content = await this.versionContent(this.pool, row.id, Number(row.head_version_no));
      out.push(this.toView(row, content));
    }
    return out;
  }

  async publish(tenant: number, id: string, actor = 'system'): Promise<TenantDescriptorView> {
    const row = await this.headRow(this.pool, tenant, id);
    if (!row) this.notFound(id);
    const now = new Date();
    await this.pool.execute(
      `UPDATE tenant_descriptors
       SET published_version_no = head_version_no, status = 'published',
           update_by = ?, update_time = ?
       WHERE id = ? AND tenant = ? AND deleted = 0`,
      [actor, now, id, tenant],
    );
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
    const content = await this.versionContent(this.pool, id, Number(row.published_version_no));
    return {
      ...this.toView(row, content),
      // 运行时视图：status 恒为 published，headVersionNo 仍为 head（审计）
      status: 'published',
    };
  }
}
