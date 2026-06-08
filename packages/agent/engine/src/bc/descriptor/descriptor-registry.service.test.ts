/**
 * DescriptorRegistry 单测。
 *
 * 对齐：
 *   docs/technical-design/prompts/phase-1/P1-08-tools.md §7
 *   registration-lifecycle.md §2.2 / §4.2
 *   ADR-0007 D1（版本单调）
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { DescriptorRegistryService } from './descriptor-registry.service';
import type { ToolDescriptor } from '@cube-ai/contracts';
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import type { ToolEffectiveVersionSource } from './tool-effective-version.provider';

const noopPin: ToolEffectiveVersionSource = {
  refreshFromNacos: async () => {},
  getPinnedVersion: async () => undefined,
};

// ---------------------------------------------------------------------------
// 辅助：最小合法 descriptor
// ---------------------------------------------------------------------------

function makeDescriptor(override: Partial<ToolDescriptor> = {}): ToolDescriptor {
  return {
    schemaVersion:  1,
    kind:           'TOOL',
    name:           'platform.file.read',
    displayName:    '读取文件',
    isPreset:       true,
    version:        '1.0.0',
    meta: {
      execution:          'LOCAL',
      consent:            'ON_FIRST_USE',
      requiresPrincipal:  'USER',
      timeoutMs:          15000,
      idempotent:         true,
      sideEffects:        ['read:platform.file'],
    },
    inputSchema: {
      type:       'object',
      properties: { fileId: { type: 'string' } },
    },
    outputSchema: {
      type:       'object',
      properties: { content: { type: 'string' } },
    },
    requires: {
      principal:  'USER',
      oauthScope: ['file.read'],
      obo:        { audience: 'app.file' },
    },
    execute: 'builtin:platform.file.read',
    ...override,
  } as ToolDescriptor;
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe('DescriptorRegistryService', () => {
  let registry: DescriptorRegistryService;

  beforeEach(() => {
    registry = new DescriptorRegistryService(noopPin);
  });

  test('register 并 resolve latest 命中', () => {
    const d = makeDescriptor({ name: 'platform.file.read', version: '1.0.0' });
    registry.register(d);
    const resolved = registry.resolve('platform.file.read');
    expect(resolved).toBeDefined();
    expect(resolved?.name).toBe('platform.file.read');
  });

  test('resolve 带 version 精确命中', () => {
    registry.register(makeDescriptor({ version: '1.0.0' }));
    registry.register(makeDescriptor({ version: '1.1.0' }));
    const v100 = registry.resolve('platform.file.read', '1.0.0');
    expect(v100?.version).toBe('1.0.0');
    const v110 = registry.resolve('platform.file.read', '1.1.0');
    expect(v110?.version).toBe('1.1.0');
  });

  test('register 同 name+version → RESOURCE_CONFLICT_DESCRIPTOR_DUPLICATE', () => {
    registry.register(makeDescriptor({ version: '1.0.0' }));
    expect(() => {
      registry.register(makeDescriptor({ version: '1.0.0' }));
    }).toThrow(AgenticEngineError);

    try {
      registry.register(makeDescriptor({ version: '1.0.0' }));
    } catch (e) {
      expect((e as AgenticEngineError).code).toContain('RESOURCE_CONFLICT');
    }
  });

  test('版本不单调 → RESOURCE_CONFLICT 拒绝', () => {
    registry.register(makeDescriptor({ version: '1.0.0' }));
    expect(() => {
      registry.register(makeDescriptor({ version: '0.9.0' }));
    }).toThrow(AgenticEngineError);
  });

  test('版本相同 → RESOURCE_CONFLICT 拒绝', () => {
    registry.register(makeDescriptor({ version: '2.0.0' }));
    expect(() => {
      registry.register(makeDescriptor({ version: '2.0.0' }));
    }).toThrow(AgenticEngineError);
  });

  test('版本递增成功注册', () => {
    registry.register(makeDescriptor({ version: '1.0.0' }));
    registry.register(makeDescriptor({ version: '1.1.0' }));
    registry.register(makeDescriptor({ version: '2.0.0' }));
    // latest 应为 2.0.0
    const latest = registry.resolve('platform.file.read');
    expect(latest?.version).toBe('2.0.0');
  });

  test('resolve 不存在的 name → undefined', () => {
    expect(registry.resolve('non.existent.tool')).toBeUndefined();
  });

  test('size() 返回注册数量', () => {
    expect(registry.size()).toBe(0);
    registry.register(makeDescriptor({ version: '1.0.0' }));
    expect(registry.size()).toBe(1);
    registry.register(makeDescriptor({ name: 'memory.recall', execute: 'builtin:memory.recall', version: '1.0.0' }));
    expect(registry.size()).toBe(2);
  });

  test('listAll() 返回所有已注册 descriptors', () => {
    registry.register(makeDescriptor({ version: '1.0.0' }));
    registry.register(makeDescriptor({ version: '1.1.0' }));
    expect(registry.listAll()).toHaveLength(2);
  });

  test('一致性校验失败的 descriptor → register 抛出', () => {
    const bad = makeDescriptor({
      meta:     { execution: 'LOCAL', consent: 'ON_FIRST_USE', requiresPrincipal: 'USER', timeoutMs: 15000, idempotent: true, sideEffects: [] },
      requires: { principal: 'SERVICE', oauthScope: [], obo: null },
    });
    expect(() => registry.register(bad)).toThrow(AgenticEngineError);
  });

  test('get(name) 返回最新版本命中', () => {
    registry.register(makeDescriptor({ version: '1.0.0' }));
    registry.register(makeDescriptor({ version: '2.0.0' }));
    const d = registry.get('platform.file.read');
    expect(d.version).toBe('2.0.0');
  });

  test('get 不存在 → RESOURCE_NOT_FOUND_DESCRIPTOR', () => {
    expect(() => registry.get('no.such.tool')).toThrow(AgenticEngineError);
  });

  test('list 按 category + tags 过滤', () => {
    registry.register(
      makeDescriptor({
        name:     'a.x',
        version:  '1.0.0',
        execute:  'builtin:a.x',
        category: 'PLATFORM',
        tags:     ['t1', 't2'],
      }),
    );
    registry.register(
      makeDescriptor({
        name:     'b.y',
        version:  '1.0.0',
        execute:  'builtin:b.y',
        category: 'MEMORY',
        tags:     ['t1'],
      }),
    );
    const p = registry.list({ category: 'PLATFORM', tags: ['t1'] });
    expect(p).toHaveLength(1);
    expect(p[0]!.name).toBe('a.x');
  });

  test('getEffectiveVersion 无 Nacos 钉选时返回 latest', async () => {
    registry.register(makeDescriptor({ version: '1.0.0' }));
    const v = await registry.getEffectiveVersion('platform.file.read');
    expect(v).toBe('1.0.0');
  });
});
