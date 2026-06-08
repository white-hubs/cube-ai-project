import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { testInfraLog, withProgressLog } from './log';

/** 与 Engine DescriptorLoader、docker-compose 示例一致 */
export const NACOS_DESCRIPTOR_GROUP_DEFAULT = 'agentic-engine-tools';

let nacosTracked: StartedTestContainer[] | null = null;

export async function stopTrackedNacosIfAny(): Promise<void> {
  const arr = nacosTracked;
  if (!arr?.length) return;
  testInfraLog(`Stopping ${arr.length} Nacos Testcontainer(s)…`);
  await Promise.all(
    arr.map((c) =>
      c.stop().catch(() => {
        /* ignore */
      }),
    ),
  );
  if (nacosTracked === arr) nacosTracked = null;
}

export interface NacosServerStack {
  /** 无尾部斜杠，与 AGENTIC_ENGINE_NACOS_URL 约定一致 */
  baseUrl: string;
  stop: () => Promise<void>;
}

/**
 * 单机 Nacos 3.x（Derby），禁用默认鉴权便于集成测试发布配置。
 *
 * 镜像：`nacos/nacos-server:v3.1.0`
 *
 * 就绪：8848 HTTP readiness（官方文档 v3 admin state）。
 */
export async function startNacosServer(): Promise<NacosServerStack> {
  const started: StartedTestContainer[] = [];
  nacosTracked = started;

  const image = 'nacos/nacos-server:v3.1.0';

  try {
    testInfraLog(`Starting Nacos (${image}) standalone…`);
    const t0 = Date.now();

    const container = await withProgressLog(
      'Nacos GenericContainer.start()',
      new GenericContainer(image)
        .withEnvironment({
          MODE: 'standalone',
          PREFER_HOST_MODE: 'hostname',
          NACOS_AUTH_ENABLE: 'false',
          /** v3.1 镜像在关闭鉴权时仍要求 token / identity 存在（与 nacos-docker example 一致） */
          NACOS_AUTH_TOKEN: 'VGhpc0lzTXlDdXN0b21TZWNyZXRLZXkwMTIzNDU2Nzg=',
          NACOS_AUTH_IDENTITY_KEY: 'serverIdentity',
          NACOS_AUTH_IDENTITY_VALUE: 'security',
          /** 允许使用既有 `/nacos/v2/cs/config` 发布（便于集成测试种子数据） */
          NACOS_CORE_API_COMPATIBILITY_ADMIN_ENABLED: 'true',
          JVM_XMS: '256m',
          JVM_XMX: '512m',
        })
        .withExposedPorts(8848, 9848, 8080)
        /** 镜像拉取 + JVM 启动常超过 Testcontainers 默认 10s */
        .withStartupTimeout(300_000)
        .withWaitStrategy(
          Wait.forHttp('/nacos/v3/admin/core/state/readiness', 8848)
            .forStatusCode(200)
            .withStartupTimeout(300_000),
        )
        .start(),
    );

    started.push(container);
    testInfraLog(`Nacos container ready (+${Date.now() - t0}ms)`);

    const baseUrl = `http://${container.getHost()}:${container.getMappedPort(8848)}`;

    return {
      baseUrl,
      stop: async () => {
        await container.stop().catch(() => {});
        if (nacosTracked === started) nacosTracked = null;
      },
    };
  } catch (e) {
    await Promise.all(
      started.map((c) =>
        c.stop().catch(() => {
          /* ignore */
        }),
      ),
    );
    if (nacosTracked === started) nacosTracked = null;
    throw e;
  }
}

export interface PublishNacosConfigOpts {
  baseUrl: string;
  dataId: string;
  group: string;
  content: string;
  /** 默认空串即 public */
  namespaceId?: string;
}

/**
 * Nacos 3.x：admin readiness 先于配置存储可读；轮询直到 v3 客户端接口能读到配置。
 */
