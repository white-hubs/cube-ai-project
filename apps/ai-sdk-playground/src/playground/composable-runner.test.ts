import { afterAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { runComposableCapability } from './composable-runner';

const registeredHappyDom = typeof globalThis.document === 'undefined';
if (registeredHappyDom) {
  GlobalRegistrator.register();
}

afterAll(async () => {
  if (registeredHappyDom) {
    await GlobalRegistrator.unregister();
  }
});

describe('composable-runner', () => {
  test('provideAssistant capability completes a turn with stub port', async () => {
    const result = await runComposableCapability(
      {
        id: 'agent-sdk-client-vue.provideAssistant',
        package: '@cube-ai/agent-sdk-client-vue',
        domain: 'agent',
        face: 'vue',
        factory: 'provideAssistant',
        method: 'provideAssistant',
        kind: 'composable',
        params: [],
      },
      { defaultAgentId: '8300000000000000001', message: 'hello playground' },
    );
    expect(result.ok).toBe(true);
    expect((result.data as { lastTurnStatus: string }).lastTurnStatus).toBe('completed');
  });

  test('startMockEngine mock capability returns url and port', async () => {
    const result = await runComposableCapability(
      {
        id: 'agent-sdk-client-mock.startMockEngine',
        package: '@cube-ai/agent-sdk-client-mock',
        domain: 'agent',
        face: 'mock',
        factory: 'startMockEngine',
        method: 'startMockEngine',
        kind: 'mock',
        params: [],
      },
      { scenarioName: 'health_up' },
    );
    expect(result.ok).toBe(true);
    expect((result.data as { port: number }).port).toBeGreaterThan(0);
  });
});
