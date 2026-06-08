import { describe, expect, test } from 'bun:test';
import type { SkillDescriptor } from '@tachu/core';
import { scoreSkillsByKeyword } from './keyword.strategy';

function makeSkill(overrides: Partial<SkillDescriptor> & { name: string }): SkillDescriptor {
  return {
    kind: 'skill',
    name: overrides.name,
    description: overrides.description ?? 'Use when testing',
    instructions: overrides.instructions ?? 'body',
    trigger: overrides.trigger ?? { type: 'semantic' },
    ...(overrides.displayName !== undefined ? { displayName: overrides.displayName } : {}),
    ...(overrides.tags !== undefined ? { tags: overrides.tags } : {}),
    ...(overrides.deprecated !== undefined ? { deprecated: overrides.deprecated } : {}),
  };
}

describe('scoreSkillsByKeyword', () => {
  test('exact name match promotes with score 1', () => {
    const hits = scoreSkillsByKeyword('please use chart-output', [
      makeSkill({ name: 'chart-output', description: 'charts' }),
    ]);
    expect(hits.length).toBe(1);
    expect(hits[0]?.score).toBe(1);
    expect(hits[0]?.promote).toBe(true);
    expect(hits[0]?.promote).toBe(true);
    expect(hits[0]?.reason?.startsWith('keyword:exact')).toBe(true);
  });

  test('Chinese chart skill intent promotes chart-output to T0', () => {
    const hits = scoreSkillsByKeyword('使用图表生成技能，随机生成几个图表', [
      makeSkill({
        name: 'chart-output',
        displayName: 'Chart Output',
        description:
          'Use when the conversation asks for visualization, dashboards, charts, 图表',
        tags: ['chart', 'visualization', 'echarts'],
      }),
    ]);
    expect(hits.length).toBe(1);
    expect(hits[0]?.skill.name).toBe('chart-output');
    expect(hits[0]?.promote).toBe(true);
    expect(hits[0]?.score).toBeGreaterThanOrEqual(0.9);
  });

  test('excludes snapshot-pinned names', () => {
    const hits = scoreSkillsByKeyword('chart-output', [
      makeSkill({ name: 'chart-output' }),
      makeSkill({ name: 'other-skill', description: 'chart-output helper' }),
    ], { excludeNames: new Set(['chart-output']) });
    expect(hits.every((h) => h.skill.name !== 'chart-output')).toBe(true);
  });
});
