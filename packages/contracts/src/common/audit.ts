import { z } from 'zod';
import { EpochMsSchema } from './time';
import { TenantSchema } from './ids';

/**
 * Standard 10 audit fields required on every business entity table.
 *
 * Field mapping (camelCase app layer ↔ snake_case DB):
 *   tenant        INT(10)      NOT NULL  — 租户
 *   deleted       BIGINT(20)   NOT NULL  — 0=未删除, 非0=删除时间戳(ms)
 *   create_by     VARCHAR(64)  NOT NULL  — 创建者显示名
 *   creator_id    VARCHAR(64)  NULL      — 创建者主体 ID
 *   creator_type  VARCHAR(16)  NULL      — USER/SERVICE/SYSTEM
 *   create_time   DATETIME(3)  NOT NULL  — 创建时间
 *   update_by     VARCHAR(64)  NOT NULL  — 更新者显示名
 *   updater_id    VARCHAR(64)  NULL      — 更新者主体 ID
 *   updater_type  VARCHAR(16)  NULL      — USER/SERVICE/SYSTEM
 *   update_time   DATETIME(3)  NOT NULL  — 更新时间
 *
 * ref: docs/detailed-design/00-foundations/naming-and-db-conventions.md §6.3
 *      docs/detailed-design/02-data/mysql-tables.md §2
 *      docs/technical-design/phase-1/P1-01-foundations.md §5
 */

/**
 * Actor type (USER / SERVICE / SYSTEM). Used for `creatorType` and
 * `updaterType` audit columns. Each column itself is nullable in the
 * DB schema, so callers should wrap with `.nullable()` at the field
 * level (see `AuditFieldsSchema` below).
 */
export const ActorTypeSchema = z.enum(['USER', 'SERVICE', 'SYSTEM']);
export type ActorType = z.infer<typeof ActorTypeSchema>;

/** Backwards-compatible alias used by P1-01 foundations. */
export const CreatorTypeSchema = ActorTypeSchema.nullable();
export type CreatorType = z.infer<typeof CreatorTypeSchema>;

export const AuditFieldsSchema = z.object({
  tenant:      TenantSchema,
  deleted:     z.union([z.bigint().nonnegative(), z.number().int().nonnegative()]),
  createBy:    z.string().max(64),
  creatorId:   z.string().max(64).nullable(),
  creatorType: ActorTypeSchema.nullable(),
  createTime:  EpochMsSchema,
  updateBy:    z.string().max(64),
  updaterId:   z.string().max(64).nullable(),
  updaterType: ActorTypeSchema.nullable(),
  updateTime:  EpochMsSchema,
});

export type AuditFields = z.infer<typeof AuditFieldsSchema>;

/**
 * Helper to build default audit fields for system-generated records
 * (e.g. usage_events, outbox_events, jobs). Sets actor to `'system'` /
 * SYSTEM and `createTime === updateTime === now`.
 *
 * ref: naming-and-db-conventions.md Appendix F
 */
export function systemAuditFields(tenant: number, now: number = Date.now()): AuditFields {
  return {
    tenant,
    deleted:     0,
    createBy:    'system',
    creatorId:   null,
    creatorType: 'SYSTEM',
    createTime:  now,
    updateBy:    'system',
    updaterId:   null,
    updaterType: 'SYSTEM',
    updateTime:  now,
  };
}

/**
 * Factory helper: build default audit field values for a new row when
 * the actor (operator) is known. Caller must provide `tenant` and
 * `actor` (display name + optional id + optional type). On creation
 * `createTime === updateTime === now`; the caller must override
 * `updateTime` whenever the row is later mutated.
 *
 * Used by P1-03 data layer when persisting business rows for which
 * a specific user/service principal is available (e.g. session creation,
 * descriptor publication, grant issuance).
 */
export function defaultAuditFields(
  tenant: number,
  actor: { by: string; id?: string | null; type?: ActorType | null },
  now: number = Date.now(),
): AuditFields {
  return {
    tenant,
    deleted:     0,
    createBy:    actor.by,
    creatorId:   actor.id ?? null,
    creatorType: actor.type ?? null,
    createTime:  now,
    updateBy:    actor.by,
    updaterId:   actor.id ?? null,
    updaterType: actor.type ?? null,
    updateTime:  now,
  };
}
