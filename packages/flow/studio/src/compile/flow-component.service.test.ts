import { describe, expect, test } from "bun:test";

import {
  type FlowComponentCatalogItem,
  builtinProtocolPortsForComponentKey,
  mergeProtocolPortsForCompile,
  parseEditorEdgeOutputBasename,
  smartRouterCompileOutputNamesForGraph,
  smartRouterCompileOutputsFromRoutes,
} from "./flow-component.service";

describe("flow-component protocol merge for compile", () => {
  test("mergeProtocolPortsForCompile falls back to builtin when catalog schema omits outputs", () => {
    const stubCatalog: FlowComponentCatalogItem = {
      componentGroup: null,
      componentKey: "chat-input",
      componentName: "Chat Input",
      componentType: "trigger",
      componentVersion: "1.0.0",
      enabled: true,
      executionPolicy: null,
      iconUrl: null,
      id: "x",
      isBuiltin: false,
      mappingTarget: "cube.lf.ChatInput",
      mappingType: "direct-node",
      presentationSchema: null,
      protocolSchema: {},
    };
    const merged = mergeProtocolPortsForCompile(stubCatalog, "chat-input");
    expect(merged.outputs).toEqual(["message"]);
    expect(builtinProtocolPortsForComponentKey("chat-input").outputs).toEqual(["message"]);
  });

  test("mergeProtocolPortsForCompile keeps language-model compile outputs message+model for smart-router companion edges", () => {
    const builtinLm = mergeProtocolPortsForCompile(undefined, "language-model");
    expect(builtinLm.outputs).toEqual(["message", "model"]);

    const catalogSingleMessage: FlowComponentCatalogItem = {
      componentGroup: null,
      componentKey: "language-model",
      componentName: "语言模型",
      componentType: "processor",
      componentVersion: "1.0.0",
      enabled: true,
      executionPolicy: null,
      iconUrl: null,
      id: "builtin:language-model",
      isBuiltin: true,
      mappingTarget: "cube.lf.CustomComponent",
      mappingType: "preset-node",
      presentationSchema: null,
      protocolSchema: { inputs: ["input"], outputs: ["message"] },
    };
    expect(mergeProtocolPortsForCompile(catalogSingleMessage, "language-model").outputs).toEqual(["message", "model"]);
  });

  test("mergeProtocolPortsForCompile agent fixes cube-ai aligned inputs for compile edges", () => {
    const merged = mergeProtocolPortsForCompile(undefined, "agent");
    expect(merged.inputs).toEqual(["input_value", "tools", "agent_llm"]);
    expect(merged.outputs).toEqual(["response"]);
  });

  test("mergeProtocolPortsForCompile supports hidden multimodal message merge ports", () => {
    const merged = mergeProtocolPortsForCompile(undefined, "multimodal-message-merge");
    expect(merged.inputs).toEqual(["text", "original_message"]);
    expect(merged.outputs).toEqual(["message"]);
  });

  test("mergeProtocolPortsForCompile smart-router expands outputs from routes for cube-ai dynamic handles", () => {
    expect(smartRouterCompileOutputsFromRoutes(undefined)).toEqual(["category_1_result"]);
    expect(smartRouterCompileOutputsFromRoutes({ routes: [] })).toEqual(["category_1_result"]);
    const cfg = {
      routes: [{ route_category: "a" }, { route_category: "b" }],
    };
    expect(smartRouterCompileOutputsFromRoutes(cfg)).toEqual(["category_1_result", "category_2_result"]);
    expect(mergeProtocolPortsForCompile(undefined, "smart-router").outputs).toEqual(["category_1_result"]);
    expect(mergeProtocolPortsForCompile(undefined, "smart-router", cfg).outputs).toEqual(["category_1_result", "category_2_result"]);
  });

  test("parseEditorEdgeOutputBasename handles magnet ids and cube semantic ports", () => {
    expect(parseEditorEdgeOutputBasename("")).toBe("");
    expect(parseEditorEdgeOutputBasename("o-category_3_result")).toBe("category_3_result");
    expect(parseEditorEdgeOutputBasename("o:category_3_result")).toBe("category_3_result");
    expect(parseEditorEdgeOutputBasename("cube.sp/o/SmartRouter-abc123/category_5_result")).toBe("category_5_result");
  });

  test("smartRouterCompileOutputNamesForGraph expands output list when edges use higher category index than routes length", () => {
    const routerId = "sr-1";
    const cfg = { routes: [{ route_name: "a" }, { route_name: "b" }] };
    const edges = [
      { source: routerId, sourcePort: "o-category_5_result" },
      { source: routerId, sourcePort: "o-category_1_result" },
    ];
    expect(smartRouterCompileOutputNamesForGraph(cfg, routerId, edges)).toEqual([
      "category_1_result",
      "category_2_result",
      "category_3_result",
      "category_4_result",
      "category_5_result",
    ]);
  });
});
