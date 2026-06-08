import { describe, expect, it } from 'bun:test';
import { computeIntentToolRouting } from './intent-flow-scoring';

describe('computeIntentToolRouting', () => {
  it('returns matched and all tools when intent block absent', () => {
    const r = computeIntentToolRouting({
      prompt: '我要退款',
      toolRefs: ['platform.flow.invoke', 'platform.knowledge.query'],
      intentBlock: null,
    });
    expect(r.state).toBe('matched');
    expect(r.visibleToolRefs).toEqual(['platform.flow.invoke', 'platform.knowledge.query']);
  });

  it('returns empty when no keyword hits any flow tool', () => {
    const r = computeIntentToolRouting({
      prompt: '随便聊聊',
      toolRefs: ['platform.flow.invoke', 'platform.knowledge.query'],
      intentBlock: {
        enabled: true,
        flows: [{ toolName: 'platform.flow.invoke', priority: 1, keywords: ['退款'] }],
      },
    });
    expect(r.state).toBe('empty');
    expect(r.visibleToolRefs).toEqual(['platform.knowledge.query']);
  });

  it('matched unique winner by priority', () => {
    const r = computeIntentToolRouting({
      prompt: '我要退款',
      toolRefs: ['flow.a', 'flow.b', 'platform.knowledge.query'],
      intentBlock: {
        enabled: true,
        flows: [
          { toolName: 'flow.a', priority: 1, keywords: ['退款'] },
          { toolName: 'flow.b', priority: 2, keywords: ['退款'] },
        ],
      },
    });
    expect(r.state).toBe('matched');
    expect(new Set(r.visibleToolRefs)).toEqual(new Set(['flow.b', 'platform.knowledge.query']));
  });

  it('fallback with multiMatch when same priority ties', () => {
    const r = computeIntentToolRouting({
      prompt: '退款与售后',
      toolRefs: ['flow.a', 'flow.b'],
      intentBlock: {
        enabled: true,
        flows: [
          { toolName: 'flow.a', priority: 1, keywords: ['退款'] },
          { toolName: 'flow.b', priority: 1, keywords: ['售后'] },
        ],
      },
    });
    expect(r.state).toBe('fallback');
    expect(r.multiMatch).toBe(true);
    expect(new Set(r.visibleToolRefs)).toEqual(new Set(['flow.a', 'flow.b']));
  });
});
