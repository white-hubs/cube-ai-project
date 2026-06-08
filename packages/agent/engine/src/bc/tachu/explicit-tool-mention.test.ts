import { describe, expect, it } from 'bun:test';
import { findExplicitToolMentions } from './explicit-tool-mention';

describe('findExplicitToolMentions', () => {
  it('matches dotted tool names in Chinese prompts', () => {
    expect(
      findExplicitToolMentions('使用 image.qwen 工具画一只猫', ['image.qwen', 'currentDate']),
    ).toEqual(['image.qwen']);
  });
});
