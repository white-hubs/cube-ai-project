import { describe, expect, it } from "bun:test";

import { extractDescriptorDocumentParts, parseAgentDocument, parseRuleDocument, parseSkillDocument } from "./descriptor-document-parser";

const SKILL_DOC = `---
name: review-pr
description: Review pull requests carefully
displayName: PR 评审
tags: [code, review]
version: 1.2.0
activation:
  mode: manual
resources:
  - path: scripts/run.sh
    type: script
requires: [other-skill]
deprecated: true
---
# Steps

Read the diff, then comment.
`;

const RULE_DOC = `---
name: safety-baseline
description: 安全基线
---
Never reveal credentials.
`;

const AGENT_DOC = `---
name: support-agent
displayName: 客服
modelConfig:
  provider: openai
  model: gpt-4o
  temperature: 0.3
ruleRefs: [safety-baseline]
skillRefs: [review-pr]
availableTools: [search]
subAgentRefs: []
maxDepth: 2
---
You are a helpful support agent.
`;

describe("extractDescriptorDocumentParts", () => {
  it("splits frontmatter and body, tolerating CRLF", () => {
    const { record, body } = extractDescriptorDocumentParts("---\r\nname: x\r\n---\r\nbody line\r\n");
    expect(record["name"]).toBe("x");
    expect(body).toContain("body line");
  });

  it("throws without frontmatter", () => {
    expect(() => extractDescriptorDocumentParts("just markdown")).toThrow("requires YAML frontmatter");
  });

  it("throws when frontmatter is not an object", () => {
    expect(() => extractDescriptorDocumentParts("---\n- a\n- b\n---\nbody")).toThrow("must be an object");
  });
});

describe("parseSkillDocument", () => {
  it("parses valid document; body becomes instructions", () => {
    const { name, content } = parseSkillDocument(SKILL_DOC);
    expect(name).toBe("review-pr");
    expect(content.description).toBe("Review pull requests carefully");
    expect(content.displayName).toBe("PR 评审");
    expect(content.tags).toEqual(["code", "review"]);
    expect(content.version).toBe("1.2.0");
    expect(content.activation).toEqual({ mode: "manual" });
    expect(content.instructions).toContain("Read the diff");
  });

  it("silently drops fields outside the target schema", () => {
    const { content } = parseSkillDocument(SKILL_DOC);
    expect("resources" in content).toBe(false);
    expect("requires" in content).toBe(false);
    expect("deprecated" in content).toBe(false);
  });

  it("accepts object-form and string-shorthand activation (rc.13)", () => {
    const objForm = `---\nname: s\ndescription: d\nactivation:\n  mode: always\n---\nbody\n`;
    expect(parseSkillDocument(objForm).content.activation).toEqual({ mode: "always" });
    const strForm = `---\nname: s\ndescription: d\nactivation: semantic\n---\nbody\n`;
    expect(parseSkillDocument(strForm).content.activation).toEqual({ mode: "semantic" });
  });

  it("is fail-closed on invalid activation mode (rc.13)", () => {
    const doc = `---\nname: s\ndescription: d\nactivation:\n  mode: explicit\n---\nbody\n`;
    expect(() => parseSkillDocument(doc)).toThrow();
  });

  it("rejects missing name / empty body / missing description", () => {
    expect(() => parseSkillDocument("---\ndescription: d\n---\nbody")).toThrow("non-empty frontmatter name");
    expect(() => parseSkillDocument("---\nname: s\ndescription: d\n---\n\n")).toThrow();
    expect(() => parseSkillDocument("---\nname: s\n---\nbody")).toThrow();
  });
});

describe("parseRuleDocument", () => {
  it("parses valid document; body becomes content", () => {
    const { name, content } = parseRuleDocument(RULE_DOC);
    expect(name).toBe("safety-baseline");
    expect(content.description).toBe("安全基线");
    expect(content.content).toBe("Never reveal credentials.");
  });

  it("rejects empty body", () => {
    expect(() => parseRuleDocument("---\nname: r\n---\n")).toThrow();
  });
});

describe("parseAgentDocument", () => {
  it("parses valid document; body becomes prompt", () => {
    const { name, content } = parseAgentDocument(AGENT_DOC);
    expect(name).toBe("support-agent");
    expect(content.prompt).toBe("You are a helpful support agent.");
    expect(content.displayName).toBe("客服");
    expect(content.modelConfig).toEqual({
      provider: "openai",
      model: "gpt-4o",
      temperature: 0.3,
    });
    expect(content.ruleRefs).toEqual(["safety-baseline"]);
    expect(content.skillRefs).toEqual(["review-pr"]);
    expect(content.availableTools).toEqual(["search"]);
    expect(content.maxDepth).toBe(2);
  });

  it("defaults ref arrays when frontmatter omits them", () => {
    const { content } = parseAgentDocument("---\nname: a\n---\nprompt text\n");
    expect(content.ruleRefs).toEqual([]);
    expect(content.skillRefs).toEqual([]);
    expect(content.availableTools).toEqual([]);
    expect(content.subAgentRefs).toEqual([]);
  });

  it("rejects out-of-range modelConfig.temperature", () => {
    const doc = `---\nname: a\nmodelConfig:\n  temperature: 3\n---\nprompt\n`;
    expect(() => parseAgentDocument(doc)).toThrow();
  });
});
