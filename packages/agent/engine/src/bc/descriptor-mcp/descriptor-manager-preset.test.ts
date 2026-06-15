/**
 * 验证系统级「管理 Agent」预置 YAML 经现有 descriptor loader 正常解析，
 * 且 availableTools 引用管理 ops 工具集（ADR-0027 §7）。
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { DescriptorLoader } from '../descriptor/descriptor-loader';
import { DescriptorRegistryService } from '../descriptor/descriptor-registry.service';
import type { ToolEffectiveVersionSource } from '../descriptor/tool-effective-version.provider';
import { managementToolNames } from '../tools/handlers/descriptor-ops';

const noopPin: ToolEffectiveVersionSource = {
  refreshFromNacos: async () => {},
  getPinnedVersion: async () => undefined,
};

// Anchor to repo root via this file's location (robust to process.chdir in other tests).
const AGENTS_DIR = join(import.meta.dir, '..', '..', '..', '..', '..', '..', 'descriptors', 'agents');

describe('cube-descriptor-manager preset', () => {
  it('parses via DescriptorLoader and references the management tool names', async () => {
    const registry = new DescriptorRegistryService(noopPin);
    const loader = new DescriptorLoader(registry, noopPin);

    const { indexed } = await loader.buildAgentIndexFromDir(AGENTS_DIR);
    expect(indexed).toBeGreaterThan(0);
    expect(loader.getIndexedAgentPath('cube-descriptor-manager')).toBeDefined();

    const agent = await loader.getAgent('cube-descriptor-manager');
    expect(agent).not.toBeNull();
    expect(agent?.['kind']).toBe('agent');

    const availableTools = (agent?.['availableTools'] as string[]) ?? [];
    for (const name of managementToolNames()) {
      expect(availableTools).toContain(name);
    }
  });
});
