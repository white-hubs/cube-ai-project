import { describe, test, expect, mock } from 'bun:test';
import type { Pool, PoolConnection } from 'mysql2/promise';
import type { SessionRepository } from './repository/session.repository';
import type { AppendOutboxInput } from '@cube-ai/contracts';
import type { OutboxWriter } from '@cube-ai/bun-server-ext-outbox';
import { SessionService } from './session.service';
import { SfidService } from '../../infra/sfid/sfid.service';
import type { SkillDescriptor } from '@tachu/core';

function fakeRow(id: string) {
  const now = Date.now();
  return {
    id,
    tenant: 1,
    userId: 'u1',
    agentId: '28147497671065600001',
    agentVersionNo: 1,
    agentSnapshotJson: {},
    userPrincipalSnapshotJson: {},
    title: null as string | null,
    status: 'ACTIVE' as const,
    lastTurnId: null as string | null,
    lastActiveTime: now,
    contextJson: null,
    deleted: 0,
    createBy: 'u1',
    creatorId: 'u1',
    creatorType: 'USER' as const,
    createTime: now,
    updateBy: 'u1',
    updaterId: 'u1',
    updaterType: 'USER' as const,
    updateTime: now,
  };
}

describe('SessionService — business flows', () => {
  test('createSession writes DB + outbox inside one transaction', async () => {
    const appended: AppendOutboxInput[] = [];
    let capturedConn: PoolConnection | undefined;

    const sfid = new SfidService();
    const repo: SessionRepository = {
      findById: mock(async () => null),
      insertWithConnection: mock(async (_c, tenant, sid, _input) => fakeRow(sid)),
      updateStatus: mock(async () => {}),
      updatePartial: mock(async () => {}),
      updatePartialWithConnection: mock(async () => {}),
      touchActivity: mock(async () => {}),
      softDelete: mock(async () => {}),
      softDeleteWithConnection: mock(async () => {}),
      listByOwner: mock(async () => ({ items: [], hasMore: false })),
    };

    const pool: Pool = {
      getConnection: mock(async () => {
        const conn = {
          beginTransaction: mock(async () => {}),
          commit: mock(async () => {}),
          rollback: mock(async () => {}),
          release: mock(() => {}),
        } as unknown as PoolConnection;
        capturedConn = conn;
        return conn;
      }),
    } as unknown as Pool;

    const outbox: OutboxWriter = {
      append: mock(async (_tx: unknown, row: AppendOutboxInput) => {
        appended.push(row);
      }),
    };

    const svc = new SessionService(sfid, repo, pool, outbox);

    const view = await svc.createSession(1, 'u1', 'U', {
      agentId: '28147497671065600001',
    });

    expect(view.id).toMatch(/^\d{19}$/);
    expect(appended.length).toBe(1);
    expect(appended[0]?.eventType).toBe('session.created');
    expect(appended[0]?.channel).toBe('session_lifecycle');
    expect(capturedConn).toBeDefined();
  });

  test('createSession builds snapshot prompt from global + agent + sessionSuffix', async () => {
    let capturedInput: unknown;
    const sfid = new SfidService();
    const repo: SessionRepository = {
      findById: mock(async () => null),
      insertWithConnection: mock(async (_c, _tenant, sid, input) => {
        capturedInput = input;
        return fakeRow(sid);
      }),
      updateStatus: mock(async () => {}),
      updatePartial: mock(async () => {}),
      updatePartialWithConnection: mock(async () => {}),
      touchActivity: mock(async () => {}),
      softDelete: mock(async () => {}),
      softDeleteWithConnection: mock(async () => {}),
      listByOwner: mock(async () => ({ items: [], hasMore: false })),
    };
    const pool: Pool = {
      getConnection: mock(async () =>
        ({
          beginTransaction: mock(async () => {}),
          commit: mock(async () => {}),
          rollback: mock(async () => {}),
          release: mock(() => {}),
        }) as unknown as PoolConnection,
      ),
    } as unknown as Pool;
    const outbox: OutboxWriter = { append: mock(async () => {}) };
    const defaultReasoningSkill: SkillDescriptor = {
      kind: 'skill',
      name: 'default-reasoning',
      description: 'Default reasoning',
      instructions: 'Be concise.',
      trigger: { type: 'semantic' },
    };
    const descriptorLoader = {
      getGlobalPrompt: () => 'GLOBAL',
      getAgent: mock(async () => ({
        kind: 'agent',
        name: '28147497671065600001',
        instructions: 'AGENT',
        availableTools: ['platform.flow.invoke', 'platform.knowledge.query'],
        ruleRefs: ['safety-baseline'],
        skillRefs: ['default-reasoning'],
        subAgentRefs: ['cube-researcher'],
        maxDepth: 4,
      })),
    };
    const skillRegistry = {
      resolve: (name: string) =>
        name === 'default-reasoning' ? defaultReasoningSkill : undefined,
    };

    const svc = new SessionService(
      sfid,
      repo,
      pool,
      outbox,
      descriptorLoader as never,
      skillRegistry,
    );

    await svc.createSession(1, 'u1', 'U', {
      agentId: '28147497671065600001',
      context: {
        systemSuffix: 'SESSION',
      },
    });

    const input = capturedInput as {
      agentSnapshotJson?: {
        agent?: {
          content?: {
            prompt?: string;
            toolRefs?: string[];
            ruleRefs?: string[];
            skillRefs?: string[];
            subAgentRefs?: string[];
            maxDepth?: number;
          };
        };
        skills?: Array<{ name: string; content: { instructions?: string } }>;
      };
    };
    // Snapshot prompt = body (global + agent + sessionSuffix) + 一次性冻结的 session-start UTC 块。
    const builtPrompt = input.agentSnapshotJson?.agent?.content?.prompt ?? '';
    expect(builtPrompt.startsWith('GLOBAL\n\nAGENT\n\nSESSION\n\n---\n')).toBe(true);
    expect(builtPrompt).toContain('Session-start time (UTC)');
    expect(builtPrompt).toContain('`currentDate` tool');
    expect(input.agentSnapshotJson?.agent?.content?.toolRefs).toEqual([
      'platform.flow.invoke',
      'platform.knowledge.query',
    ]);
    expect(input.agentSnapshotJson?.agent?.content?.ruleRefs).toEqual(['safety-baseline']);
    expect(input.agentSnapshotJson?.agent?.content?.skillRefs).toEqual(['default-reasoning']);
    expect(input.agentSnapshotJson?.agent?.content?.subAgentRefs).toEqual(['cube-researcher']);
    expect(input.agentSnapshotJson?.agent?.content?.maxDepth).toBe(4);
    expect(input.agentSnapshotJson?.skills?.length).toBe(1);
    expect(input.agentSnapshotJson?.skills?.[0]?.name).toBe('default-reasoning');
    expect(input.agentSnapshotJson?.skills?.[0]?.content.instructions).toContain('concise');
  });

  test('createSession throws when skillRef cannot be resolved', async () => {
    const sfid = new SfidService();
    const repo: SessionRepository = {
      findById: mock(async () => null),
      insertWithConnection: mock(async () => fakeRow('1')),
      updateStatus: mock(async () => {}),
      updatePartial: mock(async () => {}),
      updatePartialWithConnection: mock(async () => {}),
      touchActivity: mock(async () => {}),
      softDelete: mock(async () => {}),
      softDeleteWithConnection: mock(async () => {}),
      listByOwner: mock(async () => ({ items: [], hasMore: false })),
    };
    const pool: Pool = {
      getConnection: mock(async () =>
        ({
          beginTransaction: mock(async () => {}),
          commit: mock(async () => {}),
          rollback: mock(async () => {}),
          release: mock(() => {}),
        }) as unknown as PoolConnection,
      ),
    } as unknown as Pool;
    const outbox: OutboxWriter = { append: mock(async () => {}) };
    const descriptorLoader = {
      getGlobalPrompt: () => '',
      getAgent: mock(async () => ({
        kind: 'agent',
        name: 'a1',
        instructions: '',
        skillRefs: ['missing-skill'],
      })),
    };
    const svc = new SessionService(sfid, repo, pool, outbox, descriptorLoader as never, {
      resolve: () => undefined,
    });

    await expect(
      svc.createSession(1, 'u1', 'U', { agentId: 'a1' }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND_DESCRIPTOR' });
  });

  test('createSession writes modelCode into snapshot modelConfig', async () => {
    let capturedInput: unknown;
    const sfid = new SfidService();
    const repo: SessionRepository = {
      findById: mock(async () => null),
      insertWithConnection: mock(async (_c, _tenant, sid, input) => {
        capturedInput = input;
        return fakeRow(sid);
      }),
      updateStatus: mock(async () => {}),
      updatePartial: mock(async () => {}),
      updatePartialWithConnection: mock(async () => {}),
      touchActivity: mock(async () => {}),
      softDelete: mock(async () => {}),
      softDeleteWithConnection: mock(async () => {}),
      listByOwner: mock(async () => ({ items: [], hasMore: false })),
    };
    const pool: Pool = {
      getConnection: mock(async () =>
        ({
          beginTransaction: mock(async () => {}),
          commit: mock(async () => {}),
          rollback: mock(async () => {}),
          release: mock(() => {}),
        }) as unknown as PoolConnection,
      ),
    } as unknown as Pool;
    const outbox: OutboxWriter = { append: mock(async () => {}) };
    const descriptorLoader = {
      getGlobalPrompt: () => '',
      getAgent: mock(async () => ({
        kind: 'agent',
        name: '28147497671065600001',
        instructions: '',
        availableTools: [],
      })),
    };
    const svc = new SessionService(sfid, repo, pool, outbox, descriptorLoader as never);

    await svc.createSession(1, 'u1', 'U', {
      agentId: '28147497671065600001',
      modelCode: 'gpt-4.1',
    });

    const input = capturedInput as {
      agentSnapshotJson?: {
        agent?: { content?: { modelConfig?: { model?: string } } };
      };
    };
    expect(input.agentSnapshotJson?.agent?.content?.modelConfig?.model).toBe('gpt-4.1');
  });

  test('createSession throws RESOURCE_NOT_FOUND_DESCRIPTOR when agent missing in loader', async () => {
    const sfid = new SfidService();
    const repo: SessionRepository = {
      findById: mock(async () => null),
      insertWithConnection: mock(async (_c, _tenant, sid, _input) => fakeRow(sid)),
      updateStatus: mock(async () => {}),
      updatePartial: mock(async () => {}),
      updatePartialWithConnection: mock(async () => {}),
      touchActivity: mock(async () => {}),
      softDelete: mock(async () => {}),
      softDeleteWithConnection: mock(async () => {}),
      listByOwner: mock(async () => ({ items: [], hasMore: false })),
    };
    const pool: Pool = {
      getConnection: mock(async () =>
        ({
          beginTransaction: mock(async () => {}),
          commit: mock(async () => {}),
          rollback: mock(async () => {}),
          release: mock(() => {}),
        }) as unknown as PoolConnection,
      ),
    } as unknown as Pool;
    const outbox: OutboxWriter = { append: mock(async () => {}) };
    const descriptorLoader = {
      getGlobalPrompt: () => '',
      getAgent: mock(async () => null),
    };
    const svc = new SessionService(sfid, repo, pool, outbox, descriptorLoader as never);

    await expect(
      svc.createSession(1, 'u1', 'U', { agentId: '28147497671065600001' }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND_DESCRIPTOR' });
  });

  test('getSession returns mapped view when repository finds row', async () => {
    const sfid = new SfidService();
    const row = fakeRow('28147497671065600001');
    const repo: SessionRepository = {
      findById: mock(async () => row),
      insertWithConnection: mock(async () => row),
      updateStatus: mock(async () => {}),
      updatePartial: mock(async () => {}),
      updatePartialWithConnection: mock(async () => {}),
      touchActivity: mock(async () => {}),
      softDelete: mock(async () => {}),
      softDeleteWithConnection: mock(async () => {}),
      listByOwner: mock(async () => ({ items: [], hasMore: false })),
    };
    const outbox: OutboxWriter = { append: mock(async () => {}) };
    const svc = new SessionService(sfid, repo, null, outbox);

    const v = await svc.getSession(row.id, 1);
    expect(v?.userId).toBe('u1');
    expect(v?.agentVersionNo).toBe(1);
  });

  test('listSessions maps items and pagination flags', async () => {
    const sfid = new SfidService();
    const r1 = fakeRow('28147497671065600001');
    const repo: SessionRepository = {
      findById: mock(async () => null),
      insertWithConnection: mock(async () => r1),
      updateStatus: mock(async () => {}),
      updatePartial: mock(async () => {}),
      updatePartialWithConnection: mock(async () => {}),
      touchActivity: mock(async () => {}),
      softDelete: mock(async () => {}),
      softDeleteWithConnection: mock(async () => {}),
      listByOwner: mock(async () => ({
        items: [r1],
        hasMore: true,
        nextCursor: 'abc',
      })),
    };
    const outbox: OutboxWriter = { append: mock(async () => {}) };
    const svc = new SessionService(sfid, repo, null, outbox);

    const result = await svc.listSessions({
      tenant: 1,
      userId: 'u1',
      limit: 20,
    });

    expect(result.items.length).toBe(1);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe('abc');
  });

  test('listSessionMessages preserves multimodal attachments in response items', async () => {
    const sfid = new SfidService();
    const row = fakeRow('28147497671065600001');
    const repo: SessionRepository = {
      findById: mock(async () => row),
      insertWithConnection: mock(async () => row),
      updateStatus: mock(async () => {}),
      updatePartial: mock(async () => {}),
      updatePartialWithConnection: mock(async () => {}),
      touchActivity: mock(async () => {}),
      softDelete: mock(async () => {}),
      softDeleteWithConnection: mock(async () => {}),
      listByOwner: mock(async () => ({ items: [], hasMore: false })),
    };
    const attachments = [
      {
        attachmentId: 'att_01',
        kind: 'image',
        fileId: 'file_01',
        mimeType: 'image/png',
        previewUrl: '/v1/files/file_01/preview',
      },
    ];
    const pool: Pool = {
      query: mock(async () => [[{
        id: '28147497671065600011',
        turn_id: '28147497671065600012',
        session_id: row.id,
        seq: 1,
        role: 'user',
        content_json: JSON.stringify({
          schema: 'message-content-v1',
          blocks: [{ type: 'image_ref', attachmentId: 'att_01' }],
        }),
        attachments_json: JSON.stringify(attachments),
        create_time: new Date('2026-05-24T12:00:00Z'),
      }]]),
    } as unknown as Pool;
    const outbox: OutboxWriter = { append: mock(async () => {}) };
    const svc = new SessionService(sfid, repo, pool, outbox);

    const result = await svc.listSessionMessages({
      tenant: 1,
      sessionId: row.id,
      userId: 'u1',
      limit: 20,
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        id: '28147497671065600011',
        role: 'user',
        content: {
          schema: 'message-content-v1',
          blocks: [{ type: 'image_ref', attachmentId: 'att_01' }],
        },
        attachments,
      }),
    ]);
  });

  test('patchSession CLOSED emits session.closed outbox', async () => {
    const sfid = new SfidService();
    const row = fakeRow('28147497671065600001');
    const appended: AppendOutboxInput[] = [];

    const repo: SessionRepository = {
      findById: mock(async () => row),
      insertWithConnection: mock(async () => row),
      updateStatus: mock(async () => {}),
      updatePartial: mock(async () => {}),
      updatePartialWithConnection: mock(async () => {}),
      touchActivity: mock(async () => {}),
      softDelete: mock(async () => {}),
      softDeleteWithConnection: mock(async () => {}),
      listByOwner: mock(async () => ({ items: [], hasMore: false })),
    };

    const pool: Pool = {
      getConnection: mock(async () =>
        ({
          beginTransaction: mock(async () => {}),
          commit: mock(async () => {}),
          rollback: mock(async () => {}),
          release: mock(() => {}),
        }) as unknown as PoolConnection,
      ),
    } as unknown as Pool;

    const outbox: OutboxWriter = {
      append: mock(async (_tx, row) => {
        appended.push(row);
      }),
    };

    const svc = new SessionService(sfid, repo, pool, outbox);

    await svc.patchSession(1, row.id, 'u1', { status: 'CLOSED' });

    expect(appended.some((e) => e.eventType === 'session.closed')).toBe(true);
  });

  test('deleteSession emits session.deleted outbox', async () => {
    const sfid = new SfidService();
    const row = fakeRow('28147497671065600001');
    const appended: AppendOutboxInput[] = [];

    const repo: SessionRepository = {
      findById: mock(async () => row),
      insertWithConnection: mock(async () => row),
      updateStatus: mock(async () => {}),
      updatePartial: mock(async () => {}),
      updatePartialWithConnection: mock(async () => {}),
      touchActivity: mock(async () => {}),
      softDelete: mock(async () => {}),
      softDeleteWithConnection: mock(async () => {}),
      listByOwner: mock(async () => ({ items: [], hasMore: false })),
    };

    const pool: Pool = {
      getConnection: mock(async () =>
        ({
          beginTransaction: mock(async () => {}),
          commit: mock(async () => {}),
          rollback: mock(async () => {}),
          release: mock(() => {}),
        }) as unknown as PoolConnection,
      ),
    } as unknown as Pool;

    const outbox: OutboxWriter = {
      append: mock(async (_tx, row) => {
        appended.push(row);
      }),
    };

    const svc = new SessionService(sfid, repo, pool, outbox);

    await svc.deleteSession(1, row.id, 'u1');

    expect(appended.some((e) => e.eventType === 'session.deleted')).toBe(true);
  });

  test('patchSession ACTIVE from CLOSED rejects when current status is ACTIVE', async () => {
    const sfid = new SfidService();
    const row = fakeRow('28147497671065600001');
    const repo: SessionRepository = {
      findById: mock(async () => row),
      insertWithConnection: mock(async () => row),
      updateStatus: mock(async () => {}),
      updatePartial: mock(async () => {}),
      updatePartialWithConnection: mock(async () => {}),
      touchActivity: mock(async () => {}),
      softDelete: mock(async () => {}),
      softDeleteWithConnection: mock(async () => {}),
      listByOwner: mock(async () => ({ items: [], hasMore: false })),
    };
    const svc = new SessionService(sfid, repo, null, { append: mock(async () => {}) });

    await expect(svc.patchSession(1, row.id, 'u1', { status: 'ACTIVE' })).rejects.toThrow();
  });
});
