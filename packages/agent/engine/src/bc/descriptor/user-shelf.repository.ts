import type { Pool, RowDataPacket } from 'mysql2/promise';
import { parseTenantDescriptorId, type ShelfEntryView } from '@cube-ai/contracts';
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import { SfidService } from '../../infra/sfid/sfid.service';
import { sharedSfidService } from '../../infra/sfid/shared-sfid';
import type { UserShelfRepository } from './shelf.service';

interface ShelfRow extends RowDataPacket {
  id: string;
  tenant: number;
  user_id: string;
  target_kind: 'agent' | 'skill';
  target_id: string;
  source: 'authored' | 'ref' | 'copy';
  pin_version_no: number | null;
  enabled: number | boolean;
  effective_version_no: number | null;
  display_name: string | null;
}

function rowToView(row: ShelfRow): ShelfEntryView {
  const enabled = Boolean(row.enabled);
  const effectiveVersionNo =
    row.effective_version_no == null ? null : Number(row.effective_version_no);
  return {
    id: row.id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    source: row.source,
    pinVersionNo: row.pin_version_no == null ? null : Number(row.pin_version_no),
    enabled,
    ...(row.display_name ? { displayName: row.display_name } : {}),
    effectiveVersionNo,
    runnableStatus: !enabled
      ? 'disabled'
      : row.source === 'authored' || effectiveVersionNo != null
        ? 'runnable'
        : parseTenantDescriptorId(row.target_id) == null
          ? 'runnable'
          : 'unresolvable',
  };
}

export class UserShelfRepositoryImpl implements UserShelfRepository {
  constructor(
    private readonly poolOrNull: Pool | null,
    private readonly sfid: SfidService = sharedSfidService,
  ) {}

  private get pool(): Pool {
    if (!this.poolOrNull) {
      throw AgenticEngineError.fromCode(
        'INTERNAL_UNKNOWN',
        'MySQL pool is not configured — set AGENTIC_ENGINE_MYSQL_URL for descriptor shelf',
        {},
      );
    }
    return this.poolOrNull;
  }

  private buildId(): string {
    return `she_${this.sfid.next()}`;
  }

  private async viewById(
    tenant: number,
    userId: string,
    shelfId: string,
  ): Promise<ShelfEntryView | null> {
    const [rows] = await this.pool.execute<ShelfRow[]>(
      `${this.baseSelect()}
       WHERE s.tenant = ? AND s.user_id = ? AND s.id = ? AND s.deleted = 0
       LIMIT 1`,
      [tenant, userId, shelfId],
    );
    return rows[0] ? rowToView(rows[0]) : null;
  }

  private baseSelect(): string {
    return `SELECT
        s.id, s.tenant, s.user_id, s.target_kind, s.target_id, s.source,
        s.pin_version_no, s.enabled,
        CASE
          WHEN s.source = 'authored' THEN NULL
          WHEN s.pin_version_no IS NOT NULL THEN s.pin_version_no
          ELSE l.shared_version_no
        END AS effective_version_no,
        COALESCE(
          JSON_UNQUOTE(JSON_EXTRACT(td.draft_content_json, '$.displayName')),
          JSON_UNQUOTE(JSON_EXTRACT(v.content_json, '$.displayName')),
          td.name,
          s.target_id
        ) AS display_name
       FROM user_descriptor_shelf s
       LEFT JOIN descriptor_listing l
         ON l.tenant = s.tenant AND l.descriptor_id = s.target_id
       LEFT JOIN tenant_descriptors td
         ON td.tenant = s.tenant AND td.id = s.target_id AND td.deleted = 0
       LEFT JOIN tenant_descriptor_versions v
         ON v.tenant = s.tenant
        AND v.descriptor_id = s.target_id
        AND v.version_no = COALESCE(s.pin_version_no, l.shared_version_no)`;
  }

  async listByUser(
    tenant: number,
    userId: string,
    kind: 'agent' | 'skill',
  ): Promise<ShelfEntryView[]> {
    const [rows] = await this.pool.execute<ShelfRow[]>(
      `${this.baseSelect()}
       WHERE s.tenant = ? AND s.user_id = ? AND s.target_kind = ? AND s.deleted = 0
       ORDER BY s.update_time DESC`,
      [tenant, userId, kind],
    );
    return rows.map(rowToView);
  }

