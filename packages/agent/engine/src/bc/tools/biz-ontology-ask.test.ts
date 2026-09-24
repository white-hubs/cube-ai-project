import { describe, expect, test } from "bun:test";

import {
  AskBusinessDataStepGate,
  askQuestionFromModel,
  bizOntologyUrlFromAddress,
  normalizeBizOntologyServerConfig,
} from "./biz-ontology-address";
import { stampAskArguments } from "./biz-ontology-ask";
import { McpBridgeService } from "./mcp-bridge.service";
import type { ToolHandlerCtx } from "./tool-context";

const PROMPT = "今年报警数量，另外今天天气，再查超时率";

describe("askQuestionFromModel", () => {
  test("keeps a rewritten business question", () => {
    expect(askQuestionFromModel("今年报警数量，再查超时率", PROMPT)).toBe("今年报警数量，再查超时率");
  });

  test("rejects a paraphrase and keeps the user text unchanged", () => {
    const prompt = "今年8月我想看每天的报警数量，用折线图呈现给我";
    expect(askQuestionFromModel("2026年1月至8月各月报警总数明细", prompt)).toBe(prompt);
    expect(askQuestionFromModel("今年8月的报警数量", prompt)).toBe(prompt);
    expect(askQuestionFromModel("今年8月每天的报警数量", prompt)).toBe(prompt);
  });

  test("keeps a deletion of a whole punctuated clause", () => {
    const prompt = "今年8月我想看每天的报警数量，用折线图呈现给我";
    expect(askQuestionFromModel("今年8月我想看每天的报警数量", prompt)).toBe(
      "今年8月我想看每天的报警数量",
    );
  });

  test("rejects a metric name the user did not say", () => {
    expect(askQuestionFromModel("今年报警数量", "今年报警总数多少？")).toBe("今年报警总数多少？");
  });

  test("falls back to the user text when the model sends an empty question", () => {
    expect(askQuestionFromModel("  ", PROMPT)).toBe(PROMPT);
    expect(askQuestionFromModel("", "")).toBeNull();
  });
});

describe("AskBusinessDataStepGate", () => {
  test("rejects every call in the same burst and allows the next step", async () => {
    const gate = new AskBusinessDataStepGate();
    const [first, second] = await Promise.all([gate.enter("a"), gate.enter("b")]);
    expect(first).toBe(false);
    expect(second).toBe(false);
    expect(await gate.enter("c")).toBe(true);
  });
});

describe("biz ontology address", () => {
  test("builds the url from host, port and path and ignores a configured url", () => {
    expect(bizOntologyUrlFromAddress({ host: "192.168.4.228", port: 7168, path: "/mcp" })).toBe(
      "http://192.168.4.228:7168/mcp/",
    );
    const normalized = normalizeBizOntologyServerConfig({
      host: "192.168.4.228",
      port: 7168,
      path: "/mcp/",
      url: "http://ignored.example/mcp",
      type: "stdio",
      enabled: true,
    });
    expect(normalized).toMatchObject({
      type: "http",
      url: "http://192.168.4.228:7168/mcp/",
      consent: "NEVER",
      authPassthrough: "user",
      fixedBizOntologyTools: true,
    });
  });

  test("leaves a url-only server config unchanged", () => {
    const current = { type: "http" as const, url: "http://fake/mcp", enabled: true };
    expect(normalizeBizOntologyServerConfig(current)).toBe(current);
  });

  test("lists the fixed tool names without calling the remote server", async () => {
    const bridge = new McpBridgeService();
    await bridge.init({
      mcpServers: {
        "biz-ontology": {
          host: "192.168.4.228",
          port: 7168,
          path: "/mcp/",
          enabled: true,
        } as never,
      },
    });
    const tools = await bridge.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "mcp.biz-ontology.ask_business_data",
    ]);
    expect(tools.find((tool) => tool.name.endsWith("ask_business_data"))?.inputSchema).toMatchObject({
      required: ["question"],
    });
  });
});

describe("stampAskArguments", () => {
  test("writes the session id and user id but never duplicates tenant into model arguments", () => {
    const ctx = {
      auth: { tenant: 7, user: { userId: "42", scopes: [] } },
      session: { id: "sess-7", turnId: "turn-7" },
    } as ToolHandlerCtx;
    expect(stampAskArguments("今年报警数量", ctx)).toEqual({
      question: "今年报警数量",
      conversation_id: "sess-7",
      context: { user_id: "42" },
    });
  });
});
