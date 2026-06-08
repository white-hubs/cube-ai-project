import { describe, expect, test } from 'bun:test';
import type { ResourceDemandContext } from '@tachu/core';
import { createResourceDemandRouter } from './resource-demand-router';

function makeCtx(override: Partial<ResourceDemandContext> = {}): ResourceDemandContext {
  return {
    unit: 'tool-use',
    phase: 'reasoning',
    messages: [],
    route: { provider: 'openai', model: 'gpt-4o' },
    ...override,
  } as ResourceDemandContext;
}

describe('createResourceDemandRouter (ADR-0026 conservative default)', () => {
  test('returns full-fidelity {mode:"all"} for tool-use unit', async () => {
    const router = createResourceDemandRouter();
    await expect(Promise.resolve(router(makeCtx({ unit: 'tool-use' })))).resolves.toEqual({
      mode: 'all',
    });
  });

  test('returns {mode:"all"} regardless of unit / candidate tools / supported kinds', async () => {
    const router = createResourceDemandRouter();
    const ctx = makeCtx({
      unit: 'candidate-answer',
      supportedKinds: new Set(['image']),
      candidateTools: [],
    });
    await expect(Promise.resolve(router(ctx))).resolves.toEqual({ mode: 'all' });
  });
});
