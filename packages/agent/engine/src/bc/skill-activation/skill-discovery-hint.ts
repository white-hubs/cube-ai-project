export const SKILL_DISCOVERY_PROMPT_SUFFIX = `## Skill Discovery

Follow any skill listed under **Active Skills** in the system prompt (full instructions).

**Available Skills** is a discovery menu — each entry shows a skill's name and a short description, not its full contract. You only gain a skill's full instructions once it appears under Active Skills.

Do not output raw tool-call syntax in user-visible text: no \`<tool_call>\`, \`load_skill\`, or \`search_skills\` blocks. Those tools exist only on the agentic tool-use path; on turns where you answer without calling any tool, obey Active Skills or answer without pretending to invoke tools.`;

export function appendSkillDiscoveryHint(systemInstruction: string): string {
  const trimmed = systemInstruction.trim();
  if (trimmed.length === 0) {
    return SKILL_DISCOVERY_PROMPT_SUFFIX;
  }
  if (trimmed.includes("## Skill Discovery")) {
    return trimmed;
  }
  return `${trimmed}\n\n${SKILL_DISCOVERY_PROMPT_SUFFIX}`;
}
