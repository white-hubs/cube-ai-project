import { describe, test, expect } from 'bun:test';
import { SessionRowSchema, SessionRowStatusSchema } from './session';

/**
 * Unit tests for SessionRowSchema.
 * Ref: docs/technical-design/phase-1/P1-03-data-outbox.md §7
 *      docs/detailed-design/02-data/mysql-tables.md §6.2
 */

const BASE_AUDIT = {
  createBy:    'system',
  creatorId:   null,
  creatorType: null,
  createTime:  Date.now(),
  updateBy:    'system',
  updaterId:   null,
  updaterType: null,
  updateTime:  Date.now(),
  tenant:      1001,
  deleted:     0,
};

const VALID_SESSION = {
  ...BASE_AUDIT,
  id:                         '1234567890123456789',
  userId:                     'u_abc123',
  agentId:                    '9876543210987654321',
  agentVersionNo:              3,
  purpose:                    'chat' as const,
  agentSnapshotJson:          { schema: 'agent-snapshot-v1', agent: {}, frozenTime: Date.now() },
  userPrincipalSnapshotJson:  { schema: 'user-principal-v1', tenant: 1001, userId: 'u_abc123' },
  title:                      'Test session',
  status:                     'ACTIVE' as const,
  lastTurnId:                 null,
  lastActiveTime:             Date.now(),
  contextJson:                null,
};

describe('SessionRowSchema', () => {
  test('parses a valid session row', () => {
    expect(SessionRowSchema.safeParse(VALID_SESSION).success).toBe(true);
  });

  test('all required fields must be present', () => {
    // missing id
    const { id: _id, ...noId } = VALID_SESSION;
    expect(SessionRowSchema.safeParse(noId).success).toBe(false);

    // missing userId
    const { userId: _uid, ...noUserId } = VALID_SESSION;
    expect(SessionRowSchema.safeParse(noUserId).success).toBe(false);

    // missing agentSnapshotJson
    const { agentSnapshotJson: _snap, ...noSnap } = VALID_SESSION;
    expect(SessionRowSchema.safeParse(noSnap).success).toBe(false);
  });

  test('status enum has ACTIVE/CLOSED/ARCHIVED', () => {
    expect(SessionRowStatusSchema.options).toEqual(
      expect.arrayContaining(['ACTIVE', 'CLOSED', 'ARCHIVED']),
    );
    expect(SessionRowSchema.safeParse({ ...VALID_SESSION, status: 'ACTIVE' }).success).toBe(true);
    expect(SessionRowSchema.safeParse({ ...VALID_SESSION, status: 'CLOSED' }).success).toBe(true);
    expect(SessionRowSchema.safeParse({ ...VALID_SESSION, status: 'ARCHIVED' }).success).toBe(true);
    expect(SessionRowSchema.safeParse({ ...VALID_SESSION, status: 'active' }).success).toBe(false);
    expect(SessionRowSchema.safeParse({ ...VALID_SESSION, status: 'RUNNING' }).success).toBe(false);
  });

  test('agentVersionNo allows 0 draft sentinel', () => {
    expect(SessionRowSchema.safeParse({ ...VALID_SESSION, agentVersionNo: 0 }).success).toBe(true);
    expect(SessionRowSchema.safeParse({ ...VALID_SESSION, agentVersionNo: -1 }).success).toBe(false);
    expect(SessionRowSchema.safeParse({ ...VALID_SESSION, agentVersionNo: 1 }).success).toBe(true);
  });

  test('agentId accepts tenant agt_ ref', () => {
    expect(SessionRowSchema.safeParse({ ...VALID_SESSION, agentId: 'agt_1234567890123456789' }).success).toBe(true);
  });

  test('id must be SFID decimal strings', () => {
    expect(SessionRowSchema.safeParse({ ...VALID_SESSION, id: 'ses_abc' }).success).toBe(false);
    expect(SessionRowSchema.safeParse({ ...VALID_SESSION, agentId: 'skl_xyz' }).success).toBe(false);
  });

  test('lastTurnId is nullable', () => {
    expect(SessionRowSchema.safeParse({ ...VALID_SESSION, lastTurnId: null }).success).toBe(true);
    expect(SessionRowSchema.safeParse({ ...VALID_SESSION, lastTurnId: '7777777777777777777' }).success).toBe(true);
  });
});
