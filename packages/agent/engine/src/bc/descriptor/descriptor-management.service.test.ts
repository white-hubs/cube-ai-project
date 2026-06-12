import { describe, test, expect, mock } from 'bun:test';
import { DescriptorManagementService } from './descriptor-management.service';
import type {
  TenantDescriptorRepository,
  UpsertDescriptorResult,
} from './tenant-descriptor.repository';
import type { TenantDescriptorView } from '@cube-ai/contracts';

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
