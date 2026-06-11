/**
 * useHealthLive 单元测试（离线）：
 *   - onMounted 自动 refresh：loading 状态机 + 成功后 status/timestamp 落位
 *   - HTTP 非 2xx → AgenticClientError、status 'DOWN'
 *   - fetch 抛错（网络层）→ error 落位、status 'DOWN'
 *   - 手动 refresh 可从 DOWN 恢复为 UP 并清空 error
 *
 * 真实 AgenticClient + 注入 fetchImpl stub，全程不出网。
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

const registeredHappyDomForThisFile = typeof globalThis.document === 'undefined';
if (registeredHappyDomForThisFile) {
  GlobalRegistrator.register();
}
const { defineComponent, h, createApp } = await import('vue');
const { provideAgenticClient } = await import('./use-agentic-client');
const { useHealthLive } = await import('./use-health');
const { AgenticClientError } = await import('@cube-ai/agent-sdk-client');
import type { UseHealthState } from './use-health';

afterAll(async () => {
  if (registeredHappyDomForThisFile) {
    await GlobalRegistrator.unregister();
  }
});

/** 简易轮询等待：SSE/异步副作用驱动的状态收敛。 */
async function until(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('until(): condition not met within timeout');
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

function mountHealth(fetchImpl: typeof fetch): { api: UseHealthState; unmount: () => void } {
  let captured: UseHealthState | undefined;
  const Child = defineComponent({
    setup() {
      captured = useHealthLive();
      return () => h('span');
    },
  });
  const Root = defineComponent({
    setup() {
      provideAgenticClient({ baseUrl: 'http://engine.test', fetchImpl });
      return () => h(Child);
    },
  });
  const app = createApp(Root);
  const host = document.createElement('div');
  document.body.appendChild(host);
  app.mount(host);
  if (!captured) throw new Error('useHealthLive not captured');
  return {
    api: captured,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

function okHealthResponse(timestamp: number): Response {
  return new Response(JSON.stringify({ status: 'UP', timestamp }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('useHealthLive', () => {
  test('onMounted 自动 refresh：成功后 status=UP / timestamp 落位 / loading=false', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return okHealthResponse(1234);
    }) as unknown as typeof fetch;

    const { api, unmount } = mountHealth(fetchImpl);
    await until(() => api.status.value === 'UP');
    expect(calls).toBe(1);
    expect(api.timestamp.value).toBe(1234);
    expect(api.loading.value).toBe(false);
    expect(api.error.value).toBeNull();
    unmount();
  });

  test('refresh 进行中 loading=true，结束后复位', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const fetchImpl = (async () => {
      await gate;
      return okHealthResponse(1);
    }) as unknown as typeof fetch;

    const { api, unmount } = mountHealth(fetchImpl);
    await until(() => api.loading.value === true);
    expect(api.status.value).toBe('UNKNOWN');
    release!();
    await until(() => api.loading.value === false);
    expect(api.status.value).toBe('UP');
    unmount();
  });

  test('HTTP 503 → AgenticClientError + status=DOWN', async () => {
    const fetchImpl = (async () =>
      new Response('Service Unavailable', { status: 503, statusText: 'Service Unavailable' })
    ) as unknown as typeof fetch;

    const { api, unmount } = mountHealth(fetchImpl);
    await until(() => api.status.value === 'DOWN');
    expect(api.error.value).toBeInstanceOf(AgenticClientError);
    expect((api.error.value as InstanceType<typeof AgenticClientError>).httpStatus).toBe(503);
    expect(api.loading.value).toBe(false);
    unmount();
  });

  test('网络层抛错 → error 落位 + status=DOWN；手动 refresh 恢复 UP 并清 error', async () => {
    let healthy = false;
    const fetchImpl = (async () => {
      if (!healthy) throw new Error('ECONNREFUSED');
      return okHealthResponse(99);
    }) as unknown as typeof fetch;

    const { api, unmount } = mountHealth(fetchImpl);
    await until(() => api.status.value === 'DOWN');
    expect(api.error.value).toBeInstanceOf(Error);
    expect((api.error.value as Error).message).toContain('ECONNREFUSED');

    healthy = true;
    await api.refresh();
    expect(api.status.value).toBe('UP');
    expect(api.timestamp.value).toBe(99);
    expect(api.error.value).toBeNull();
    unmount();
  });
});
