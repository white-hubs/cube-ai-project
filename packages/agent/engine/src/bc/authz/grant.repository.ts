/**
 * MySQL persistence for `grants` (G-A / G-B / G-D).
 *
 * ref: docs/detailed-design/04-auth-and-authz/authorization-gateway.md §7.2
 *      packages/contracts/src/authz/grant.ts
 */
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { ArgsConstraint, Grant, GrantForm, GrantScope } from '@cube-ai/contracts';

export interface IGrantRepository {
  findById(tenant: number, id: string): Promise<Grant | null>;
  /** SFID 全局唯一 — 无 tenant 上下文时用 */
  findBySfid(id: string): Promise<Grant | null>;
  findUserGrants(tenant: number, userId: string): Promise<Grant[]>;
  findAdminGrants(tenant: number): Promise<Grant[]>;
  findActiveForUserTool(tenant: number, userId: string, toolName: string): Promise<Grant | null>;
  insertGrant(row: GrantInsert): Promise<void>;
  updateExpire(grantId: string, tenant: number, expireTimeMs: number): Promise<void>;
  softRevoke(grantId: string, tenant: number, revokeUserId: string): Promise<void>;
}

export type GrantInsert = Grant & {
  createBy: string;
  updateBy: string;
};

function rowToGrant(row: GrantRow): Grant {
  const scope: GrantScope = row.scope_tool_name
    ? {
        toolName: row.scope_tool_name,
        action: row.scope_action as GrantScope['action'],
        argsConstraintJson: row.args_constraint_json
          ? (JSON.parse(
              typeof row.args_constraint_json === 'string'
                ? row.args_constraint_json
                : JSON.stringify(row.args_constraint_json),
            ) as ArgsConstraint)
          : undefined,
      }
    : {
        toolPattern: row.scope_tool_pattern!,
        action: row.scope_action as GrantScope['action'],
        argsConstraintJson: row.args_constraint_json
          ? (JSON.parse(
              typeof row.args_constraint_json === 'string'
                ? row.args_constraint_json
                : JSON.stringify(row.args_constraint_json),
            ) as ArgsConstraint)
          : undefined,
      };

  const subject: Grant['subject'] = {};
  if (row.subject_user_id) subject.userId = row.subject_user_id;
  if (row.subject_user_group_id) subject.userGroupId = row.subject_user_group_id;
  if (row.subject_agent_id != null)
    subject.agentId = String(row.subject_agent_id);
  if (row.subject_session_id != null)
    subject.sessionId = String(row.subject_session_id);

  return {
    id: String(row.id),
    tenant: row.tenant,
    form: row.form as GrantForm,
    grantorType: row.grantor_type as Grant['grantorType'],
    grantorUserId: row.grantor_user_id ?? undefined,
    subject,
    scope,
    origin: row.origin as Grant['origin'],
    note: row.note ?? undefined,
    expireTime: row.expire_time ? toEpochMs(row.expire_time) : undefined,
    revokeTime: row.revoke_time ? toEpochMs(row.revoke_time) : undefined,
    revokeUserId: row.revoke_user_id ?? undefined,
    deleted: Number(row.deleted) || 0,
    createTime: toEpochMs(row.create_time),
    updateTime: toEpochMs(row.update_time),
  };
}

function toEpochMs(v: Date | string | number): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  return new Date(v).getTime();
}

interface GrantRow extends RowDataPacket {
  id: bigint | string;
  tenant: number;
  form: string;
  grantor_type: string;
  grantor_user_id: string | null;
  subject_user_id: string | null;
  subject_user_group_id: string | null;
  subject_agent_id: bigint | null;
  subject_session_id: bigint | null;
  scope_tool_name: string | null;
  scope_tool_pattern: string | null;
  scope_action: string;
  args_constraint_json: unknown;
  expire_time: Date | null;
  revoke_time: Date | null;
  revoke_user_id: string | null;
  origin: string;
  note: string | null;
  deleted: bigint | number;
  create_time: Date;
  update_time: Date;
}

export class MysqlGrantRepository implements IGrantRepository {
  constructor(private readonly pool: Pool) {}

  async findById(tenant: number, id: string): Promise<Grant | null> {
    const [rows] = await this.pool.query<GrantRow[]>(
      `SELECT * FROM grants WHERE tenant = ? AND id = ? AND deleted = 0 LIMIT 1`,
      [tenant, id],
    );
    const row = rows[0];
    return row ? rowToGrant(row) : null;
  }

  async findBySfid(id: string): Promise<Grant | null> {
    const [rows] = await this.pool.query<GrantRow[]>(
      `SELECT * FROM grants WHERE id = ? AND deleted = 0 LIMIT 1`,
      [id],
    );
    const row = rows[0];
    return row ? rowToGrant(row) : null;
  }

