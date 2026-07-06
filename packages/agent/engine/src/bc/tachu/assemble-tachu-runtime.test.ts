import { createDefaultToolCandidateStrategies } from "@tachu/core";
import type { ObservabilityEmitter, ProviderAdapter, TaskExecutor } from "@tachu/core";
import { describe, expect, test } from "bun:test";

import { InMemoryStore } from "@cube-ai/agent-engine/adapters/memory";
import { LlmProviderPortBridge } from "@cube-ai/agent-engine/adapters/provider";
import type { LlmProviderPort } from "@cube-ai/contracts";

import { assembleTachuRuntime, buildDefaultEngineConfig, HOST_POLICY_TOOL_STRATEGY_NAME } from "./assemble-tachu-runtime";
import { createTurnContextHolder } from "./turn-context-holder";

function createCaptureObservability(): ObservabilityEmitter & {
  events: Array<{ payload?: { status?: string } }>;
} {
  const events: Array<{ payload?: { status?: string } }> = [];
  return {
    events,
    emit(event) {
      events.push(event as { payload?: { status?: string } });
    },
    on: () => () => {},
    off: () => {},
    setMasker: () => {},
  };
}

function createEmbedLlmProvider(): LlmProviderPort {
  return {
    async chat() {
      return { content: "ok", finishReason: "stop" };
    },
    async *chatStream() {
      yield { type: "finish" as const, finishReason: "stop" as const };
    },
    async embed(req) {
      return req.input.map(() => ({ dense: [0.1, 0.2, 0.3] }));
    },
  };
}

function createEmbedProvider(): ProviderAdapter {
  return new LlmProviderPortBridge(createEmbedLlmProvider());
}

const noopTaskExecutor: TaskExecutor = async () => ({
  ok: true,
  output: {},
});

describe("assembleTachuRuntime", () => {
  test("embed provider → no projection.disabled warning", () => {
    const observability = createCaptureObservability();
    const turnContext = createTurnContextHolder();
    const memory = new InMemoryStore();
    const result = assembleTachuRuntime({
      provider: createEmbedProvider(),
      observability,
      memorySystem: memory,
      turnContext,
      taskExecutor: noopTaskExecutor,
    });

    expect(result.initWarnings).not.toContain("projection.disabled");
    expect(result.embeddingRuntime).toBeDefined();
    expect(result.vectorIndex).toBeDefined();
    expect(result.memorySystem).toBe(memory);
  });

  test("engine registry has no vectorStore dependency", () => {
    const result = assembleTachuRuntime({
      provider: createEmbedProvider(),
      observability: createCaptureObservability(),
      memorySystem: new InMemoryStore(),
      turnContext: createTurnContextHolder(),
      taskExecutor: noopTaskExecutor,
    });
    expect(result.registry.list("tool")).toEqual([]);
    expect(result.vectorIndex).toBeDefined();
  });

  test("reuses exactly tachu's built-in host gating-policy tool strategy (name pinned across tachu renames)", () => {
    // 守住 assembleTachuRuntime 里 `filter(s => s.name === HOST_POLICY_TOOL_STRATEGY_NAME)` 的前提：
    // tachu 默认策略集里必须恰好有一条该 name 的策略。rc.12 把它从 "intent-turn-policy" 改名为
    // "host-policy"，rc.13 只改 TurnPolicy→GatingPolicy 类型/字段、name 仍是 "host-policy"；若未来再
    // 改名，filter 会静默返回空数组、导致 data-chart/生成图 preseed 失效——这里让它在测试期就红，而不是运行时悄悄坏掉。
    const matches = createDefaultToolCandidateStrategies().filter((s) => s.name === HOST_POLICY_TOOL_STRATEGY_NAME);
    expect(matches).toHaveLength(1);
  });

  test("provider without embed emits projection.disabled", () => {
    const observability = createCaptureObservability();
    const provider: ProviderAdapter = {
      id: "no-embed",
      name: "NoEmbed",
      async listAvailableModels() {
        return [];
      },
      async chat() {
        return { content: "ok", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
      },
      async *chatStream() {
        yield { type: "text-delta", delta: "x" } as const;
        yield { type: "finish", finishReason: "stop" } as const;
      },
    };
    const result = assembleTachuRuntime({
      provider,
      observability,
      memorySystem: new InMemoryStore(),
      turnContext: createTurnContextHolder(),
      taskExecutor: noopTaskExecutor,
    });
    expect(result.initWarnings).toContain("projection.disabled");
    expect(result.embeddingRuntime).toBeUndefined();
  });
});

/**
 * 弱模型工具调用鲁棒性接线（tachu rc.4 姊妹机制，ADR-0031）。
 * 本仓只拥有「声明式配置」——展开/恢复的运行时逻辑住 tachu；这里守住领域取值：
 * 哪些工具是 biz-ontology 查库动作的发现兄弟、开关、恢复重试次数。
 * 名单须与 descriptors/agents/1934000000000000003.yaml 的 availableTools 保持一致。
 */
describe("buildDefaultEngineConfig — weak-model tool-call robustness wiring", () => {
  test("enables discoveryExpansion so pinning query_database also surfaces its 5 biz-ontology discovery siblings", () => {
    const config = buildDefaultEngineConfig("test-provider", "test-model");
    const expansion = config.runtime.toolActivation?.discoveryExpansion;
    expect(expansion?.enabled).toBe(true);
    expect(expansion?.siblings?.["mcp.biz-ontology.query_database"]).toEqual([
      "mcp.biz-ontology.list_databases",
      "mcp.biz-ontology.list_business_domains",
      "mcp.biz-ontology.search_ontology",
      "mcp.biz-ontology.search_by_domain",
      "mcp.biz-ontology.read_ontology",
    ]);
  });

  test("explicitly sets failureRecoveryRetries=1 so a first tool failure forces one recovery step instead of giving up", () => {
    const config = buildDefaultEngineConfig("test-provider", "test-model");
    expect(config.runtime.toolLoop?.failureRecoveryRetries).toBe(1);
  });
});
