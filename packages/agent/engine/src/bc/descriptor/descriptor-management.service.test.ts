import { describe, test, expect, mock } from 'bun:test';
import {
  DescriptorManagementService,
  type ProposeCandidate,
  type ProposeCandidateSource,
} from './descriptor-management.service';
import type {
  TenantDescriptorRepository,
  UpsertDescriptorResult,
} from './tenant-descriptor.repository';
import type { LlmChatResponse, LlmProviderPort, TenantDescriptorView } from '@cube-ai/contracts';

/**
 * 两阶段假 LLM（ADR-0027 §5）：
 *  - phase 1 `chatStream` 把 `prose` 作为 text-delta 流出（真流式）。
 *  - phase 2 `chat` 返回结构化 `{suggestions, meta}` JSON。
 */
function fakeLlm(opts: { prose: string; structured: unknown }): {
  provider: LlmProviderPort;
  chat: ReturnType<typeof mock>;
  chatStream: ReturnType<typeof mock>;
} {
  const chat = mock(
    async (): Promise<LlmChatResponse> => ({
      content: JSON.stringify(opts.structured),
      finishReason: 'stop',
    }),
  );
  const chatStream = mock((_req: unknown) =>
    (async function* () {
      if (opts.prose) yield { type: 'text-delta', delta: opts.prose };
      yield { type: 'finish', finishReason: 'stop' };
    })(),
  );
  const provider = { chat, chatStream, embed: async () => [] } as unknown as LlmProviderPort;
  return { provider, chat, chatStream };
}

function fakeCandidateSource(over: Partial<ProposeCandidateSource> = {}): ProposeCandidateSource {
  return {
    systemSkills: () => [] as ProposeCandidate[],
    systemRules: () => [] as ProposeCandidate[],
    systemTools: () => [] as ProposeCandidate[],
    ...over,
  };
}

function fakeView(over: Partial<TenantDescriptorView> = {}): TenantDescriptorView {
  return {
    id: 'rul_1',
    kind: 'rule',
    name: 'n',
    status: 'draft',
    headVersionNo: 1,
    publishedVersionNo: null,
    content: {},
    createTime: 0,
    updateTime: 0,
    ...over,
  };
}

function fakeRepo(over: Partial<TenantDescriptorRepository> = {}): TenantDescriptorRepository {
  const upsert = mock(
    async (
      _t: number,
      kind: string,
      _n: string,
    ): Promise<UpsertDescriptorResult> => ({
      id: `${kind === 'agent' ? 'agt' : kind === 'skill' ? 'skl' : 'rul'}_1`,
      name: 'n',
      action: 'created',
      headVersionNo: 1,
      status: 'draft',
    }),
  );
  return {
    upsert,
    findById: mock(async () => fakeView()),
    findByName: mock(async () => null),
    list: mock(async () => []),
    publish: mock(async () => fakeView({ status: 'published', publishedVersionNo: 1 })),
    softDelete: mock(async () => undefined),
    resolvePublished: mock(async () => null),
    ...over,
  } as unknown as TenantDescriptorRepository;
}

