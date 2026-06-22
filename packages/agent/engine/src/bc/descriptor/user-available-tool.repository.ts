import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { AvailableToolView } from '@cube-ai/contracts';
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import { SfidService } from '../../infra/sfid/sfid.service';
import { sharedSfidService } from '../../infra/sfid/shared-sfid';
import type { UserAvailableToolRepository } from './plugin-catalog.service';

interface ToolRow extends RowDataPacket {
  tool_name: string;
  enabled: number | boolean;
}

function toView(row: ToolRow): AvailableToolView {
  return { toolName: row.tool_name, enabled: Boolean(row.enabled) };
}

export class UserAvailableToolRepositoryImpl implements UserAvailableToolRepository {
  constructor(
    private readonly poolOrNull: Pool | null,
    private readonly sfid: SfidService = sharedSfidService,
  ) {}

  private get pool(): Pool {
    if (!this.poolOrNull) {
      throw AgenticEngineError.fromCode(
        'INTERNAL_UNKNOWN',
        'MySQL pool is not configured — set AGENTIC_ENGINE_MYSQL_URL for available tools',
        {},
      );
    }
    return this.poolOrNull;
  }

  async listByUser(tenant: number, userId: string): Promise<AvailableToolView[]> {
    const [rows] = await this.pool.execute<ToolRow[]>(
      `SELECT tool_name, enabled FROM user_available_tool
       WHERE tenant = ? AND user_id = ? AND deleted = 0
       ORDER BY update_time DESC`,
      [tenant, userId],
    );
    return rows.map(toView);
  }

  async findByName(
    tenant: number,
    userId: string,
    toolName: string,
  ): Promise<AvailableToolView | null> {
    const [rows] = await this.pool.execute<ToolRow[]>(
      `SELECT tool_name, enabled FROM user_available_tool
       WHERE tenant = ? AND user_id = ? AND tool_name = ? AND deleted = 0
       LIMIT 1`,
      [tenant, userId, toolName],
    );
    return rows[0] ? toView(rows[0]) : null;
  }

  async insert(tenant: number, userId: string, toolName: string): Promise<AvailableToolView> {
    const now = new Date();
    await this.pool.execute(
      `INSERT INTO user_available_tool (
         id, tenant, user_id, tool_name, enabled, deleted, create_by, create_time, update_by, update_time
       ) VALUES (?, ?, ?, ?, 1, 0, ?, ?, ?, ?)`,
      [`uat_${this.sfid.next()}`, tenant, userId, toolName, userId, now, userId, now],
    );
    const view = await this.findByName(tenant, userId, toolName);
    if (!view) {
      throw AgenticEngineError.fromCode('INTERNAL_UNKNOWN', 'Available tool not visible after insert', { toolName });
    }
    return view;
  }

  async patch(
    tenant: number,
    userId: string,
    toolName: string,
    enabled: boolean,
  ): Promise<AvailableToolView> {
    const now = new Date();
    const [res] = await this.pool.execute(
      `UPDATE user_available_tool
       SET enabled = ?, update_by = ?, update_time = ?
       WHERE tenant = ? AND user_id = ? AND tool_name = ? AND deleted = 0`,
      [enabled ? 1 : 0, userId, now, tenant, userId, toolName],
    );
    const affected = (res as { affectedRows?: number }).affectedRows ?? 0;
    if (affected === 0) {
      throw AgenticEngineError.fromCode('RESOURCE_NOT_FOUND_DESCRIPTOR', `Available tool not found: ${toolName}`, { toolName });
    }
    const view = await this.findByName(tenant, userId, toolName);
    if (!view) {
      throw AgenticEngineError.fromCode('INTERNAL_UNKNOWN', 'Available tool not visible after patch', { toolName });
    }
    return view;
  }

  async softDelete(tenant: number, userId: string, toolName: string): Promise<void> {
    const now = new Date();
    const [res] = await this.pool.execute(
      `UPDATE user_available_tool
       SET deleted = ?, update_by = ?, update_time = ?
       WHERE tenant = ? AND user_id = ? AND tool_name = ? AND deleted = 0`,
      [Date.now(), userId, now, tenant, userId, toolName],
    );
    const affected = (res as { affectedRows?: number }).affectedRows ?? 0;
    if (affected === 0) {
      throw AgenticEngineError.fromCode('RESOURCE_NOT_FOUND_DESCRIPTOR', `Available tool not found: ${toolName}`, { toolName });
    }
  }
}
