/**
 * DescriptorLoader 单测。
 *
 * 对齐：
 *   docs/technical-design/prompts/phase-1/P1-08-tools.md §7
 *   registration-lifecycle.md §3.4（单文件失败不影响其他）
 *
 * 使用 in-memory stub 替代真实 fs（R18 不连外部）。
 */
import { describe, test, expect, mock, afterEach } from "bun:test";
import { basename } from "node:path";

import { DescriptorLoader } from "./descriptor-loader";
import { DescriptorRegistryService } from "./descriptor-registry.service";
import { RuleRegistryService } from "./rule-registry.service";
import { SkillRegistryService } from "./skill-registry.service";
import type { ToolEffectiveVersionSource } from "./tool-effective-version.provider";

const noopPin: ToolEffectiveVersionSource = {
  refreshFromNacos: async () => {},
  getPinnedVersion: async () => undefined,
};

// ---------------------------------------------------------------------------
// 合法 descriptor JSON（用于 mock readFile）
// ---------------------------------------------------------------------------

const VALID_DESCRIPTOR_JSON = JSON.stringify({
  schemaVersion: 1,
  kind: "TOOL",
  name: "platform.file.read",
  displayName: "读取文件",
  isPreset: true,
  version: "1.0.0",
  meta: {
    execution: "LOCAL",
    consent: "ON_FIRST_USE",
    requiresPrincipal: "USER",
    timeoutMs: 15000,
    idempotent: true,
    sideEffects: ["read:platform.file"],
  },
  inputSchema: { type: "object", properties: { fileId: { type: "string" } } },
  outputSchema: { type: "object", properties: { content: { type: "string" } } },
  requires: { principal: "USER", oauthScope: ["file.read"], obo: { audience: "app.file" } },
  execute: "builtin:platform.file.read",
});