  async findByTarget(
    tenant: number,
    userId: string,
    targetId: string,
  ): Promise<ShelfEntryView | null> {
    const [rows] = await this.pool.execute<ShelfRow[]>(
      `${this.baseSelect()}
       WHERE s.tenant = ? AND s.user_id = ? AND s.target_id = ? AND s.deleted = 0
       LIMIT 1`,
      [tenant, userId, targetId],
    );
    return rows[0] ? rowToView(rows[0]) : null;
  }

  findById(
    tenant: number,
    userId: string,
    shelfId: string,
  ): Promise<ShelfEntryView | null> {
    return this.viewById(tenant, userId, shelfId);
  }

  async insertRef(
    tenant: number,
    userId: string,
    kind: 'agent' | 'skill',
    targetId: string,
    pinVersionNo: number | null,
  ): Promise<ShelfEntryView> {
    const now = new Date();
    const id = this.buildId();
    await this.pool.execute(
      `INSERT INTO user_descriptor_shelf (
         id, tenant, user_id, target_kind, target_id, source, pin_version_no, enabled,
         deleted, create_by, create_time, update_by, update_time
       ) VALUES (?, ?, ?, ?, ?, 'ref', ?, 1, 0, ?, ?, ?, ?)`,
      [id, tenant, userId, kind, targetId, pinVersionNo, userId, now, userId, now],
    );
    const view = await this.viewById(tenant, userId, id);
    if (!view) {
      throw AgenticEngineError.fromCode('INTERNAL_UNKNOWN', 'Shelf entry not visible after insert', { id });
    }
    return view;
  }

  async patch(
    tenant: number,
    userId: string,
    shelfId: string,
    patch: { enabled?: boolean; pinVersionNo?: number | null },
  ): Promise<ShelfEntryView> {
    const current = await this.viewById(tenant, userId, shelfId);
    if (!current) {
      throw AgenticEngineError.fromCode(
        'RESOURCE_NOT_FOUND_DESCRIPTOR',
        `Shelf entry not found: ${shelfId}`,
        { shelfId },
      );
    }
    const now = new Date();
    await this.pool.execute(
      `UPDATE user_descriptor_shelf
       SET enabled = ?, pin_version_no = ?, update_by = ?, update_time = ?
       WHERE tenant = ? AND user_id = ? AND id = ? AND deleted = 0`,
      [
        patch.enabled ?? current.enabled,
        patch.pinVersionNo === undefined ? current.pinVersionNo : patch.pinVersionNo,
        userId,
        now,
        tenant,
        userId,
        shelfId,
      ],
    );
    const view = await this.viewById(tenant, userId, shelfId);
    if (!view) {
      throw AgenticEngineError.fromCode('INTERNAL_UNKNOWN', 'Shelf entry not visible after patch', { shelfId });
    }
    return view;
  }

  async softDelete(tenant: number, userId: string, shelfId: string): Promise<void> {
    const deletedMs = Date.now();
    const now = new Date();
    const [res] = await this.pool.execute(
      `UPDATE user_descriptor_shelf
       SET deleted = ?, update_by = ?, update_time = ?
       WHERE tenant = ? AND user_id = ? AND id = ? AND deleted = 0`,
      [deletedMs, userId, now, tenant, userId, shelfId],
    );
    const affected = (res as { affectedRows?: number }).affectedRows ?? 0;
    if (affected === 0) {
      throw AgenticEngineError.fromCode(
        'RESOURCE_NOT_FOUND_DESCRIPTOR',
        `Shelf entry not found: ${shelfId}`,
        { shelfId },
      );
    }
  }

  async upsertAuthored(
    tenant: number,
    userId: string,
    descriptorId: string,
    kind: 'agent' | 'skill',
  ): Promise<ShelfEntryView> {
    const existing = await this.findByTarget(tenant, userId, descriptorId);
    if (existing) return existing;
    const now = new Date();
    const id = this.buildId();
    await this.pool.execute(
      `INSERT INTO user_descriptor_shelf (
         id, tenant, user_id, target_kind, target_id, source, pin_version_no, enabled,
         deleted, create_by, create_time, update_by, update_time
       ) VALUES (?, ?, ?, ?, ?, 'authored', NULL, 1, 0, ?, ?, ?, ?)`,
      [id, tenant, userId, kind, descriptorId, userId, now, userId, now],
    );
    const view = await this.viewById(tenant, userId, id);
    if (!view) {
      throw AgenticEngineError.fromCode('INTERNAL_UNKNOWN', 'Authored shelf not visible after insert', { id });
    }
    return view;
  }
}
