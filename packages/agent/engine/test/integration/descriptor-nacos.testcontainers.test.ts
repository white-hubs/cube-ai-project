/**
 * Nacos 3.x（Testcontainers）+ DescriptorLoader 集成。
 *
 *   USE_NACOS_TESTCONTAINERS=1 bun test packages/agent/engine/test/integration/descriptor-nacos.testcontainers.test.ts
 *   bun run test:nacos-containers
 *   bun run test:containers（全部 `*.testcontainers` 集成用例；本文件需 USE_NACOS_TESTCONTAINERS=1，脚本已统一设置）
 *
 * 依赖 Docker；首次会拉取 `nacos/nacos-server:v3.1.0`，冷启动可达数分钟。
 */
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from 'bun:test';
import {
  publishNacosConfig,
  registerProcessShutdown,
  resolveShouldRunNacosTestcontainers,
  seedAgenticDescriptorNacosFixtures,
  startNacosServer,
  stopTrackedNacosIfAny,
  NACOS_DESCRIPTOR_GROUP_DEFAULT,
  NACOS_SEED_ECHO_FIXTURE,
  NACOS_SEED_INDEX_FIXTURE,
  type NacosServerStack,
} from '@cube-ai/test-infra';
import { DescriptorRegistryService } from '../../src/bc/descriptor/descriptor-registry.service';
import { DescriptorLoader } from '../../src/bc/descriptor/descriptor-loader';
import type { ToolEffectiveVersionSource } from '../../src/bc/descriptor/tool-effective-version.provider';

const run = await resolveShouldRunNacosTestcontainers();

const noopPin: ToolEffectiveVersionSource = {
  refreshFromNacos: async () => {},
  getPinnedVersion: async () => undefined,
};

const stackHolder: { current: NacosServerStack | null } = { current: null };

const HOOK_MS = 600_000;

const NACOS_ENV_KEYS = [
  'AGENTIC_ENGINE_NACOS_URL',
  'AGENTIC_ENGINE_DESCRIPTOR_GROUP',
  'AGENTIC_ENGINE_DESCRIPTOR_INDEX_DATA_ID',
  'AGENTIC_ENGINE_DESCRIPTOR_POLL_MS',
] as const;

if (run) {
  setDefaultTimeout(3_600_000);
  registerProcessShutdown(
    async () => {
      await stopTrackedNacosIfAny();
      if (stackHolder.current) {
        await stackHolder.current.stop().catch(() => {});
        stackHolder.current = null;
      }
    },
    { exitProcessAfterSignal: true },
  );
}

(run ? describe : describe.skip)(
  'Descriptor Nacos [testcontainers]',
  () => {
    beforeAll(async () => {
      const s = await startNacosServer();
      stackHolder.current = s;

      process.env.AGENTIC_ENGINE_NACOS_URL = s.baseUrl;
      delete process.env.AGENTIC_ENGINE_NACOS_SERVERS;
      /** 与种子一致：public 命名空间；勿沿用仓库 .env 里的业务 namespaceId */
      delete process.env.AGENTIC_ENGINE_NACOS_NAMESPACE;
      delete process.env.AGENTIC_ENGINE_NACOS_USERNAME;
      delete process.env.AGENTIC_ENGINE_NACOS_PASSWORD;
      delete process.env.AGENTIC_ENGINE_TOOL_DESCRIPTOR_DIR;
      process.env.AGENTIC_ENGINE_DESCRIPTOR_GROUP = NACOS_DESCRIPTOR_GROUP_DEFAULT;
      process.env.AGENTIC_ENGINE_DESCRIPTOR_INDEX_DATA_ID = 'descriptor-index.yaml';

      await seedAgenticDescriptorNacosFixtures(s.baseUrl);
    }, HOOK_MS);

    afterAll(async () => {
      if (stackHolder.current) {
        await stackHolder.current.stop().catch(() => {});
        stackHolder.current = null;
      }
      await stopTrackedNacosIfAny();
      for (const k of NACOS_ENV_KEYS) {
        delete process.env[k];
      }
    });

    it('Nacos 种子配置 → loader.start() 后 registry 含 platform.echo', async () => {
      const registry = new DescriptorRegistryService(noopPin);
      const loader = new DescriptorLoader(registry, noopPin);
      await loader.start();
      expect(registry.size()).toBeGreaterThan(0);
      const one = registry.listAll()[0]!;
      const d = registry.get(`${one.name}@${one.version ?? '1.0.0'}`);
      expect(d.name).toBe('platform.echo');
      loader.stopPolling();
    });

    it('更新 echo + index 后轮询可加载新版本（displayName）', async () => {
      process.env.AGENTIC_ENGINE_DESCRIPTOR_POLL_MS = '400';

      const registry = new DescriptorRegistryService(noopPin);
      const loader = new DescriptorLoader(registry, noopPin);
      try {
        await loader.start();

        expect(registry.get('platform.echo@1.0.0').displayName).toBe('回声工具（示例）');

        const baseUrl = stackHolder.current!.baseUrl;
        const group = NACOS_DESCRIPTOR_GROUP_DEFAULT;

        const raw = await Bun.file(NACOS_SEED_ECHO_FIXTURE).text();
        const doc = JSON.parse(raw) as Record<string, unknown>;
        doc['displayName'] = '回声工具（集成测试已更新）';
        await publishNacosConfig({
          baseUrl,
          group,
          dataId: 'echo.json',
          content: JSON.stringify(doc),
        });

        await publishNacosConfig({
          baseUrl,
          group,
          dataId: 'descriptor-index.yaml',
          content: (await Bun.file(NACOS_SEED_INDEX_FIXTURE).text()) + '\n# bump-md5\n',
        });

        await new Promise((r) => setTimeout(r, 900));

        expect(registry.get('platform.echo@1.0.0').displayName).toBe('回声工具（集成测试已更新）');
      } finally {
        loader.stopPolling();
      }
    });
  },
);
