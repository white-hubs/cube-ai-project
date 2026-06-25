import { z } from 'zod';
import { SfidSchema } from '../common/ids';
import { EpochMsSchema } from '../common/time';
import { AuditFieldsSchema } from '../common/audit';
import { AgentRefSchema, SessionPurposeSchema } from '../session/session';

/**
 * Zod schema for the `sessions` table row.
 *
 * Aligned with:
 *   docs/detailed-design/02-data/mysql-tables.md §6.2 (sessions DDL)
 *
 * DDL excerpt:
 *   CREATE TABLE sessions (
 *     id                           BIGINT(20)   NOT NULL,
 *     tenant                       INT(10)      NOT NULL,
 *     user_id                      VARCHAR(64)  NOT NULL,
 *     agent_id                     BIGINT(20)   NOT NULL,
 *     agent_version_no             INT          NOT NULL,
 *     agent_snapshot_json          JSON         NOT NULL,
 *     user_principal_snapshot_json JSON         NOT NULL,
 *     title                        VARCHAR(255) NULL,
 *     status                       VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE',
 *     last_turn_id                 BIGINT(20)   NULL,
 *     last_active_time             DATETIME(3)  NOT NULL,
 *     context_json                 JSON         NULL,
 *     deleted                      BIGINT(20)   NOT NULL DEFAULT 0,
 *     -- + 10 audit fields
 *   )
 */
/**
 * Session row status (DB column status VARCHAR(32)).
 * Named SessionRowStatus to avoid conflict with contracts/session SessionStatus (API DTO).
 */
export const SessionRowStatusSchema = z.enum(['ACTIVE', 'CLOSED', 'ARCHIVED']);
export type SessionRowStatus = z.infer<typeof SessionRowStatusSchema>;

export const SessionRowSchema = AuditFieldsSchema.extend({
  id:                         SfidSchema,
  userId:                     z.string().max(64),
  agentId:                    AgentRefSchema,
  /** 0 = 草稿 head 哨兵；正整数 = 已发布版本号 */
  agentVersionNo:             z.number().int().nonnegative(),
  purpose:                    SessionPurposeSchema.default('chat'),
  /**
   * JSON-inline agent snapshot (Q2:b; ADR-0012).
   * Internal camelCase keys — see mysql-tables.md §6.4.
   * Validated at application layer by a dedicated AgentSnapshotSchema (Phase 2).
   */
  agentSnapshotJson:          z.record(z.string(), z.unknown()),
  /**
   * UserPrincipal snapshot — see mysql-tables.md §6.5.
   * MUST NOT contain access_token / refresh_token / credentials.
   */
  userPrincipalSnapshotJson:  z.record(z.string(), z.unknown()),
  title:                      z.string().max(255).nullable(),
  status:                     SessionRowStatusSchema,
  lastTurnId:                 SfidSchema.nullable(),
  lastActiveTime:             EpochMsSchema,
  contextJson:                z.unknown().nullable(),
});

export type SessionRow = z.infer<typeof SessionRowSchema>;

/** Input type for creating a new session row (id / audit fields generated server-side). */
export type CreateSessionInput = Omit<
  SessionRow,
  'id' | 'createBy' | 'creatorId' | 'creatorType' | 'createTime'
  | 'updateBy' | 'updaterId' | 'updaterType' | 'updateTime'
  | 'deleted'
>;
