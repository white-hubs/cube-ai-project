import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

describe("html-output skill descriptor (shipped file)", () => {
  const skillDir = join(import.meta.dir, "..", "..", "..", "..", "..", "..", "descriptors", "skills", "html-output");
  const raw = readFileSync(join(skillDir, "SKILL.md"), "utf8");
  const scenarios = [
    "security-report",
    "general-report",
    "business-analysis",
    "bi-report",
    "bi-dashboard",
    "topology-report",
    "tech-report",
    "process-report",
  ];

  it("parses and preserves semantic activation + the html-output contract", () => {
    const { name, content } = parseSkillDocument(raw);
    expect(name).toBe("html-output");
    expect(content.activation).toEqual({ mode: "semantic" });
    expect(content.tags).toContain("report");
    expect(content.tags).toContain("dashboard");
    // 主纲为纯 index（完整示例已下沉 references/），契约与白名单硬约束仍在正文
    expect(content.instructions).toContain("html-output 契约");
    expect(content.instructions).toContain("白名单");
    expect(content.instructions).toContain("自包含");
  });

  it("declares progressive-disclosure resources (catalog + 8 scenarios) that all exist on disk", () => {
    // cube loader 从 frontmatter 读 resources（read_skill_resource 白名单键）；逐条须真实存在
    const paths = [...raw.matchAll(/- path:\s*(references\/[\w-]+\.md)/gu)].map((m) => m[1]);
    expect(paths).toContain("references/cdn-catalog.md");
    expect(paths.length).toBe(scenarios.length + 1);
    for (const p of paths) {
      expect(existsSync(join(skillDir, p))).toBe(true);
    }
  });

  it("every scenario reference embeds a runnable html-output fence (full document)", () => {
    for (const s of scenarios) {
      const body = readFileSync(join(skillDir, "references", `${s}.md`), "utf8");
      expect(body).toContain("```html-output");
      expect(body).toContain("<!doctype html>");
      expect(body).toContain("https://r.kaiheai.com/modules/");
    }
  });

  it("references never load from a CDN outside the r.kaiheai.com whitelist", () => {
    const offListHosts = [
      "cdn.jsdelivr.net",
      "unpkg.com",
      "cdnjs.cloudflare.com",
      "cdn.tailwindcss.com",
      "fonts.googleapis.com",
      "fonts.gstatic.com",
    ];
    for (const f of ["cdn-catalog.md", ...scenarios.map((s) => `${s}.md`)]) {
      const body = readFileSync(join(skillDir, "references", f), "utf8");
      for (const host of offListHosts) {
        expect(body).not.toContain(host);
      }
    }
  });

  it("contract forbids the <html-output> XML-tag form; fence-only (mirrors chart-output)", () => {
    const { content } = parseSkillDocument(raw);
    // 模型曾用 <html-output>…</html-output> 尖括号标签绕过围栏 → 契约与自检必须显式堵死
    expect(content.instructions).toContain("<html-output>");
    expect(content.instructions).toContain("严禁");
    // 契约 + 自检清单各出现一次「尖括号」哨兵，确保两处都补上了「围栏 ≠ 标签」这条
    expect((content.instructions.match(/尖括号/gu) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("scenario references wrap the report in a fence, never a bare <html-output> tag", () => {
    for (const s of scenarios) {
      const body = readFileSync(join(skillDir, "references", `${s}.md`), "utf8");
      expect(body).not.toContain("<html-output");
    }
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