describe('DescriptorManagementService — validation + lifecycle orchestration', () => {
  test('create rejects missing name', async () => {
    const svc = new DescriptorManagementService(fakeRepo());
    await expect(svc.create(1, 'rule', { content: { content: 'x' } })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT_DESCRIPTOR_NAME',
    });
  });

  test('create rejects content failing kind schema', async () => {
    const svc = new DescriptorManagementService(fakeRepo());
    // agent requires non-empty prompt
    await expect(
      svc.create(1, 'agent', { name: 'a', content: { prompt: '' } }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT_DESCRIPTOR_CONTENT' });
  });

  test('create persists validated content (zod defaults applied) and returns view', async () => {
    const repo = fakeRepo();
    const svc = new DescriptorManagementService(repo);
    const view = await svc.create(7, 'agent', { name: 'support', content: { prompt: 'hello' } }, 'alice');
    expect(view.id).toBe('rul_1'); // findById fake returns rul_1
    const call = (repo.upsert as ReturnType<typeof mock>).mock.calls[0];
    expect(call[0]).toBe(7);
    expect(call[1]).toBe('agent');
    expect(call[2]).toBe('support');
    // zod default arrays present on persisted content
    expect(call[3]).toMatchObject({ prompt: 'hello', ruleRefs: [], skillRefs: [] });
    expect(call[4]).toBe('alice');
  });

  test('update on missing id → RESOURCE_NOT_FOUND_DESCRIPTOR', async () => {
    const repo = fakeRepo({ findById: mock(async () => null) });
    const svc = new DescriptorManagementService(repo);
    await expect(svc.update(1, 'rule', 'rul_x', { content: 'y' })).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND_DESCRIPTOR',
    });
  });

  test('fromDocument parses valid skill doc → upsert with parsed name+content', async () => {
    const repo = fakeRepo();
    const svc = new DescriptorManagementService(repo);
    const doc = '---\nname: review-pr\ndescription: Review a PR\n---\nGo read the diff carefully.';
    const res = await svc.fromDocument(3, 'skill', doc, 'bob');
    expect(res.action).toBe('created');
    const call = (repo.upsert as ReturnType<typeof mock>).mock.calls[0];
    expect(call[1]).toBe('skill');
    expect(call[2]).toBe('review-pr');
    expect(call[3]).toMatchObject({
      description: 'Review a PR',
      instructions: 'Go read the diff carefully.',
    });
  });

  test('fromDocument surfaces updated action from repo', async () => {
    const repo = fakeRepo({
      upsert: mock(async () => ({
        id: 'rul_1',
        name: 'safety',
        action: 'updated' as const,
        headVersionNo: 3,
        status: 'draft' as const,
      })),
    });
    const svc = new DescriptorManagementService(repo);
    const res = await svc.fromDocument(3, 'rule', '---\nname: safety\n---\nNo secrets.', 'bob');
    expect(res.action).toBe('updated');
    expect(res.headVersionNo).toBe(3);
  });

  test('fromDocument with no frontmatter → INVALID_ARGUMENT_DESCRIPTOR_DOCUMENT (not a 500)', async () => {
    const repo = fakeRepo();
    const svc = new DescriptorManagementService(repo);
    await expect(svc.fromDocument(3, 'rule', 'just text, no frontmatter', 'bob')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT_DESCRIPTOR_DOCUMENT',
    });
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  test('publish/remove delegate to repository with actor', async () => {
    const repo = fakeRepo();
    const svc = new DescriptorManagementService(repo);
    await svc.publish(1, 'agt_1', 'alice');
    await svc.remove(1, 'agt_1', 'alice');
    expect(repo.publish).toHaveBeenCalledWith(1, 'agt_1', 'alice');
    expect(repo.softDelete).toHaveBeenCalledWith(1, 'agt_1', 'alice');
  });
});

