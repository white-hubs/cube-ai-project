import { describe, expect, test } from 'bun:test';
import { findExplicitSkillMentions } from './explicit-skill-mention';

describe('findExplicitSkillMentions', () => {
  test('detects slash and bare skill names', () => {
    expect(
      findExplicitSkillMentions('请用 /chart-output 画统计图', ['chart-output', 'default']),
    ).toEqual(['chart-output']);
    expect(findExplicitSkillMentions('使用 chart-output 技能', ['chart-output'])).toEqual([
      'chart-output',
    ]);
  });
});