const VALID_DESCRIPTOR_2_JSON = JSON.stringify({
  schemaVersion: 1,
  kind: "TOOL",
  name: "memory.recall",
  displayName: "查询对话记忆",
  isPreset: true,
  version: "1.0.0",
  meta: {
    execution: "LOCAL",
    consent: "NEVER",
    requiresPrincipal: "USER",
    timeoutMs: 3000,
    idempotent: true,
    sideEffects: ["read:session.memory"],
  },
  inputSchema: { type: "object", properties: { query: { type: "string" } } },
  outputSchema: { type: "object", properties: { hits: { type: "array" } } },
  requires: { principal: "USER", oauthScope: [], obo: null },
  execute: "builtin:memory.recall",
});

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe("DescriptorLoader", () => {
  afterEach(() => {
    mock.restore();
  });

  test("scan 目录 mock fs → 注册 N 条", async () => {
    // mock node:fs/promises
    mock.module("node:fs/promises", () => ({
      readdir: async (_dir: string) => ["file-read.json", "memory-recall.json"],
      readFile: async (_path: string) => {
        if (_path.includes("file-read")) return VALID_DESCRIPTOR_JSON;
        return VALID_DESCRIPTOR_2_JSON;
      },
    }));

    const registry = new DescriptorRegistryService(noopPin);
    const loader = new DescriptorLoader(registry, noopPin);

    const { loaded, skipped } = await loader.loadFromDir("/mocked/dir");
    expect(loaded).toBe(2);
    expect(skipped).toBe(0);
    expect(registry.size()).toBe(7);
    expect(registry.resolve("currentDate")?.execute).toBe("builtin:engine.current_date");
    expect(registry.resolve("image.qwen")?.execute).toBe("builtin:engine.image_qwen");
    expect(registry.resolve("platform.knowledge.query")?.execute).toBe("builtin:platform.knowledge.query");
    expect(registry.resolve("platform.flow.list")?.execute).toBe("builtin:platform.flow.list");
    expect(registry.resolve("platform.flow.invoke")?.execute).toBe("builtin:platform.flow.invoke");
  });

  test("异常文件不影响其他注册（registration-lifecycle §3.4）", async () => {
    mock.module("node:fs/promises", () => ({
      readdir: async () => ["valid.json", "invalid.json"],
      readFile: async (path: string) => {
        if (basename(path) === "valid.json") return VALID_DESCRIPTOR_JSON;
        return '{ "bad": "json without required fields" }';
      },
    }));

    const registry = new DescriptorRegistryService(noopPin);
    const loader = new DescriptorLoader(registry, noopPin);

    const { loaded, skipped } = await loader.loadFromDir("/mocked/dir");
    expect(loaded).toBe(1);
    expect(skipped).toBe(1);
    expect(registry.size()).toBe(6);
    expect(registry.resolve("currentDate")?.execute).toBe("builtin:engine.current_date");
    expect(registry.resolve("image.qwen")?.execute).toBe("builtin:engine.image_qwen");
    expect(registry.resolve("platform.knowledge.query")?.execute).toBe("builtin:platform.knowledge.query");
  });

  test("readdir 失败 → 返回 {loaded:0, skipped:0}，不 throw", async () => {
    mock.module("node:fs/promises", () => ({
      readdir: async () => {
        throw new Error("ENOENT");
      },
      readFile: async () => "",
    }));

    const registry = new DescriptorRegistryService(noopPin);
    const loader = new DescriptorLoader(registry, noopPin);

    const result = await loader.loadFromDir("/non/existent");
    expect(result).toEqual({ loaded: 0, skipped: 0 });
  });

  test("非 json/yaml 文件被忽略", async () => {
    mock.module("node:fs/promises", () => ({
      readdir: async () => ["README.md", "tool.json"],
      readFile: async (_path: string) => VALID_DESCRIPTOR_JSON,
    }));

    const registry = new DescriptorRegistryService(noopPin);
    const loader = new DescriptorLoader(registry, noopPin);

    const { loaded } = await loader.loadFromDir("/mocked/dir");
    expect(loaded).toBe(1);
  });

  test("可扫描 descriptors/skills 下的 SKILL.md 与 legacy descriptor.yaml", async () => {
    const enoent = () => Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    mock.module("node:fs/promises", () => ({
      readdir: async () => ["chart-output", "default"],
      readFile: async (p: string) => {
        if (p.endsWith("/chart-output/SKILL.md")) {
          return [
            "---",
            "name: chart-output",
            "version: 1.0.0",
            "description: statistics visualization chart output",
            "activation:",
            "  mode: semantic",
            "tags: [chart, visualization]",
            "---",
            "",
            "Use mermaid and echarts fenced blocks.",
          ].join("\n");
        }
        if (p.endsWith("/default/SKILL.md")) throw enoent();
        if (p.endsWith("/default/descriptor.yaml")) {
          return [
            "kind: skill",
            "name: default-reasoning",
            "version: 0.1.0",
            "description: Default reasoning skill",
            "instructions: |",
            "  Think clearly.",
          ].join("\n");
        }
        throw enoent();
      },
    }));

    const registry = new DescriptorRegistryService(noopPin);
    const skillRegistry = new SkillRegistryService();
    const loader = new DescriptorLoader(registry, noopPin, skillRegistry);
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      const result = await loader.loadSkillsFromDir("/repo/descriptors/skills");
      expect(result).toEqual({ loaded: 2, skipped: 0 });
      expect(skillRegistry.resolve("chart-output")?.instructions).toContain("echarts");
      expect(skillRegistry.resolve("chart-output")?.sourceDir).toBe("/repo/descriptors/skills/chart-output");
      expect(skillRegistry.resolve("default-reasoning")?.activation).toEqual({
        mode: "semantic",
      });
      expect(logs.some((line) => line.includes("loaded skill descriptor") && line.includes("chart-output@1.0.0"))).toBe(true);
      expect(
        logs.some((line) => line.includes("skill descriptor scan complete") && line.includes("latest=[chart-output@1.0.0:semantic")),
      ).toBe(true);
    } finally {
      console.log = origLog;
    }
  });

  // tachu rc.13：激活轴统一为 activation（always/manual/semantic/path），旧 trigger 词汇彻底移除。
  // - 非法 activation.mode → fail-closed：加载期抛错，loader 跳过该文件（不静默降级到最宽松档）。
  // - 遗留 `trigger:` 字段 → 退化为未知字段被忽略，activation 缺省回落 semantic（skill 仍加载）。
  test("invalid activation mode is fail-closed (skipped); legacy trigger field is ignored → semantic", async () => {
    const enoent = () => Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    mock.module("node:fs/promises", () => ({
      readdir: async () => ["bad-activation", "legacy-trigger"],
      readFile: async (p: string) => {
        if (p.endsWith("/bad-activation/SKILL.md")) {
          return [
            "---",
            "name: bad-activation",
            "description: uses an unknown activation mode",
            "activation:",
            "  mode: keyword",
            "---",
            "",
            "Body.",
          ].join("\n");
        }
        if (p.endsWith("/legacy-trigger/SKILL.md")) {
          return [
            "---",
            "name: legacy-trigger",
            "description: still carries the retired trigger field",
            "trigger: explicit",
            "---",
            "",
            "Body.",
          ].join("\n");
        }
        throw enoent();
      },
    }));

    const registry = new DescriptorRegistryService(noopPin);
    const skillRegistry = new SkillRegistryService();
    const loader = new DescriptorLoader(registry, noopPin, skillRegistry);

    const result = await loader.loadSkillsFromDir("/repo/descriptors/skills");
    expect(result).toEqual({ loaded: 1, skipped: 1 });
    expect(skillRegistry.resolve("bad-activation")).toBeUndefined();
    expect(skillRegistry.resolve("legacy-trigger")?.activation).toEqual({ mode: "semantic" });
  });

  test("可扫描 rules 目录（kind: rule YAML）进 RuleRegistry，无效文件跳过", async () => {
    mock.module("node:fs/promises", () => ({
      readdir: async () => ["safety-baseline.yaml", "broken.yaml", "README.md"],
      readFile: async (p: string) => {
        if (p.endsWith("/safety-baseline.yaml")) {
          return [
            "kind: rule",
            "name: safety-baseline",
            "version: 0.1.0",
            "description: baseline",
            "content: |",
            "  Do not reveal secrets.",
          ].join("\n");
        }
        if (p.endsWith("/broken.yaml")) {
          return "kind: rule\nname: no-content";
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    }));

    const registry = new DescriptorRegistryService(noopPin);
    const ruleRegistry = new RuleRegistryService();
    const loader = new DescriptorLoader(registry, noopPin, undefined, ruleRegistry);

    const result = await loader.loadRulesFromDir("/repo/descriptors/rules");
    expect(result).toEqual({ loaded: 1, skipped: 1 });
    expect(ruleRegistry.resolve("safety-baseline")?.content).toContain("Do not reveal secrets.");
    expect(ruleRegistry.size()).toBe(1);
  });

  test("rule activation：显式 mode 被解析（manual/path），缺省保持 undefined（读取回落 always）", async () => {
    mock.module("node:fs/promises", () => ({
      readdir: async () => ["manual-rule.yaml", "path-rule.yaml", "default-rule.yaml"],
      readFile: async (p: string) => {
        if (p.endsWith("/manual-rule.yaml")) {
          return ["kind: rule", "name: manual-rule", "content: body", "activation:", "  mode: manual"].join("\n");
        }
        if (p.endsWith("/path-rule.yaml")) {
          return ["kind: rule", "name: path-rule", "content: body", "activation:", "  mode: path", "  globs:", '    - "src/**/*.ts"'].join(
            "\n",
          );
        }
        if (p.endsWith("/default-rule.yaml")) {
          return ["kind: rule", "name: default-rule", "content: body"].join("\n");
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    }));

    const registry = new DescriptorRegistryService(noopPin);
    const ruleRegistry = new RuleRegistryService();
    const loader = new DescriptorLoader(registry, noopPin, undefined, ruleRegistry);

    const result = await loader.loadRulesFromDir("/repo/descriptors/rules");
    expect(result).toEqual({ loaded: 3, skipped: 0 });
    expect(ruleRegistry.resolve("manual-rule")?.activation).toEqual({ mode: "manual" });
    expect(ruleRegistry.resolve("path-rule")?.activation).toEqual({ mode: "path", globs: ["src/**/*.ts"] });
    expect(ruleRegistry.resolve("default-rule")?.activation).toBeUndefined();
  });

  test("rule activation fail-closed：未知 mode / path 缺非空 globs → 跳过（不静默降级到最宽松档）", async () => {
    mock.module("node:fs/promises", () => ({
      readdir: async () => ["bad-mode.yaml", "path-no-globs.yaml"],
      readFile: async (p: string) => {
        if (p.endsWith("/bad-mode.yaml")) {
          return ["kind: rule", "name: bad-mode", "content: body", "activation:", "  mode: sometimes"].join("\n");
        }
        if (p.endsWith("/path-no-globs.yaml")) {
          return ["kind: rule", "name: path-no-globs", "content: body", "activation:", "  mode: path"].join("\n");
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    }));

    const registry = new DescriptorRegistryService(noopPin);
    const ruleRegistry = new RuleRegistryService();
    const loader = new DescriptorLoader(registry, noopPin, undefined, ruleRegistry);

    const result = await loader.loadRulesFromDir("/repo/descriptors/rules");
    expect(result).toEqual({ loaded: 0, skipped: 2 });
    expect(ruleRegistry.size()).toBe(0);
  });

  test("SKILL.md 优先于同目录 legacy descriptor.yaml", async () => {
    const readPaths: string[] = [];
    mock.module("node:fs/promises", () => ({
      readdir: async () => ["chart-output"],
      readFile: async (p: string) => {
        readPaths.push(p);
        if (p.endsWith("/chart-output/SKILL.md")) {
          return ["---", "name: chart-output", "description: markdown source", "---", "markdown instructions"].join("\n");
        }
        throw Object.assign(new Error("should not read legacy descriptor"), {
          code: "ENOENT",
        });
      },
    }));

    const registry = new DescriptorRegistryService(noopPin);
    const skillRegistry = new SkillRegistryService();
    const loader = new DescriptorLoader(registry, noopPin, skillRegistry);

    await loader.loadSkillsFromDir("/repo/descriptors/skills");
    expect(skillRegistry.resolve("chart-output")?.instructions).toBe("markdown instructions");
    expect(readPaths.some((p) => p.endsWith("/chart-output/descriptor.yaml"))).toBe(false);
  });

  test("可扫描 agents 目录并建立 name->path 索引（lazy 前置）", async () => {
    mock.module("node:fs/promises", () => ({
      readdir: async () => ["cube-default.yaml", "ignored.md"],
      readFile: async (p: string) => {
        if (p.includes("cube-default.yaml")) {
          return [
            "kind: agent",
            "name: cube-default",
            "description: default agent",
            "idempotent: false",
            "requiresApproval: false",
            "timeout: 120000",
            "maxDepth: 4",
            "instructions: hi",
          ].join("\n");
        }
        return "";
      },
    }));

    const registry = new DescriptorRegistryService(noopPin);
    const loader = new DescriptorLoader(registry, noopPin);

    const { indexed, skipped } = await loader.buildAgentIndexFromDir("/mocked/agents");
    expect(indexed).toBe(1);
    expect(skipped).toBe(0);
    expect(loader.getIndexedAgentPath("cube-default")).toBe("/mocked/agents/cube-default.yaml");
  });

  test("可加载并缓存仓库 CUBE.md 全局提示词", async () => {
    mock.module("node:fs/promises", () => ({
      readdir: async () => [],
      readFile: async (p: string) => {
        if (p.includes("CUBE.md")) return "# global prompt";
        return "";
      },
    }));

    const registry = new DescriptorRegistryService(noopPin);
    const loader = new DescriptorLoader(registry, noopPin);

    const content = await loader.loadGlobalPrompt("/repo/CUBE.md");
    expect(content).toBe("# global prompt");
    expect(loader.getGlobalPrompt()).toBe("# global prompt");
  });

  test("start() 冷启动优先加载 CUBE.md 与 agents 索引", async () => {
    const registry = new DescriptorRegistryService(noopPin);
    const loader = new DescriptorLoader(registry, noopPin);
    const loadGlobalPrompt = mock(async () => "");
    const buildAgentIndexFromDir = mock(async () => ({ indexed: 0, skipped: 0 }));
    loader.loadGlobalPrompt = loadGlobalPrompt;
    loader.buildAgentIndexFromDir = buildAgentIndexFromDir;

    const prevPromptPath = process.env.AGENTIC_ENGINE_GLOBAL_PROMPT_PATH;
    const prevAgentDir = process.env.AGENTIC_ENGINE_AGENT_DESCRIPTOR_DIR;
    const prevNacos = process.env.AGENTIC_ENGINE_NACOS_URL;
    process.env.AGENTIC_ENGINE_GLOBAL_PROMPT_PATH = "/repo/CUBE.md";
    process.env.AGENTIC_ENGINE_AGENT_DESCRIPTOR_DIR = "/repo/descriptors/agents";
    delete process.env.AGENTIC_ENGINE_NACOS_URL;

    try {
      await loader.start();
      expect(loadGlobalPrompt).toHaveBeenCalledWith("/repo/CUBE.md");
      expect(buildAgentIndexFromDir).toHaveBeenCalledWith("/repo/descriptors/agents");
    } finally {
      loader.stopPolling();
      if (prevPromptPath === undefined) delete process.env.AGENTIC_ENGINE_GLOBAL_PROMPT_PATH;
      else process.env.AGENTIC_ENGINE_GLOBAL_PROMPT_PATH = prevPromptPath;
      if (prevAgentDir === undefined) delete process.env.AGENTIC_ENGINE_AGENT_DESCRIPTOR_DIR;
      else process.env.AGENTIC_ENGINE_AGENT_DESCRIPTOR_DIR = prevAgentDir;
      if (prevNacos === undefined) delete process.env.AGENTIC_ENGINE_NACOS_URL;
      else process.env.AGENTIC_ENGINE_NACOS_URL = prevNacos;
    }
  });

  test("getAgent 可按 name 懒加载 agent 描述并命中缓存", async () => {
    const readCalls: string[] = [];
    mock.module("node:fs/promises", () => ({
      readdir: async () => ["cube-default.yaml"],
      readFile: async (p: string) => {
        readCalls.push(p);
        return [
          "kind: agent",
          "name: cube-default",
          "description: default agent",
          "idempotent: false",
          "requiresApproval: false",
          "timeout: 120000",
          "maxDepth: 4",
          "instructions: hi",
        ].join("\n");
      },
    }));

    const registry = new DescriptorRegistryService(noopPin);
    const loader = new DescriptorLoader(registry, noopPin);
    await loader.buildAgentIndexFromDir("/mocked/agents");

    const first = await loader.getAgent("cube-default");
    const second = await loader.getAgent("cube-default");

    expect((first as { name?: string }).name).toBe("cube-default");
    expect((second as { name?: string }).name).toBe("cube-default");
    expect(readCalls.filter((x) => x.includes("cube-default.yaml")).length).toBe(2);
  });

  test("getAgent 对未索引名称返回 null", async () => {
    const registry = new DescriptorRegistryService(noopPin);
    const loader = new DescriptorLoader(registry, noopPin);
    const got = await loader.getAgent("missing-agent");
    expect(got).toBeNull();
  });

  describe("dev-only agent placeholder report (DEPLOY_ENV gate)", () => {
    /** 构造内置两个 dev 占位 + 一个常规 cube-default 的 agentIndex 场景 */
    function mockAgentDirWithSfidPlaceholders(): void {
      mock.module("node:fs/promises", () => ({
        readdir: async () => ["1934000000000000001.yaml", "1934000000000000002.yaml", "cube-default.yaml"],
        readFile: async (p: string) => {
          if (p.endsWith("1934000000000000001.yaml")) {
            return [
              "kind: agent",
              "name: '1934000000000000001'",
              "description: dev placeholder",
              "idempotent: false",
              "requiresApproval: false",
              "timeout: 120000",
              "maxDepth: 4",
              "instructions: stub",
            ].join("\n");
          }
          if (p.endsWith("1934000000000000002.yaml")) {
            return [
              "kind: agent",
              "name: '1934000000000000002'",
              "description: dev placeholder",
              "idempotent: false",
              "requiresApproval: false",
              "timeout: 120000",
              "maxDepth: 4",
              "instructions: stub",
            ].join("\n");
          }
          return [
            "kind: agent",
            "name: cube-default",
            "description: default agent",
            "idempotent: false",
            "requiresApproval: false",
            "timeout: 120000",
            "maxDepth: 4",
            "instructions: hi",
          ].join("\n");
        },
      }));
    }

    test("DEPLOY_ENV=DEV 时打 INFO 列出 SFID 命名的占位 agent", async () => {
      mockAgentDirWithSfidPlaceholders();
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };
      const prevEnv = process.env.DEPLOY_ENV;
      const prevAgentDir = process.env.AGENTIC_ENGINE_AGENT_DESCRIPTOR_DIR;
      const prevNacos = process.env.AGENTIC_ENGINE_NACOS_URL;
      process.env.DEPLOY_ENV = "DEV";
      process.env.AGENTIC_ENGINE_AGENT_DESCRIPTOR_DIR = "/mocked/agents";
      delete process.env.AGENTIC_ENGINE_NACOS_URL;

      try {
        const registry = new DescriptorRegistryService(noopPin);
        const loader = new DescriptorLoader(registry, noopPin);
        loader.loadGlobalPrompt = mock(async () => "");
        await loader.start();

        const hit = logs.find(
          (line) =>
            line.includes("Loaded 2 dev-only agent descriptor(s)") &&
            line.includes("1934000000000000001") &&
            line.includes("1934000000000000002"),
        );
        expect(hit).toBeDefined();
      } finally {
        console.log = origLog;
        if (prevEnv === undefined) delete process.env.DEPLOY_ENV;
        else process.env.DEPLOY_ENV = prevEnv;
        if (prevAgentDir === undefined) delete process.env.AGENTIC_ENGINE_AGENT_DESCRIPTOR_DIR;
        else process.env.AGENTIC_ENGINE_AGENT_DESCRIPTOR_DIR = prevAgentDir;
        if (prevNacos === undefined) delete process.env.AGENTIC_ENGINE_NACOS_URL;
        else process.env.AGENTIC_ENGINE_NACOS_URL = prevNacos;
      }
    });

    test("DEPLOY_ENV=PROD 时打 WARN 提醒占位不应进入更高环境", async () => {
      mockAgentDirWithSfidPlaceholders();
      const warns: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        warns.push(args.map(String).join(" "));
      };
      const prevEnv = process.env.DEPLOY_ENV;
      const prevAgentDir = process.env.AGENTIC_ENGINE_AGENT_DESCRIPTOR_DIR;
      const prevNacos = process.env.AGENTIC_ENGINE_NACOS_URL;
      process.env.DEPLOY_ENV = "PROD";
      process.env.AGENTIC_ENGINE_AGENT_DESCRIPTOR_DIR = "/mocked/agents";
      delete process.env.AGENTIC_ENGINE_NACOS_URL;

      try {
        const registry = new DescriptorRegistryService(noopPin);
        const loader = new DescriptorLoader(registry, noopPin);
        loader.loadGlobalPrompt = mock(async () => "");
        await loader.start();

        const hit = warns.find((line) => line.includes("Detected 2 dev-only agent descriptor(s)") && line.includes("DEPLOY_ENV=PROD"));
        expect(hit).toBeDefined();
      } finally {
        console.warn = origWarn;
        if (prevEnv === undefined) delete process.env.DEPLOY_ENV;
        else process.env.DEPLOY_ENV = prevEnv;
        if (prevAgentDir === undefined) delete process.env.AGENTIC_ENGINE_AGENT_DESCRIPTOR_DIR;
        else process.env.AGENTIC_ENGINE_AGENT_DESCRIPTOR_DIR = prevAgentDir;
        if (prevNacos === undefined) delete process.env.AGENTIC_ENGINE_NACOS_URL;
        else process.env.AGENTIC_ENGINE_NACOS_URL = prevNacos;
      }
    });

    test("无 SFID 命名 agent 时既不打 INFO 也不打 WARN", async () => {
      mock.module("node:fs/promises", () => ({
        readdir: async () => ["cube-default.yaml"],
        readFile: async () =>
          [
            "kind: agent",
            "name: cube-default",
            "description: default agent",
            "idempotent: false",
            "requiresApproval: false",
            "timeout: 120000",
            "maxDepth: 4",
            "instructions: hi",
          ].join("\n"),
      }));
      const logs: string[] = [];
      const warns: string[] = [];
      const origLog = console.log;
      const origWarn = console.warn;
      console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
      console.warn = (...args: unknown[]) => warns.push(args.map(String).join(" "));
      const prevEnv = process.env.DEPLOY_ENV;
      const prevAgentDir = process.env.AGENTIC_ENGINE_AGENT_DESCRIPTOR_DIR;
      const prevNacos = process.env.AGENTIC_ENGINE_NACOS_URL;
      process.env.DEPLOY_ENV = "DEV";
      process.env.AGENTIC_ENGINE_AGENT_DESCRIPTOR_DIR = "/mocked/agents";
      delete process.env.AGENTIC_ENGINE_NACOS_URL;

      try {
        const registry = new DescriptorRegistryService(noopPin);
        const loader = new DescriptorLoader(registry, noopPin);
        loader.loadGlobalPrompt = mock(async () => "");
        await loader.start();

        expect(logs.find((l) => l.includes("dev-only agent descriptor"))).toBeUndefined();
        expect(warns.find((l) => l.includes("dev-only agent descriptor"))).toBeUndefined();
      } finally {
        console.log = origLog;
        console.warn = origWarn;
        if (prevEnv === undefined) delete process.env.DEPLOY_ENV;
        else process.env.DEPLOY_ENV = prevEnv;
        if (prevAgentDir === undefined) delete process.env.AGENTIC_ENGINE_AGENT_DESCRIPTOR_DIR;
        else process.env.AGENTIC_ENGINE_AGENT_DESCRIPTOR_DIR = prevAgentDir;
        if (prevNacos === undefined) delete process.env.AGENTIC_ENGINE_NACOS_URL;
        else process.env.AGENTIC_ENGINE_NACOS_URL = prevNacos;
      }
    });
  });
});
