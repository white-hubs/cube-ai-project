import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { DescriptorListingView, LibraryItemView } from '@cube-ai/contracts';
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import type { DescriptorListingRepository } from './listing.service';

interface ListingRow extends RowDataPacket {
  descriptor_id: string;
  tenant: number;
  listed: number | boolean;
  shared_version_no: number;
  publisher_user_id: string;
  listed_time: Date | string | number | null;
  unlisted_time: Date | string | number | null;
}

interface LibraryRow extends ListingRow {
  kind: 'agent' | 'skill';
  content_json: unknown;
}

function toEpochMs(v: Date | string | number | null): number | null {
  if (v == null) return null;
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

function listingView(row: ListingRow): DescriptorListingView {
  return {
    descriptorId: row.descriptor_id,
    listed: Boolean(row.listed),
    sharedVersionNo: Number(row.shared_version_no),
    publisherUserId: row.publisher_user_id,
    listedTime: toEpochMs(row.listed_time),
    unlistedTime: toEpochMs(row.unlisted_time),
  };
}

function tenantLibraryItem(row: LibraryRow): LibraryItemView {
  const content = parseJsonColumn(row.content_json);
  const meta = content && typeof content === 'object'
    ? (content as Record<string, unknown>)
    : {};
  return {
    ref: row.descriptor_id,
    kind: row.kind,
    tier: 'tenant',
    ...(typeof meta.displayName === 'string' ? { displayName: meta.displayName } : {}),
    ...(typeof meta.description === 'string' ? { description: meta.description } : {}),
    ...(Array.isArray(meta.tags) ? { tags: meta.tags.filter((t): t is string => typeof t === 'string') } : {}),
    sharedVersionNo: Number(row.shared_version_no),
    content,
  };
}

export class DescriptorListingRepositoryImpl implements DescriptorListingRepository {
  constructor(private readonly poolOrNull: Pool | null) {}

  private get pool(): Pool {
    if (!this.poolOrNull) {
      throw AgenticEngineError.fromCode(
        'INTERNAL_UNKNOWN',
        'MySQL pool is not configured — set AGENTIC_ENGINE_MYSQL_URL for descriptor listing',
        {},
      );
    }
    return this.poolOrNull;
  }

  async get(tenant: number, descriptorId: string): Promise<DescriptorListingView | null> {
    const [rows] = await this.pool.execute<ListingRow[]>(
      `SELECT * FROM descriptor_listing
       WHERE tenant = ? AND descriptor_id = ?
       LIMIT 1`,
      [tenant, descriptorId],
    );
    return rows[0] ? listingView(rows[0]) : null;
  }

  async list(
    tenant: number,
    descriptorId: string,
    versionNo: number,
    actor: string,
  ): Promise<DescriptorListingView> {
    const now = new Date();
    await this.pool.execute(
      `INSERT INTO descriptor_listing (
         descriptor_id, tenant, listed, shared_version_no, publisher_user_id,
         listed_time, unlisted_time, create_by, create_time, update_by, update_time
       ) VALUES (?, ?, 1, ?, ?, ?, NULL, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         listed = 1,
         shared_version_no = VALUES(shared_version_no),
         publisher_user_id = VALUES(publisher_user_id),
         listed_time = VALUES(listed_time),
         unlisted_time = NULL,
         update_by = VALUES(update_by),
         update_time = VALUES(update_time)`,
      [descriptorId, tenant, versionNo, actor, now, actor, now, actor, now],
    );
    const view = await this.get(tenant, descriptorId);
    if (!view) {
      throw AgenticEngineError.fromCode(
        'INTERNAL_UNKNOWN',
        'Descriptor listing not visible after list',
        { descriptorId },
      );
    }
    return view;
  }

  async unlist(
    tenant: number,
    descriptorId: string,
    actor: string,
  ): Promise<DescriptorListingView> {
    const now = new Date();
    const [res] = await this.pool.execute(
      `UPDATE descriptor_listing
       SET listed = 0, unlisted_time = ?, update_by = ?, update_time = ?
       WHERE tenant = ? AND descriptor_id = ?`,
      [now, actor, now, tenant, descriptorId],
    );
    const affected = (res as { affectedRows?: number }).affectedRows ?? 0;
    if (affected === 0) {
      throw AgenticEngineError.fromCode(
        'RESOURCE_NOT_FOUND_DESCRIPTOR',
        `Descriptor listing not found: ${descriptorId}`,
        { descriptorId },
      );
    }
    const view = await this.get(tenant, descriptorId);
    if (!view) {
      throw AgenticEngineError.fromCode(
        'INTERNAL_UNKNOWN',
        'Descriptor listing not visible after unlist',
        { descriptorId },
      );
    }
    return view;
  }

  async browseListed(tenant: number, kind: 'agent' | 'skill'): Promise<LibraryItemView[]> {
    const [rows] = await this.pool.execute<LibraryRow[]>(
      `SELECT l.*, d.kind, v.content_json
       FROM descriptor_listing l
       JOIN tenant_descriptors d
         ON d.id = l.descriptor_id AND d.tenant = l.tenant AND d.deleted = 0
       JOIN tenant_descriptor_versions v
         ON v.descriptor_id = l.descriptor_id
        AND v.tenant = l.tenant
        AND v.version_no = l.shared_version_no
       WHERE l.tenant = ? AND l.listed = 1 AND d.kind = ?
       ORDER BY l.update_time DESC`,
      [tenant, kind],
    );
    return rows.map(tenantLibraryItem);
  }
}
