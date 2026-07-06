/**
 * Detect rules the user explicitly named this turn.
 *
 * Unlike {@link findExplicitSkillMentions}, rules match **only** the sigil forms
 * `@rule-name` / `/rule-name` — never a bare substring. Rule names are often common
 * words (e.g. `safety`), and a bare-substring match would fire the rule on any prompt
 * that merely mentions the word, silently injecting constraints the user never invoked.
 * Sigil-only keeps `activation: manual` honest: a manual rule activates iff explicitly called.
 */
export function findExplicitRuleMentions(prompt: string, ruleNames: readonly string[]): string[] {
  const trimmed = prompt.trim();
  if (trimmed.length === 0 || ruleNames.length === 0) return [];

  const lower = trimmed.toLowerCase();
  const hits: string[] = [];
  const seen = new Set<string>();

  // Longest-first so `@foo-bar` prefers `foo-bar` over a shorter `foo`.
  const sorted = [...ruleNames].toSorted((a, b) => b.length - a.length);
  for (const name of sorted) {
    const key = name.trim();
    if (key.length === 0 || seen.has(key)) continue;
    const keyLower = key.toLowerCase();
    if (lower.includes(`@${keyLower}`) || lower.includes(`/${keyLower}`)) {
      seen.add(key);
      hits.push(key);
    }
  }
  return hits;
}
