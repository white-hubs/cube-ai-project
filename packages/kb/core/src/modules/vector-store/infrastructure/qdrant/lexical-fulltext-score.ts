import { LEXICAL_FIELD_WEIGHTS, type LexicalScoreField } from "./lexical-field-weights";

/** FULLTEXT 主索引列（与 V003 / MATCH 列表一致）。 */
export const LEXICAL_FULLTEXT_FIELDS = [
  "text_content",
  "embedding_text",
  "heading_path",
  "keywords_text",
  "headers_text",
] as const satisfies readonly LexicalScoreField[];

/** 短字段：保留 LIKE OR 兜底（不入 FULLTEXT）。 */
export const LEXICAL_SHORT_LIKE_FIELDS = [
  "start_time",
  "end_time",
  "sheet_name",
  "property_namespace",
] as const satisfies readonly LexicalScoreField[];

const BOOLEAN_SPECIAL_CHARS = /[+\-><()~*"@\\]/gu;

/**
 * maxJsComparable：FULLTEXT 主列 exact 权重之和（唯一权重表 `LEXICAL_FIELD_WEIGHTS`）。
 * 短字段 LIKE bonus 另行叠加，不占用此上限。
 */
export function maxJsComparableFulltextScore(): number {
  let total = 0;
  for (const field of LEXICAL_FULLTEXT_FIELDS) {
    total += LEXICAL_FIELD_WEIGHTS[field].exact;
  }
  return total;
}

/**
 * 构造 BOOLEAN MODE 查询串（词之间 OR，与旧 LIKE OR 语义接近）。
 * 剥离 MySQL boolean 特殊字符；含空格的短语加双引号。
 */
export function escapeFulltextBooleanToken(token: string): string {
  const cleaned = token.replace(BOOLEAN_SPECIAL_CHARS, " ").replace(/\s+/gu, " ").trim();
  if (cleaned === "") {
    return "";
  }
  if (cleaned.includes(" ")) {
    return `"${cleaned}"`;
  }
  return cleaned;
}

export function buildFulltextAgainstQuery(query: string, terms: string[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const raw of [query, ...terms]) {
    const escaped = escapeFulltextBooleanToken(raw);
    if (escaped === "" || seen.has(escaped)) {
      continue;
    }
    seen.add(escaped);
    parts.push(escaped);
  }
  return parts.join(" ");
}

/**
 * 窗口内 FULLTEXT raw MATCH 分 → 与旧 JS lexical 量级可比的分数。
 *
 * 公式（W3.4-H1/H4）：
 *   1. t_i = log1p(max(0, raw_i))
 *   2. 若 max(t)=min(t)：凡 t>0 映射为 maxJsComparable，否则 0
 *   3. 否则 min-max：((t_i - min) / (max - min)) * maxJsComparable
 *
 * 禁止把 raw MATCH 直接送入 hybrid（× LEXICAL_SCORE_WEIGHT）。
 */
export function normalizeFulltextScores(rawScores: number[], maxJsComparable: number): number[] {
  if (rawScores.length === 0) {
    return [];
  }
  const ceiling = Number.isFinite(maxJsComparable) && maxJsComparable > 0 ? maxJsComparable : 0;
  const logged = rawScores.map((raw) => Math.log1p(Math.max(0, Number.isFinite(raw) ? raw : 0)));
  let min = logged[0]!;
  let max = logged[0]!;
  for (const value of logged) {
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
  }
  if (max === min) {
    return logged.map((value) => (value > 0 ? ceiling : 0));
  }
  const span = max - min;
  return logged.map((value) => ((value - min) / span) * ceiling);
}

/** 短字段 LIKE 语义 bonus；权重仍来自 `LEXICAL_FIELD_WEIGHTS`。 */
export function calculateShortFieldLexicalBonus(row: Record<string, unknown>, query: string, terms: string[]): number {
  const scoreField = (value: unknown, exactWeight: number, termWeight: number): number => {
    if (typeof value !== "string" || value.trim() === "") {
      return 0;
    }
    const haystack = value.toLowerCase();
    let score = query !== "" && haystack.includes(query) ? exactWeight : 0;
    for (const term of terms) {
      if (term !== "" && haystack.includes(term)) {
        score += termWeight;
      }
    }
    return score;
  };

  let total = 0;
  for (const field of LEXICAL_SHORT_LIKE_FIELDS) {
    const weights = LEXICAL_FIELD_WEIGHTS[field];
    total += scoreField(row[field], weights.exact, weights.term);
  }
  return total;
}

/** MATCH 列列表 SQL 片段（顺序与索引一致）。 */
export function fulltextMatchColumnsSql(): string {
  return LEXICAL_FULLTEXT_FIELDS.join(", ");
}
