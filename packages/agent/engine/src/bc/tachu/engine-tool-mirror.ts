import { shouldOmitImageQwenFromMirror } from './host-turn-policy';

/**
 * 计算本轮应镜像到 tachu 的工具名集合（含 `currentDate` / `image.qwen` 并集规则）。
 */
export interface ToolMirrorRegistryLike {
  resolve(name: string): { name: string } | undefined;
  listAll(): { name: string }[];
}

export interface ComputeTachuToolMirrorOptions {
  /** When true, skip unioning `image.qwen` (data-chart / uploaded-image describe alignment). */
  omitImageQwen?: boolean;
}

export interface ComputeTachuToolMirrorForPromptOptions {
  /** When true, user attached image_ref blocks this turn (multimodal describe path). */
  hasImageInput?: boolean;
}

/**
 * - `toolRefs` 非空：仅白名单内可解析名称 + 强制并集 `currentDate`（若注册表存在）。
 * - 同上并集 `image.qwen`（若注册表存在且未 `omitImageQwen`）— 文生图默认可见。
 * - `toolRefs` 缺失或空：镜像注册表全部工具（与 EngineFactory 原语义一致）。
 */
export function computeTachuToolMirrorNames(
  toolRefs: readonly string[] | undefined,
  registry: ToolMirrorRegistryLike,
  options?: ComputeTachuToolMirrorOptions,
): string[] {
  const names = new Set<string>();
  if (toolRefs && toolRefs.length > 0) {
    for (const raw of toolRefs) {
      const n = typeof raw === 'string' ? raw.trim() : '';
      if (!n) continue;
      if (registry.resolve(n)) names.add(n);
    }
  } else {
    for (const d of registry.listAll()) {
      names.add(d.name);
    }
  }
  if (registry.resolve('currentDate')) {
    names.add('currentDate');
  }
  if (!options?.omitImageQwen && registry.resolve('image.qwen')) {
    names.add('image.qwen');
  }
  return [...names].sort();
}

/** Mirror helper: omit image.qwen for data-chart or uploaded-image describe turns. */
export function computeTachuToolMirrorNamesForPrompt(
  toolRefs: readonly string[] | undefined,
  registry: ToolMirrorRegistryLike,
  prompt: string,
  options?: ComputeTachuToolMirrorForPromptOptions,
): string[] {
  return computeTachuToolMirrorNames(toolRefs, registry, {
    omitImageQwen: shouldOmitImageQwenFromMirror(prompt, options?.hasImageInput ?? false),
  });
}
