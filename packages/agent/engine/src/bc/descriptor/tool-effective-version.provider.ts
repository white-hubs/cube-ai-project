import { Injectable } from '@dangao/bun-server';
import { NacosConfigClient, NacosClient, type NacosClientOptions } from '@dangao/nacos-client';
import { parse as parseYaml } from 'yaml';

/**
 * 从 Nacos group `agentic-engine-tool-versions` 读取工具名 → 生效版本映射。
 *
 * Phase 3 P3-11：lazy 首次拉取；poll 间隔内与 DescriptorLoader 共用同一 client。
 */
export const TOOL_EFFECTIVE_VERSION_SOURCE_TOKEN = Symbol.for(
  'agentic.descriptor.tool-effective-version-source',
);

export interface ToolEffectiveVersionSource {
  refreshFromNacos(): Promise<void>;
  getPinnedVersion(toolName: string): Promise<string | undefined>;
}

/** 构建 Nacos 客户端（不调 HTTP，直至首次 getConfig）。 */
export function createNacosClientFromEnv(): NacosClient | null {
  const raw =
    process.env.AGENTIC_ENGINE_NACOS_SERVERS?.trim() ||
    process.env.AGENTIC_ENGINE_NACOS_URL?.trim();
  if (!raw) return null;

  const serverList = raw.includes(',')
    ? raw.split(',').map((s) => s.trim()).filter(Boolean)
    : [raw];

  const opts: NacosClientOptions = {
    serverList,
    namespaceId: process.env.AGENTIC_ENGINE_NACOS_NAMESPACE?.trim() || undefined,
    username: process.env.AGENTIC_ENGINE_NACOS_USERNAME?.trim() || undefined,
    password: process.env.AGENTIC_ENGINE_NACOS_PASSWORD?.trim() || undefined,
  };

  return new NacosClient(opts);
}

function parseVersionsYaml(content: string): Record<string, string> {
  const doc = parseYaml(content) as unknown;
  if (!doc || typeof doc !== 'object') return {};
  const root = doc as Record<string, unknown>;
  const raw =
    root['effectiveVersions'] ??
    root['effective'] ??
    root['versions'] ??
    root['pin'];
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v)) out[k] = v;
  }
  return out;
}

@Injectable()
export class ToolEffectiveVersionProvider implements ToolEffectiveVersionSource {
  private readonly map = new Map<string, string>();
  private readonly group =
    process.env.AGENTIC_ENGINE_TOOL_VERSIONS_GROUP?.trim() ||
    'agentic-engine-tool-versions';
  private readonly dataId =
    process.env.AGENTIC_ENGINE_TOOL_VERSIONS_DATA_ID?.trim() ||
    'effective-versions.yaml';

  constructor(private readonly configClient: NacosConfigClient | null) {}

  async refreshFromNacos(): Promise<void> {
    if (!this.configClient) return;
    try {
      const res = await this.configClient.getConfig({
        dataId: this.dataId,
        groupName: this.group,
      });
      const parsed = parseVersionsYaml(res.content ?? '');
      this.map.clear();
      for (const [name, ver] of Object.entries(parsed)) {
        this.map.set(name, ver);
      }
    } catch {
      // Nacos 不可用时保留上次映射（若有）；由上层日志记录
    }
  }

  async getPinnedVersion(toolName: string): Promise<string | undefined> {
    if (this.map.size === 0 && this.configClient) {
      await this.refreshFromNacos();
    }
    return this.map.get(toolName);
  }
}

/** DI factory：无 Nacos 地址时 configClient=null，仅退回 registry 内版本。 */
export function toolEffectiveVersionProviderFactory(): ToolEffectiveVersionProvider {
  const core = createNacosClientFromEnv();
  const cfg = core ? new NacosConfigClient(core) : null;
  return new ToolEffectiveVersionProvider(cfg);
}
