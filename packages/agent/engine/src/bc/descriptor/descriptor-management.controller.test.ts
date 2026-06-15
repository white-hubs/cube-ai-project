import 'reflect-metadata';
import { describe, test, expect, mock } from 'bun:test';
import type { Context } from '@dangao/bun-server';
import { contextStore } from '@dangao/bun-server';
import { DescriptorManagementController } from './descriptor-management.controller';
import type { DescriptorManagementService } from './descriptor-management.service';

function baseCtx(
  extra: {
    body?: unknown;
    text?: string;
    params?: Record<string, string>;
    tenant?: number;
    userId?: string;
    noSubject?: boolean;
  } = {},
): Context & { setStatus: ReturnType<typeof mock> } {
  const setStatus = mock(() => {});
  const params = extra.params ?? {};
  return {
    setStatus,
    params,
    request: { text: mock(async () => extra.text ?? '') } as unknown as Request,
    getBody: mock(async () => extra.body ?? {}),
    getParam: mock((k: string) => params[k]),
    state: extra.noSubject
      ? {}
      : {
          subject: {
            tenant: extra.tenant ?? 42,
            user: { userId: extra.userId ?? 'u-1', tenant: extra.tenant ?? 42, displayName: 'U' },
            traceId: 't',
            terminal: 'web',
          },
        },
  } as unknown as Context & { setStatus: ReturnType<typeof mock> };
}

function mockService(over: Partial<DescriptorManagementService> = {}): DescriptorManagementService {
  return {
    create: mock(async () => ({ id: 'agt_1', kind: 'agent', name: 'n' })),
    update: mock(async () => ({ id: 'agt_1', kind: 'agent', name: 'n' })),
    list: mock(async () => [{ id: 'agt_1' }, { id: 'agt_2' }]),
    get: mock(async () => ({ id: 'agt_1' })),
    publish: mock(async () => ({ id: 'agt_1', status: 'published' })),
    remove: mock(async () => undefined),
    fromDocument: mock(async () => ({
      id: 'skl_9',
      name: 'review',
      action: 'created',
      headVersionNo: 1,
      status: 'draft',
    })),
    proposeStream: mock((_t: number, _k: string, _r: unknown) =>
      (async function* () {
        yield { type: 'delta', delta: 'You are a concise ' };
        yield { type: 'delta', delta: 'helpful agent.' };
        yield {
          type: 'proposal',
          result: {
            content: { prompt: 'You are a concise helpful agent.', skillRefs: ['web-search'] },
            suggestions: [{ kind: 'skill', ref: 'web-search', rationale: 'lookup' }],
            valid: true,
          },
        };
      })(),
    ),
    ...over,
  } as unknown as DescriptorManagementService;
}

/** Parse a text/event-stream body into ordered { event, data } records. */
function parseSse(text: string): Array<{ event: string; data: unknown }> {
  const out: Array<{ event: string; data: unknown }> = [];
  for (const block of text.split('\n\n')) {
    const lines = block.split('\n');
    let event = 'message';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice(7);
      else if (line.startsWith('data: ')) data += line.slice(6);
    }
    if (data) out.push({ event, data: JSON.parse(data) });
  }
  return out;
}

const run = <T>(ctx: Context, fn: () => Promise<T>) => contextStore.run(ctx, fn);