describe('DescriptorManagementService.propose — ADR-0027 ① pure suggestion (two-phase)', () => {
  test('generate mode returns schema-valid agent content (valid:true) with grounded ref', async () => {
    const repo = fakeRepo();
    const { provider } = fakeLlm({
      prose: 'You are a helpful support agent.',
      structured: {
        suggestions: [{ kind: 'skill', ref: 'web-search', rationale: 'answer questions' }],
        meta: {},
      },
    });
    const candidates = fakeCandidateSource({
      systemSkills: () => [{ kind: 'skill', ref: 'web-search', description: 'Search the web' }],
    });
    const svc = new DescriptorManagementService(repo, provider, candidates);

    const result = await svc.propose(7, 'agent', { intent: 'a support agent that can search' });

    expect(result.valid).toBe(true);
    const content = result.content as { prompt: string; skillRefs: string[] };
    expect(content.prompt).toBe('You are a helpful support agent.');
    expect(content.skillRefs).toEqual(['web-search']);
    expect(result.suggestions).toEqual([
      { kind: 'skill', ref: 'web-search', rationale: 'answer questions' },
    ]);
    // pure / read-only: never persists
    expect(repo.upsert).not.toHaveBeenCalled();
    expect(repo.publish).not.toHaveBeenCalled();
  });

  test('proposeStream emits prose deltas then a terminal proposal envelope', async () => {
    const repo = fakeRepo();
    const { provider } = fakeLlm({
      prose: 'You are a concise agent.',
      structured: { suggestions: [], meta: {} },
    });
    const svc = new DescriptorManagementService(repo, provider, fakeCandidateSource());

    const events: Array<{ type: string }> = [];
    let deltaText = '';
    let proposalResult: { valid: boolean } | undefined;
    for await (const ev of svc.proposeStream(7, 'agent', { intent: 'x' })) {
      events.push(ev);
      if (ev.type === 'delta') deltaText += ev.delta;
      if (ev.type === 'proposal') proposalResult = ev.result;
    }

    expect(events.filter((e) => e.type === 'delta').length).toBeGreaterThan(0);
    expect(events[events.length - 1]!.type).toBe('proposal');
    expect(deltaText).toBe('You are a concise agent.');
    expect(proposalResult?.valid).toBe(true);
  });

  test('hallucinated refs are dropped from both content and suggestions', async () => {
    const repo = fakeRepo();
    const { provider } = fakeLlm({
      prose: 'agent',
      structured: {
        suggestions: [
          { kind: 'skill', ref: 'web-search', rationale: 'ok' },
          { kind: 'skill', ref: 'made-up-skill', rationale: 'hallucinated' },
          { kind: 'tool', ref: 'ghost-tool', rationale: 'hallucinated' },
        ],
        meta: {},
      },
    });
    const candidates = fakeCandidateSource({
      systemSkills: () => [{ kind: 'skill', ref: 'web-search' }],
    });
    const svc = new DescriptorManagementService(repo, provider, candidates);

    const result = await svc.propose(7, 'agent', { intent: 'x' });

    const content = result.content as { skillRefs: string[]; availableTools: string[] };
    expect(content.skillRefs).toEqual(['web-search']);
    expect(content.availableTools).toEqual([]);
    expect(result.suggestions.map((s) => s.ref)).toEqual(['web-search']);
    expect(JSON.stringify(result)).not.toContain('made-up-skill');
    expect(JSON.stringify(result)).not.toContain('ghost-tool');
  });

  test('optimize mode streams the base prose to phase-1 and preserves identity via meta', async () => {
    const repo = fakeRepo();
    const base = { prompt: 'old prompt', displayName: 'Support', skillRefs: [] };
    const { provider, chatStream } = fakeLlm({
      prose: 'new improved prompt',
      structured: { suggestions: [], meta: { displayName: 'Support' } },
    });
    const svc = new DescriptorManagementService(repo, provider, fakeCandidateSource());

    const result = await svc.propose(7, 'agent', { base, focus: 'be more concise' });

    expect(result.valid).toBe(true);
    const content = result.content as { prompt: string; displayName: string };
    expect(content.displayName).toBe('Support');
    expect(content.prompt).toBe('new improved prompt');
    // base prose was fed into phase-1 (optimize mode)
    const messages = chatStream.mock.calls[0][0].messages as Array<{ content: string }>;
    expect(JSON.stringify(messages)).toContain('old prompt');
  });

  test('invalid generated content → valid:false + issues, no throw, no persist', async () => {
    const repo = fakeRepo();
    // empty prose → agent prompt is empty → invalid
    const { provider } = fakeLlm({ prose: '', structured: { suggestions: [], meta: {} } });
    const svc = new DescriptorManagementService(repo, provider, fakeCandidateSource());

    const result = await svc.propose(7, 'agent', { intent: 'broken' });

    expect(result.valid).toBe(false);
    expect(result.issues && result.issues.length).toBeGreaterThan(0);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  test('only published tenant descriptors become candidates', async () => {
    const repo = fakeRepo({
      list: mock(async (_t: number, kind: string) => {
        if (kind === 'skill') {
          return [
            fakeView({ id: 'skl_pub', kind: 'skill', name: 'pub', status: 'published', publishedVersionNo: 1, content: { description: 'published skill' } }),
            fakeView({ id: 'skl_draft', kind: 'skill', name: 'draft', status: 'draft', content: { description: 'draft skill' } }),
          ];
        }
        return [];
      }),
    });
    const { provider } = fakeLlm({
      prose: 'p',
      structured: {
        suggestions: [
          { kind: 'skill', ref: 'skl_pub', rationale: 'ok' },
          { kind: 'skill', ref: 'skl_draft', rationale: 'should drop (draft)' },
        ],
        meta: {},
      },
    });
    const svc = new DescriptorManagementService(repo, provider, fakeCandidateSource());

    const result = await svc.propose(7, 'agent', { intent: 'x' });

    const content = result.content as { skillRefs: string[] };
    expect(content.skillRefs).toEqual(['skl_pub']);
    expect(result.suggestions.map((s) => s.ref)).toEqual(['skl_pub']);
  });
});