export async function waitForNacosConfigReadable(opts: {
  baseUrl: string;
  dataId: string;
  group: string;
  /** public 传空串 */
  namespaceId?: string;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<void> {
  const root = opts.baseUrl.replace(/\/$/, '');
  const ns = opts.namespaceId ?? '';
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  const interval = opts.intervalMs ?? 400;
  const q = new URLSearchParams({
    dataId: opts.dataId,
    groupName: opts.group,
    namespaceId: ns,
  });
  const url = `${root}/nacos/v3/client/cs/config?${q.toString()}`;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      let parsed: { code?: number };
      try {
        parsed = JSON.parse(text) as { code?: number };
      } catch {
        await new Promise((r) => setTimeout(r, interval));
        continue;
      }
      if (parsed.code === 0) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(
    `waitForNacosConfigReadable timeout (${opts.dataId} group=${opts.group} namespaceId=${JSON.stringify(ns)})`,
  );
}

/**
 * Nacos 2.x/3.x 兼容 OpenAPI：发布配置（POST `/nacos/v2/cs/config`）。
 *
 * ref: https://nacos.io/en/docs/latest/guide/user/open-api/
 */
export async function publishNacosConfig(opts: PublishNacosConfigOpts): Promise<void> {
  const root = opts.baseUrl.replace(/\/$/, '');
  const url = `${root}/nacos/v2/cs/config`;

  const body = new URLSearchParams();
  body.set('dataId', opts.dataId);
  body.set('group', opts.group);
  body.set('content', opts.content);
  body.set('namespaceId', opts.namespaceId ?? '');

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const text = await res.text();
  let parsed: { code?: number; message?: string };
  try {
    parsed = JSON.parse(text) as { code?: number; message?: string };
  } catch {
    throw new Error(`publishNacosConfig: non-JSON response ${res.status} ${text.slice(0, 200)}`);
  }

  if (!res.ok || parsed.code !== 0) {
    throw new Error(
      `publishNacosConfig failed: ${res.status} ${parsed.message ?? text.slice(0, 300)}`,
    );
  }
}

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/nacos-seed',
);

/** Nacos descriptor 集成测试种子文件（v6：`infra/test-infra/fixtures/nacos-seed`）。 */
export const NACOS_SEED_FIXTURE_DIR = FIXTURE_DIR;
export const NACOS_SEED_ECHO_FIXTURE = join(FIXTURE_DIR, 'echo.json');
export const NACOS_SEED_INDEX_FIXTURE = join(FIXTURE_DIR, 'descriptor-index.yaml');

/** 工具 descriptor 本地扫描样例目录（源仓 `docs/.../sample-descriptors` 收编落点）。 */
export const INTEGRATION_TOOL_DESCRIPTOR_SAMPLE_DIR = NACOS_SEED_FIXTURE_DIR;

/**
 * 写入 `descriptor-index.yaml` + `echo.json`（group {@link NACOS_DESCRIPTOR_GROUP_DEFAULT}）。
 */
export async function seedAgenticDescriptorNacosFixtures(
  baseUrl: string,
  opts?: { group?: string },
): Promise<void> {
  const group = opts?.group ?? NACOS_DESCRIPTOR_GROUP_DEFAULT;

  const [indexYaml, echoJson] = await Promise.all([
    readFile(join(FIXTURE_DIR, 'descriptor-index.yaml'), 'utf-8'),
    readFile(join(FIXTURE_DIR, 'echo.json'), 'utf-8'),
  ]);

  await publishNacosConfig({
    baseUrl,
    group,
    dataId: 'echo.json',
    content: echoJson,
  });

  await publishNacosConfig({
    baseUrl,
    group,
    dataId: 'descriptor-index.yaml',
    content: indexYaml,
  });

  await waitForNacosConfigReadable({
    baseUrl,
    group,
    dataId: 'descriptor-index.yaml',
  });
}