  async findUserGrants(tenant: number, userId: string): Promise<Grant[]> {
    const [rows] = await this.pool.query<GrantRow[]>(
      `SELECT * FROM grants
       WHERE tenant = ? AND subject_user_id = ? AND deleted = 0
         AND form IN ('G_B','G_D')
       ORDER BY create_time DESC`,
      [tenant, userId],
    );
    return rows.map(rowToGrant);
  }

  async findAdminGrants(tenant: number): Promise<Grant[]> {
    const [rows] = await this.pool.query<GrantRow[]>(
      `SELECT * FROM grants
       WHERE tenant = ? AND form = 'G_A' AND deleted = 0
       ORDER BY create_time DESC`,
      [tenant],
    );
    return rows.map(rowToGrant);
  }

  async findActiveForUserTool(
    tenant: number,
    userId: string,
    toolName: string,
  ): Promise<Grant | null> {
    const [rows] = await this.pool.query<GrantRow[]>(
      `SELECT * FROM grants
       WHERE tenant = ? AND subject_user_id = ? AND deleted = 0
         AND form IN ('G_B','G_D')
         AND (scope_tool_name = ? OR scope_tool_pattern IS NOT NULL)
       ORDER BY create_time DESC`,
      [tenant, userId, toolName],
    );
    for (const row of rows) {
      const g = rowToGrant(row);
      if (matchesToolName(g.scope, toolName)) return g;
    }
    return null;
  }

  async insertGrant(g: GrantInsert): Promise<void> {
    const toolName = g.scope.toolName ?? null;
    const toolPattern = g.scope.toolPattern ?? null;
    await this.pool.query(
      `INSERT INTO grants (
        id, tenant, form, grantor_type, grantor_user_id,
        subject_user_id, subject_user_group_id, subject_agent_id, subject_session_id,
        scope_tool_name, scope_tool_pattern, scope_action, args_constraint_json,
        expire_time, revoke_time, revoke_user_id, origin, note, deleted,
        create_by, creator_id, creator_type, create_time,
        update_by, updater_id, updater_type, update_time
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        g.id,
        g.tenant,
        g.form,
        g.grantorType,
        g.grantorUserId ?? null,
        g.subject.userId ?? null,
        g.subject.userGroupId ?? null,
        g.subject.agentId ?? null,
        g.subject.sessionId ?? null,
        toolName,
        toolPattern,
        g.scope.action,
        g.scope.argsConstraintJson ? JSON.stringify(g.scope.argsConstraintJson) : null,
        g.expireTime ? new Date(g.expireTime) : null,
        g.revokeTime ? new Date(g.revokeTime) : null,
        g.revokeUserId ?? null,
        g.origin,
        g.note ?? null,
        g.deleted,
        g.createBy,
        g.createBy,
        'SERVICE',
        new Date(g.createTime),
        g.updateBy,
        g.updateBy,
        'SERVICE',
        new Date(g.updateTime),
      ],
    );
  }

  async updateExpire(grantId: string, tenant: number, expireTimeMs: number): Promise<void> {
    const now = new Date();
    await this.pool.query(
      `UPDATE grants SET expire_time = ?, update_time = ?, update_by = ?
       WHERE id = ? AND tenant = ? AND deleted = 0`,
      [new Date(expireTimeMs), now, 'grant-expire', grantId, tenant],
    );
  }

  async softRevoke(grantId: string, tenant: number, revokeUserId: string): Promise<void> {
    const nowMs = Date.now();
    const now = new Date();
    await this.pool.query(
      `UPDATE grants SET deleted = ?, revoke_time = ?, revoke_user_id = ?, update_time = ?, update_by = ?
       WHERE id = ? AND tenant = ?`,
      [nowMs, now, revokeUserId, now, revokeUserId, grantId, tenant],
    );
  }
}

function matchesToolName(scope: GrantScope, toolName: string): boolean {
  if (scope.toolName) return scope.toolName === toolName;
  if (scope.toolPattern) {
    const prefix = scope.toolPattern.replace(/\.\*$/, '.');
    return toolName.startsWith(prefix);
  }
  return false;
}

/**
 * Used when MySQL is not configured — gateway still runs; grants lists are empty.
 */
export class EmptyGrantRepository implements IGrantRepository {
  async findById(): Promise<Grant | null> {
    return null;
  }
  async findBySfid(): Promise<Grant | null> {
    return null;
  }
  async findUserGrants(): Promise<Grant[]> {
    return [];
  }
  async findAdminGrants(): Promise<Grant[]> {
    return [];
  }
  async findActiveForUserTool(): Promise<Grant | null> {
    return null;
  }
  async insertGrant(): Promise<void> {}
  async updateExpire(): Promise<void> {}
  async softRevoke(): Promise<void> {}
}
