import { describe, expect, test } from 'bun:test';
import {
  computeTachuToolMirrorNames,
  computeTachuToolMirrorNamesForPrompt,
} from './engine-tool-mirror';

describe('computeTachuToolMirrorNames', () => {
  test('toolRefs 非空时并集强制包含 currentDate 与 image.qwen（若 registry 可解析）', () => {
    const registry = {
      resolve: (n: string) => {
        if (n === 'a.tool' || n === 'currentDate' || n === 'image.qwen') return { name: n };
        return undefined;
      },
      listAll: () => [{ name: 'should-not-appear' }],
    };
    const names = computeTachuToolMirrorNames(['a.tool', 'missing', 'currentDate'], registry);
    expect(names).toEqual(['a.tool', 'currentDate', 'image.qwen']);
  });

  test('toolRefs 为空时镜像 listAll 且仍含 currentDate', () => {
    const registry = {
      resolve: (n: string) => (n === 'x' || n === 'currentDate' ? { name: n } : undefined),
      listAll: () => [{ name: 'x' }, { name: 'currentDate' }],
    };
    const names = computeTachuToolMirrorNames(undefined, registry);
    expect(names).toEqual(['currentDate', 'x']);
  });

  test('registry 无 currentDate 时不强行加入', () => {
    const registry = {
      resolve: (n: string) => (n === 'only' ? { name: n } : undefined),
      listAll: () => [{ name: 'only' }],
    };
    expect(computeTachuToolMirrorNames(['only'], registry)).toEqual(['only']);
  });

  test('registry 无 image.qwen 时不强行加入', () => {
    const registry = {
      resolve: (n: string) => (n === 'a.tool' || n === 'currentDate' ? { name: n } : undefined),
      listAll: () => [],
    };
    expect(computeTachuToolMirrorNames(['a.tool'], registry)).toEqual(['a.tool', 'currentDate']);
  });

  test('data-chart prompt omits image.qwen from mirror union', () => {
    const registry = {
      resolve: (n: string) => {
        if (n === 'a.tool' || n === 'currentDate' || n === 'image.qwen') return { name: n };
        return undefined;
      },
      listAll: () => [],
    };
    const names = computeTachuToolMirrorNamesForPrompt(
      ['a.tool'],
      registry,
      '用图表总结今日科技股大盘',
    );
    expect(names).toEqual(['a.tool', 'currentDate']);
  });

  test('uploaded-image describe prompt omits image.qwen from mirror union', () => {
    const registry = {
      resolve: (n: string) => {
        if (n === 'a.tool' || n === 'currentDate' || n === 'image.qwen') return { name: n };
        return undefined;
      },
      listAll: () => [],
    };
    const names = computeTachuToolMirrorNamesForPrompt(
      ['a.tool'],
      registry,
      '介绍下图里的内容',
      { hasImageInput: true },
    );
    expect(names).toEqual(['a.tool', 'currentDate']);
  });

  test('text-to-image prompt keeps image.qwen without upload', () => {
    const registry = {
      resolve: (n: string) => {
        if (n === 'a.tool' || n === 'currentDate' || n === 'image.qwen') return { name: n };
        return undefined;
      },
      listAll: () => [],
    };
    const names = computeTachuToolMirrorNamesForPrompt(['a.tool'], registry, '画一只猫');
    expect(names).toEqual(['a.tool', 'currentDate', 'image.qwen']);
  });
});
