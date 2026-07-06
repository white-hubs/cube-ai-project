import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildDefaultEngineConfig } from "./assemble-tachu-runtime";
import {
  CUBE_GLOBAL_INSTRUCTIONS_REF,
  CUBE_TOOL_USE_SYSTEM_PROMPT_BASE,
  CUBE_TOOL_USE_SYSTEM_PROMPT_SUFFIX,
  CUBE_VALIDATION_SEMANTIC_JUDGE_SYSTEM_PROMPT_BASE,
} from "./cube-engine-prompt-overrides";

const CUBE_MD = readFileSync(join(import.meta.dir, "../../../CUBE.md"), "utf8");

describe("buildDefaultEngineConfig prompt overrides (rc.10 深单 loop)", () => {
  test("wires cube tool-use + validation host prompt fields", () => {
    const config = buildDefaultEngineConfig("test-provider", "test-model");
    expect(config.toolUse?.systemPromptBase).toBe(CUBE_TOOL_USE_SYSTEM_PROMPT_BASE);
    expect(config.toolUse?.systemPromptSuffix).toBe(CUBE_TOOL_USE_SYSTEM_PROMPT_SUFFIX);
    expect(config.validation?.semanticJudgeSystemPromptBase).toBe(CUBE_VALIDATION_SEMANTIC_JUDGE_SYSTEM_PROMPT_BASE);
  });

  test("no removed phase config keys leak into EngineConfig", () => {
    const config = buildDefaultEngineConfig("test-provider", "test-model") as Record<string, unknown>;
    expect(config["intent"]).toBeUndefined();
    expect(config["directAnswer"]).toBeUndefined();
    expect((config["toolUse"] as Record<string, unknown>)["finalAnswerSystemPromptBase"]).toBeUndefined();
  });
});

describe("deep single-loop terminal reply guardrails (salvaged from removed direct/final-answer)", () => {
  // final-answer 写手 + direct-answer 子流程在 rc.10 删除后，其防护条款必须落进
  // loop 自己的 system prompt——否则无工具轮的终稿会丢失这些护栏（rc.10 迁移）。
  test("tool-use base carries the no-empty-promise guard (was in direct-answer)", () => {
    expect(CUBE_TOOL_USE_SYSTEM_PROMPT_BASE).toContain("No empty promises");
    expect(CUBE_TOOL_USE_SYSTEM_PROMPT_BASE).toContain("请稍等");
    expect(CUBE_TOOL_USE_SYSTEM_PROMPT_BASE).toMatch(/do not turn things you did not do into past-tense/i);
  });

  test("tool-use suffix carries the no-internal-leak guard (was in final-answer writer)", () => {
    expect(CUBE_TOOL_USE_SYSTEM_PROMPT_SUFFIX).toMatch(/internal engine phases/i);
  });
});

describe("validation semantic judge base preserves tachu JSON contract and business flags", () => {
  test("keeps findings contract + policy flags", () => {
    const base = CUBE_VALIDATION_SEMANTIC_JUDGE_SYSTEM_PROMPT_BASE;
    expect(base).toContain('"findings":[]');
    expect(base).toContain("system prompts");
    expect(base).toContain("Promises future actions");
  });
});

describe("CUBE.md ↔ loop prompt consistency", () => {
  test("tool-use base defers to Global Instructions rather than duplicating extraction policy", () => {
    expect(CUBE_TOOL_USE_SYSTEM_PROMPT_BASE).toContain(CUBE_GLOBAL_INSTRUCTIONS_REF);
    expect(CUBE_MD).toMatch(/quote, paraphrase, summarize, or reconstruct/i);
  });
});
