/**
 * Detect when the user explicitly names registered tools in the prompt.
 */
export function findExplicitToolMentions(
  prompt: string,
  toolNames: readonly string[],
): string[] {
  const trimmed = prompt.trim();
  if (trimmed.length === 0 || toolNames.length === 0) return [];

  const lower = trimmed.toLowerCase();
  const hits: string[] = [];
  const seen = new Set<string>();

  const sorted = [...toolNames].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    const key = name.trim();
    if (key.length === 0 || seen.has(key)) continue;
    if (lower.includes(key.toLowerCase())) {
      seen.add(key);
      hits.push(key);
    }
  }
  return hits;
}
