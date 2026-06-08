import type { InputEnvelope, TurnPolicy } from '@tachu/core';

const emptyTurnPolicy = (): TurnPolicy => ({
  excludeTools: [],
  includeTools: [],
  explicitSkills: [],
  excludeSkills: [],
  pinSkills: [],
  visualization: '',
});

const normalizeQuery = (text: string): string =>
  text
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。、；：！？,.;:!?'"`]/g, '');

/** User explicitly named a tool in the prompt (subset of registered names). */
export function promptMentionsTool(prompt: string, toolName: string): boolean {
  return prompt.toLowerCase().includes(toolName.toLowerCase());
}

const EN_VERB_NOUN_RE =
  /\b(?:draw|generate|create|paint|illustrate|render|make|produce|design)\b[^\n]{0,30}?\b(?:image|picture|photo|photograph|illustration|poster|wallpaper|avatar|drawing|painting|artwork|icon|logo|render|thumbnail)\b/i;

const ZH_VERB_NOUN_RE =
  /(?:生成|画出|绘制|制作|创作|创建|画|来一[张幅个]|帮我画|帮我生成|帮我做)[^\n]{0,30}?(?:图片|图像|图画|插画|海报|壁纸|头像|照片|封面|缩略图)/iu;

/** Bare 画/绘制 + object (e.g. 画一只猫) without requiring 图/图片 in the noun slot. */
const ZH_LOOSE_DRAW_RE =
  /(?:画|绘制)(?:一|个|只|张|幅|副)?[\u4e00-\u9fa5a-z0-9]{0,12}(?:猫|狗|鸟|人|花|风景|动物|车|建筑)/u;

const SLASH_DRAW_RE = /^\/(?:draw|text-to-image|text2image)(?:\s+|$)/i;

function hasChartSignal(prompt: string): boolean {
  const q = normalizeQuery(prompt);
  if (q.length === 0) return false;
  return (
    q.includes('图表') ||
    q.includes('可视化') ||
    q.includes('统计图') ||
    q.includes('echarts') ||
    q.includes('mermaid') ||
    /\b(?:chart|charts|dashboard|visualization|visualize)\b/u.test(prompt)
  );
}

function hasImageDrawSignal(prompt: string): boolean {
  const raw = prompt.trim();
  if (raw.length === 0) return false;
  if (SLASH_DRAW_RE.test(raw)) return true;
  if (ZH_VERB_NOUN_RE.test(raw)) return true;
  if (ZH_LOOSE_DRAW_RE.test(raw)) return true;
  if (EN_VERB_NOUN_RE.test(raw)) return true;
  return false;
}

/**
 * Data-chart / statistics visualization intent (host keyword fallback, ADR-0023 §B).
 * Aligns with skill keyword `chart-intent` in `keyword.strategy.ts`.
 */
export function detectDataChartIntent(prompt: string): boolean {
  return hasChartSignal(prompt);
}

/**
 * Text-to-image intent (replaces removed `textToImage` metadata heuristic).
 */
export function detectGeneratedImageIntent(prompt: string): boolean {
  if (!hasImageDrawSignal(prompt)) return false;
  if (hasChartSignal(prompt)) return false;
  return true;
}

const ZH_REFERENCE_IMAGE_EDIT_RE =
  /(?:编辑|修(?:改|图)|改成|换(?:成|个)|风格化|去背景|抠图|放大|高清|变清晰|inpaint|outpaint)/iu;

const EN_REFERENCE_IMAGE_EDIT_RE =
  /\b(?:edit|modify|transform|restyle|upscale|remove\s+background|inpaint|outpaint)\b[^\n]{0,40}?\b(?:image|picture|photo|this)\b/i;

/** User wants image.qwen reference-image edit (not mere describe/OCR of an upload). */
export function detectReferenceImageEditIntent(prompt: string): boolean {
  const raw = prompt.trim();
  if (raw.length === 0) return false;
  return ZH_REFERENCE_IMAGE_EDIT_RE.test(raw) || EN_REFERENCE_IMAGE_EDIT_RE.test(raw);
}