describe('DescriptorManagementController — REST wiring', () => {
  test('POST /agent/agents → service.create(tenant, "agent", body, actor)', async () => {
    const svc = mockService();
    const ctl = new DescriptorManagementController(svc);
    const ctx = baseCtx({ tenant: 7, userId: 'alice', body: { name: 'support', content: { prompt: 'hi' } } });
    const res = await run(ctx, () => ctl.createAgent());
    expect(svc.create).toHaveBeenCalledWith(7, 'agent', { name: 'support', content: { prompt: 'hi' } }, 'alice');
    expect((res as { id: string }).id).toBe('agt_1');
  });

  test('GET /agent/skills → { items } from service.list(tenant, "skill")', async () => {
    const svc = mockService();
    const ctl = new DescriptorManagementController(svc);
    const ctx = baseCtx({ tenant: 9 });
    const res = await run(ctx, () => ctl.listSkills());
    expect(svc.list).toHaveBeenCalledWith(9, 'skill');
    expect(res).toEqual({ items: [{ id: 'agt_1' }, { id: 'agt_2' }] });
  });

  test('GET /agent/rules/:id → service.get(tenant, id)', async () => {
    const svc = mockService();
    const ctl = new DescriptorManagementController(svc);
    const ctx = baseCtx({ params: { id: 'rul_55' } });
    await run(ctx, () => ctl.getRule());
    expect(svc.get).toHaveBeenCalledWith(42, 'rul_55');
  });

  test('PATCH /agent/agents/:id unwraps {content} envelope', async () => {
    const svc = mockService();
    const ctl = new DescriptorManagementController(svc);
    const ctx = baseCtx({ params: { id: 'agt_3' }, body: { content: { prompt: 'v2' } } });
    await run(ctx, () => ctl.updateAgent());
    expect(svc.update).toHaveBeenCalledWith(42, 'agent', 'agt_3', { prompt: 'v2' }, 'u-1');
  });

  test('PATCH passes raw body as content when no envelope', async () => {
    const svc = mockService();
    const ctl = new DescriptorManagementController(svc);
    const ctx = baseCtx({ params: { id: 'rul_3' }, body: { content: 'rule text' } });
    await run(ctx, () => ctl.updateRule());
    // body has `content` key → unwrapped
    expect(svc.update).toHaveBeenCalledWith(42, 'rule', 'rul_3', 'rule text', 'u-1');
  });

  test('DELETE /agent/skills/:id → soft delete + 204', async () => {
    const svc = mockService();
    const ctl = new DescriptorManagementController(svc);
    const ctx = baseCtx({ params: { id: 'skl_1' } });
    const res = await run(ctx, () => ctl.deleteSkill());
    expect(svc.remove).toHaveBeenCalledWith(42, 'skl_1', 'u-1');
    expect(ctx.setStatus).toHaveBeenCalledWith(204);
    expect(res).toBeUndefined();
  });

  test('POST /agent/agents/:id/publish → service.publish', async () => {
    const svc = mockService();
    const ctl = new DescriptorManagementController(svc);
    const ctx = baseCtx({ params: { id: 'agt_1' } });
    const res = await run(ctx, () => ctl.publishAgent());
    expect(svc.publish).toHaveBeenCalledWith(42, 'agt_1', 'u-1');
    expect((res as { status: string }).status).toBe('published');
  });

  test('POST /agent/skills:fromDocument reads text/plain body → service.fromDocument', async () => {
    const svc = mockService();
    const ctl = new DescriptorManagementController(svc);
    const raw = '---\nname: review\n---\nDo the thing.';
    const ctx = baseCtx({ text: raw });
    const res = await run(ctx, () => ctl.skillFromDocument());
    expect(svc.fromDocument).toHaveBeenCalledWith(42, 'skill', raw, 'u-1');
    expect((res as { action: string }).action).toBe('created');
  });

  test('fromDocument with empty body throws (422-class validation error)', async () => {
    const svc = mockService();
    const ctl = new DescriptorManagementController(svc);
    const ctx = baseCtx({ text: '   ' });
    await expect(run(ctx, () => ctl.ruleFromDocument())).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT_DESCRIPTOR_DOCUMENT',
    });
    expect(svc.fromDocument).not.toHaveBeenCalled();
  });

  test('POST /agent/agents:propose streams prose deltas then a terminal proposal event', async () => {
    const svc = mockService();
    const ctl = new DescriptorManagementController(svc);
    const ctx = baseCtx({ tenant: 7, userId: 'alice', body: { intent: 'a concise agent' } });
    const res = (await run(ctx, () => ctl.agentPropose())) as Response;

    expect(svc.proposeStream).toHaveBeenCalledWith(7, 'agent', { intent: 'a concise agent' });
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const events = parseSse(await res.text());
    const deltas = events.filter((e) => e.event === 'delta');
    const terminals = events.filter((e) => e.event === 'proposal');
    expect(deltas.length).toBeGreaterThan(0);
    // prose deltas reconstruct the generated prompt
    const prose = deltas.map((d) => (d.data as { delta: string }).delta).join('');
    expect(prose).toBe('You are a concise helpful agent.');
    // exactly one terminal proposal carrying the full envelope
    expect(terminals.length).toBe(1);
    expect((terminals[0].data as { valid: boolean }).valid).toBe(true);
    expect((terminals[0].data as { suggestions: unknown[] }).suggestions).toEqual([
      { kind: 'skill', ref: 'web-search', rationale: 'lookup' },
    ]);
    // proposal must be the last event
    expect(events[events.length - 1].event).toBe('proposal');
  });

  test('missing subject → UNAUTHENTICATED', async () => {
    const svc = mockService();
    const ctl = new DescriptorManagementController(svc);
    const ctx = baseCtx({ noSubject: true });
    await expect(run(ctx, () => ctl.listAgents())).rejects.toMatchObject({
      code: 'UNAUTHENTICATED_TOKEN_INVALID',
    });
  });
});
