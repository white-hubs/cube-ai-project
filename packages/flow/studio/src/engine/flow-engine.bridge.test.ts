import { NotFoundException } from "@dangao/bun-server";
import { describe, expect, mock, test } from "bun:test";

import { FlowEngineBridge, isEngineFlowNotFound } from "./flow-engine.bridge";

interface BridgeDeps {
  flows?: Record<string, unknown>;
  crud?: Record<string, unknown>;
  lfSync?: Record<string, unknown>;
  files?: Record<string, unknown>;
  templates?: Record<string, unknown>;
}

function makeBridge(deps: BridgeDeps = {}): FlowEngineBridge {
  return new FlowEngineBridge(
    (deps.flows ?? {}) as never,
    (deps.crud ?? {}) as never,
    (deps.lfSync ?? {}) as never,
    (deps.files ?? {}) as never,
    (deps.templates ?? {}) as never,
    "https://ai-center.example.com",
    "sk-system",
  );
}

describe("isEngineFlowNotFound", () => {
  test("recognizes flow-core NotFoundException", () => {
    expect(isEngineFlowNotFound(new NotFoundException("missing"))).toBe(true);
  });

  test("recognizes legacy SDK-style errors carrying httpStatus/status 404", () => {
    expect(isEngineFlowNotFound({ httpStatus: 404 })).toBe(true);
    expect(isEngineFlowNotFound({ status: 404 })).toBe(true);
  });

  test("rejects other errors and non-error values", () => {
    expect(isEngineFlowNotFound({ httpStatus: 500 })).toBe(false);
    expect(isEngineFlowNotFound({ status: 400 })).toBe(false);
    expect(isEngineFlowNotFound(new Error("boom"))).toBe(false);
    expect(isEngineFlowNotFound(null)).toBe(false);
    expect(isEngineFlowNotFound(undefined)).toBe(false);
  });
});

describe("FlowEngineBridge", () => {
  test("getConfig exposes selfBaseUrl and system api key for compile-time callbacks", () => {
    expect(makeBridge().getConfig()).toEqual({
      baseUrl: "https://ai-center.example.com",
      systemApiKey: "sk-system",
    });
  });

  test("createFlow trims the name and falls back to default name", async () => {
    const create = mock(async (payload: { name: string; description?: string }) => ({ id: "flow-1", ...payload }));
    const bridge = makeBridge({ flows: { create } });

    await expect(bridge.createFlow({ description: "desc", name: "  我的流程  " })).resolves.toEqual({ id: "flow-1" });
    expect(create.mock.calls[0]?.[0]).toEqual({ description: "desc", name: "我的流程" });

    await bridge.createFlow({ name: "   " });
    expect(create.mock.calls[1]?.[0]).toEqual({ description: undefined, name: "未命名流程" });
  });

  test("updateFlow maps null fields to undefined for flow-core update payload", async () => {
    const update = mock(async (_id: string, _payload: Record<string, unknown>) => ({}));
    const bridge = makeBridge({ flows: { update } });

    await bridge.updateFlow("remote-1", { description: null, graph: null, name: null });
    expect(update.mock.calls[0]).toEqual(["remote-1", { description: undefined, graph: undefined, name: undefined }]);
  });

  test("runFlowStream forces stream=true on the execution request", async () => {
    const runStream = mock(async (_id: string, _request: Record<string, unknown>) => new Response("ok"));
    const bridge = makeBridge({ flows: { runStream } });

    await bridge.runFlowStream("remote-1", { input: "hello", stream: false });
    expect(runStream.mock.calls[0]).toEqual(["remote-1", { input: "hello", stream: true }]);
  });

  test("monitor queries resolve bound execution flow id and serialize query params", async () => {
    const get = mock(async () => ({ id: "studio-1", langflowFlowId: " lf-flow-9 " }));
    const fetchMonitorTracesForFlow = mock(async (_flowId: string, params: URLSearchParams) => ({
      flowId: _flowId,
      query: params.toString(),
    }));
    const bridge = makeBridge({
      crud: { get },
      lfSync: { fetchMonitorTracesForFlow },
    });

    const result = await bridge.getFlowMonitorTraces("remote-1", {
      alsoSkip: undefined,
      includeDeleted: false,
      page: 2,
      size: "20",
      skipMe: null,
    });

    expect(get).toHaveBeenCalledWith("remote-1");
    expect(fetchMonitorTracesForFlow.mock.calls[0]?.[0]).toBe("lf-flow-9");
    const params = fetchMonitorTracesForFlow.mock.calls[0]?.[1] as URLSearchParams;
    expect(params.get("page")).toBe("2");
    expect(params.get("size")).toBe("20");
    expect(params.get("includeDeleted")).toBe("false");
    expect(params.has("skipMe")).toBe(false);
    expect(params.has("alsoSkip")).toBe(false);
    expect(result).toEqual({ flowId: "lf-flow-9", query: params.toString() });
  });

  test("monitor builds query works without query params", async () => {
    const get = mock(async () => ({ langflowFlowId: "lf-flow-9" }));
    const fetchMonitorBuildsForFlow = mock(async (_flowId: string, _params: URLSearchParams) => ({ builds: [] }));
    const bridge = makeBridge({ crud: { get }, lfSync: { fetchMonitorBuildsForFlow } });

    await expect(bridge.getFlowMonitorBuilds("remote-1")).resolves.toEqual({ builds: [] });
    const params = fetchMonitorBuildsForFlow.mock.calls[0]?.[1] as URLSearchParams;
    expect(params.toString()).toBe("");
  });

  test("monitor queries throw engine-flow-not-found when flow has no bound execution backend", async () => {
    const bridge = makeBridge({
      crud: { get: mock(async () => ({ id: "studio-1", langflowFlowId: "  " })) },
    });

    let caught: unknown;
    try {
      await bridge.getFlowMonitorTraces("remote-1");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NotFoundException);
    expect(isEngineFlowNotFound(caught)).toBe(true);
  });

  test("custom component template surface delegates to flow-core service", async () => {
    const validateDsl = mock(async () => ({ ok: true as const }));
    const list = mock(async () => [{ displayName: "Tpl", dsl: { a: 1 }, id: "t-1", update_time: null }]);
    const create = mock(async () => ({ id: "t-2" }));
    const update = mock(async () => ({}));
    const bridge = makeBridge({ templates: { create, list, update, validateDsl } });

    await expect(bridge.validateCustomComponentTemplateDsl({ dsl: { a: 1 } })).resolves.toEqual({ ok: true });
    expect(validateDsl).toHaveBeenCalledWith({ a: 1 });

    await expect(bridge.listCustomComponentTemplates()).resolves.toEqual({
      templates: [{ displayName: "Tpl", dsl: { a: 1 }, id: "t-1", update_time: null }],
    });

    await expect(bridge.createCustomComponentTemplate({ displayName: "New", dsl: { b: 2 } })).resolves.toEqual({ id: "t-2" });
    expect(create).toHaveBeenCalledWith({ displayName: "New", dsl: { b: 2 } });

    await bridge.updateCustomComponentTemplate("t-1", { displayName: "Renamed" });
    expect(update).toHaveBeenCalledWith("t-1", { displayName: "Renamed" });
  });
});