/** Whether image.qwen should stay in the tool mirror for this turn. */
export function shouldIncludeImageQwenForTurn(
  prompt: string,
  hasImageInput: boolean,
): boolean {
  if (promptMentionsTool(prompt, 'image.qwen')) return true;
  if (detectGeneratedImageIntent(prompt)) return true;
  if (hasImageInput && detectReferenceImageEditIntent(prompt)) return true;
  return false;
}

/** Mirror union rule: omit image.qwen for data-chart or uploaded-image describe turns. */
export function shouldOmitImageQwenFromMirror(prompt: string, hasImageInput = false): boolean {
  if (detectDataChartIntent(prompt)) return true;
  if (hasImageInput && !shouldIncludeImageQwenForTurn(prompt, hasImageInput)) return true;
  return false;
}

export const DATA_CHART_VISUALIZATION = 'data-chart';
export const GENERATED_IMAGE_VISUALIZATION = 'generated-image';

export function buildDataChartTurnPolicyPreseed(opts?: {
  chartSkillName?: string;
  imageToolName?: string;
}): TurnPolicy {
  const chartSkill = opts?.chartSkillName ?? 'chart-output';
  const imageTool = opts?.imageToolName ?? 'image.qwen';
  return {
    ...emptyTurnPolicy(),
    excludeTools: [imageTool],
    pinSkills: [chartSkill],
    visualization: DATA_CHART_VISUALIZATION,
  };
}

export function buildGeneratedImageTurnPolicyPreseed(imageToolName = 'image.qwen'): TurnPolicy {
  return {
    ...emptyTurnPolicy(),
    includeTools: [imageToolName],
    visualization: GENERATED_IMAGE_VISUALIZATION,
  };
}

export function mergeTurnPolicyPreseed(
  envelope: InputEnvelope,
  preseed: TurnPolicy,
): InputEnvelope {
  const existing = envelope.metadata?.turnPolicy;
  if (!existing) {
    return {
      ...envelope,
      metadata: {
        ...envelope.metadata,
        turnPolicy: preseed,
      },
    };
  }
  return {
    ...envelope,
    metadata: {
      ...envelope.metadata,
      turnPolicy: {
        excludeTools: [...new Set([...existing.excludeTools, ...preseed.excludeTools])],
        includeTools: [...new Set([...existing.includeTools, ...preseed.includeTools])],
        explicitSkills: [...existing.explicitSkills],
        excludeSkills: [...new Set([...existing.excludeSkills, ...preseed.excludeSkills])],
        pinSkills: [...new Set([...existing.pinSkills, ...preseed.pinSkills])],
        visualization: preseed.visualization || existing.visualization,
      },
    },
  };
}

export function applyHostTurnPolicyPreseed(
  envelope: InputEnvelope,
  prompt: string,
  registeredToolNames: readonly string[],
): InputEnvelope {
  const hasImageTool = registeredToolNames.includes('image.qwen');
  const hasChartSkill = true;

  if (detectDataChartIntent(prompt) && hasImageTool && hasChartSkill) {
    if (!promptMentionsTool(prompt, 'image.qwen')) {
      return mergeTurnPolicyPreseed(envelope, buildDataChartTurnPolicyPreseed());
    }
  }

  if (detectGeneratedImageIntent(prompt) && hasImageTool) {
    return mergeTurnPolicyPreseed(envelope, buildGeneratedImageTurnPolicyPreseed());
  }

  return envelope;
}

/** Appended to intent agent context so the intent LLM can fill operational lists. */
export const TURN_POLICY_INTENT_ROUTING_APPENDIX = `
### Turn policy (host rules)
- Data charts, statistics, trends, dashboards, or Chinese 图表/可视化/统计图: set turnPolicy.excludeTools to include image.qwen when listed in Agent Context; pinSkills include chart-output; visualization "data-chart". Do not use image.qwen for these requests.
- Generate/draw a picture, illustration, or 文生图/画图: set turnPolicy.includeTools to include image.qwen; visualization "generated-image".
- Never put user-explicit skill/tool selections into exclude lists.
`.trim();
