import { descriptorMetadataText, type SkillDescriptor } from '@tachu/core';

export type KeywordMatch = {
  skill: SkillDescriptor;
  score: number;
  reason: string;
  promote: boolean;
};

const normalizeForMatch = (text: string): string =>
  text
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。、；：！？,.;:!?'"`]/g, '');

function buildIndexText(skill: SkillDescriptor): string {
  return normalizeForMatch(
    descriptorMetadataText({
      name: skill.name,
      ...(skill.displayName !== undefined ? { displayName: skill.displayName } : {}),
      description: skill.description,
      ...(skill.tags !== undefined ? { tags: [...skill.tags] } : {}),
    }),
  );
}

function extractCjkNgrams(text: string, minLen = 2, maxLen = 4): string[] {
  const chars = [...text].filter((c) => /[\u4e00-\u9fa5]/u.test(c));
  const grams = new Set<string>();
  for (let len = minLen; len <= maxLen; len += 1) {
    for (let i = 0; i + len <= chars.length; i += 1) {
      grams.add(chars.slice(i, i + len).join(''));
    }
  }
  return [...grams];
}

function queryTokens(query: string): string[] {
  const normalized = normalizeForMatch(query);
  const tokens: string[] = [];
  if (normalized.length > 0) {
    tokens.push(normalized);
  }
  for (const part of query.split(/[^a-z0-9\u4e00-\u9fa5]+/iu)) {
    const t = normalizeForMatch(part);
    if (t.length >= 2) {
      tokens.push(t);
    }
  }
  for (const gram of extractCjkNgrams(query)) {
    tokens.push(normalizeForMatch(gram));
  }
  return [...new Set(tokens)];
}

/**
 * Keyword / substring candidate scoring (ADR-0023 §D3). No `aliases` field required.
 */
export function scoreSkillsByKeyword(
  query: string,
  skills: readonly SkillDescriptor[],
  opts?: { excludeNames?: ReadonlySet<string> },
): KeywordMatch[] {
  const exclude = opts?.excludeNames ?? new Set<string>();
  const tokens = queryTokens(query);
  if (tokens.length === 0) {
    return [];
  }

  const matches: KeywordMatch[] = [];
  for (const skill of skills) {
    if (exclude.has(skill.name) || skill.deprecated === true) {
      continue;
    }
    if (skill.trigger?.type === 'explicit') {
      continue;
    }

    const index = buildIndexText(skill);
    const nameNorm = normalizeForMatch(skill.name);
    const nameLoose = nameNorm.replace(/-/g, '');
    const displayNorm = skill.displayName
      ? normalizeForMatch(skill.displayName)
      : '';
    const queryNorm = normalizeForMatch(query);

    let best = 0;
    let reason = 'keyword:no-match';

    if (
      queryNorm.includes(nameNorm) ||
      (nameLoose.length >= 3 && queryNorm.includes(nameLoose))
    ) {
      best = 1;
      reason = 'keyword:exact-name';
    } else if (displayNorm.length > 0 && queryNorm.includes(displayNorm)) {
      best = 1;
      reason = 'keyword:exact-display';
    }

    for (const token of tokens) {
      if (best >= 1) break;
      if (token.length === 0) continue;
      if (token === nameNorm || (displayNorm.length > 0 && token === displayNorm)) {
        best = 1;
        reason = 'keyword:exact-name';
        break;
      }
      if (nameNorm.includes(token) || (displayNorm.length > 0 && displayNorm.includes(token))) {
        const partial = Math.min(1, token.length / Math.max(nameNorm.length, displayNorm.length, 1));
        if (partial > best) {
          best = Math.max(best, 0.85);
          reason = 'keyword:name-substring';
        }
      }
      if (index.includes(token)) {
        const partial = Math.min(1, token.length / Math.max(index.length, 1));
        if (partial > best) {
          best = Math.max(best, partial * 0.75);
          reason = 'keyword:description-substring';
        }
      }
    }

    if (best <= 0) {
      continue;
    }

    const explicitSkillIntent =
      /(?:使用|用)[\u4e00-\u9fa5a-z0-9-]{2,40}技能/u.test(query) ||
      /(?:load|use)\s+[\w-]+\s+skill/i.test(query);

    const chartIntent =
      (queryNorm.includes('图表') || queryNorm.includes('可视化')) &&
      (skill.tags?.includes('chart') === true || skill.name === 'chart-output');

    let promote =
      reason === 'keyword:exact-name' ||
      reason === 'keyword:exact-display' ||
      reason === 'keyword:name-substring' ||
      (explicitSkillIntent && best >= 0.003) ||
      chartIntent;

    if (chartIntent && best < 0.9) {
      best = 0.9;
      reason = 'keyword:chart-intent';
    } else if (explicitSkillIntent && !promote) {
      promote = true;
      reason = `${reason}+explicit-skill-intent`;
    } else if (explicitSkillIntent && promote) {
      reason = `${reason}+explicit-skill-intent`;
    }

    matches.push({ skill, score: best, reason, promote });
  }

  return matches.sort((a, b) => b.score - a.score);
}
