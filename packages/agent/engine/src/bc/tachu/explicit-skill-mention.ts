/**
 * Detect when the user explicitly names registered skills in the prompt.
 * Covers `/skill-name`, `@skill-name`, and bare skill name mentions.
 */
export function findExplicitSkillMentions(
  prompt: string,
  skillNames: readonly string[],
): string[] {
  const trimmed = prompt.trim();
  if (trimmed.length === 0 || skillNames.length === 0) return [];

  const lower = trimmed.toLowerCase();
  const hits: string[] = [];
  const seen = new Set<string>();

  const sorted = [...skillNames].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    const key = name.trim();
    if (key.length === 0 || seen.has(key)) continue;
    const keyLower = key.toLowerCase();
    if (
      lower.includes(`/${keyLower}`) ||
      lower.includes(`@${keyLower}`) ||
      lower.includes(keyLower)
    ) {
      seen.add(key);
      hits.push(key);
    }
  }
  return hits;
}
