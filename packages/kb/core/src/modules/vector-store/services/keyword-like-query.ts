/**
 * Shared short-term / keyword-like query gate (retrieval + query rewrite skip).
 * Natural-language questions must not take this path.
 */

export function normalizeForKeywordMatch(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll(/[^\p{Letter}\p{Number}\s]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

/**
 * 短词 / 编码类 query：要求正文、标题或关键词至少命中一个 query term。
 * 自然语言问句返回 false，避免误杀同义语义召回 / 跳过改写。
 */
export function isKeywordLikeQuery(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed === "") {
    return false;
  }
  if (/[?？]/u.test(trimmed)) {
    return false;
  }
  if (/(如何|怎么|什么|为什么|怎样|哪些|how\b|what\b|why\b|which\b|where\b)/iu.test(trimmed)) {
    return false;
  }
  const normalized = normalizeForKeywordMatch(trimmed);
  const tokens = normalized.split(" ").filter((token) => token !== "");
  if (tokens.length >= 2) {
    return tokens.every((token) => /\d/u.test(token) || token.length <= 3);
  }
  return normalized.length > 0 && normalized.length <= 12;
}
