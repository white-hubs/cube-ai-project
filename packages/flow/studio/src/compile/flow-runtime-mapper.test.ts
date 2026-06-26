import { describe, expect, test } from "bun:test";

import type { FlowComponentCatalogItem } from "./flow-component.service";
import {
  FLOW_AGENT_NODE_HEIGHT,
  FLOW_AGENT_NODE_WIDTH,
  FLOW_CHAT_CARD_HEIGHT,
  FLOW_CHAT_CARD_WIDTH,
  FLOW_PROMPT_TEMPLATE_NODE_HEIGHT,
  FLOW_PROMPT_TEMPLATE_NODE_WIDTH,
  agentCompanionLlmNodeId,
  buildImageGenerationDslDashscope,
  buildImageGenerationDslOpenAi,
  buildLanguageModelDslOpenAi,
  buildRuntimeNode,
  openaiImageMarkdownFromSrcAndPayloadExpr,
  openaiImageSrcFromItemExpr,
  openaiImageUrlFromPayloadExpr,
  resolveOpenAiImagesGenerationUrl,
  cubeAiTemplateFromEditorTemplate,
  dashscopeImageMessageMarkdownExpr,
  dashscopeImageUrlFromPayloadExpr,
  cubeNodeDimensionsForComponentKey,
  lfNodeIdForCubeGraphNode,
  padSmartRouterCubeConfigRoutesMinRows,
  smartRouterCompanionLlmNodeId,
} from "./flow-runtime-mapper";

const chatInputComponent: FlowComponentCatalogItem = {
  id: "builtin:chat-input",
  componentKey: "chat-input",
  componentName: "Chat Input",
  componentGroup: "基础",
  componentType: "trigger",
  componentVersion: "1.0.0",
  mappingType: "direct-node",
  mappingTarget: "cube.lf.ChatInput",
  iconUrl: null,
  enabled: true,
  isBuiltin: true,
  presentationSchema: null,
  protocolSchema: { inputs: [], outputs: ["message"] },
  executionPolicy: null,
};

const knowledgeComponent: FlowComponentCatalogItem = {
  id: "builtin:knowledge-retrieval",
  componentKey: "knowledge-retrieval",
  componentName: "Knowledge Retrieval",
  componentGroup: "知识库",
  componentType: "processor",
  componentVersion: "1.0.0",
  mappingType: "preset-node",
  mappingTarget: "KnowledgeRetrieval",
  iconUrl: null,
  enabled: true,
  isBuiltin: true,
  presentationSchema: null,
  protocolSchema: { inputs: ["query"], outputs: ["SEARCH_RESULTS"] },
  executionPolicy: null,
};

function dslInputDefaults(dsl: Record<string, unknown>): Record<string, unknown> {
  const inputs = Array.isArray(dsl.inputs) ? (dsl.inputs as Array<Record<string, unknown>>) : [];
  return Object.fromEntries(inputs.map((input) => [String(input.name ?? ""), input.default]));
}

describe("flow-runtime-mapper", () => {
  test("cubeAiTemplateFromEditorTemplate maps ${name} to cube-ai {name}", () => {
    expect(cubeAiTemplateFromEditorTemplate("")).toBe("");
    expect(cubeAiTemplateFromEditorTemplate(null)).toBe("");
    expect(cubeAiTemplateFromEditorTemplate("你好 ${content}")).toBe("你好 {content}");
    expect(cubeAiTemplateFromEditorTemplate("${a}和${b}")).toBe("{a}和{b}");
    expect(cubeAiTemplateFromEditorTemplate("${  x  }")).toBe("{x}");
    expect(cubeAiTemplateFromEditorTemplate("$ {y}")).toBe("{y}");
    expect(cubeAiTemplateFromEditorTemplate("\uFF04{full}")).toBe("{full}");
  });

  test("prompt-template runtime config uses {name} placeholders and canvas dimensions", () => {
    expect(cubeNodeDimensionsForComponentKey("prompt-template")).toEqual({
      width: FLOW_PROMPT_TEMPLATE_NODE_WIDTH,
      height: FLOW_PROMPT_TEMPLATE_NODE_HEIGHT,
    });
    const node = buildRuntimeNode(
      {
        id: "n-pt",
        componentKey: "prompt-template",
        label: "提示词模板",
        position: { x: 0, y: 0 },
        data: { config: { template: "问题：${question}\n补充：${ctx}" } },
      },
      {
        id: "builtin:prompt-template",
        componentKey: "prompt-template",
        componentName: "提示词模板",
        componentGroup: "基础",
        componentType: "processor",
        componentVersion: "1.0.0",
        mappingType: "direct-node",
        mappingTarget: "cube.lf.Prompt Template",
        iconUrl: null,
        enabled: true,
        isBuiltin: true,
        presentationSchema: null,
        protocolSchema: { inputs: [], outputs: ["prompt"] },
        executionPolicy: null,
      },
      {},
    );
    const cfg = node.config as { template?: string; prompt_template?: string };
    expect(cfg.template).toBe("问题：{question}\n补充：{ctx}");
    expect(cfg.prompt_template).toBe("问题：{question}\n补充：{ctx}");
  });

  test("prompt-template maps prompt_template field when template key missing", () => {
    const node = buildRuntimeNode(
      {
        id: "n-pt2",
        componentKey: "prompt-template",
        label: "PT",
        position: { x: 0, y: 0 },
        data: { config: { prompt_template: "hi ${u}" } },
      },
      undefined,
      {},
    );
    const cfg = node.config as { template?: string; prompt_template?: string };
    expect(cfg.template).toBe("hi {u}");
    expect(cfg.prompt_template).toBe("hi {u}");
  });

  test("chat-input uses canvas-aligned dimensions for AI Center edge anchoring", () => {
    expect(cubeNodeDimensionsForComponentKey("chat-input")).toEqual({
      width: FLOW_CHAT_CARD_WIDTH,
      height: FLOW_CHAT_CARD_HEIGHT,
    });
    const node = buildRuntimeNode(
      {
        id: "n1",
        componentKey: "chat-input",
        label: "in",
        position: { x: 0, y: 0 },
        data: { config: {} },
      },
      chatInputComponent,
      {},
    );
    expect(node.width).toBe(FLOW_CHAT_CARD_WIDTH);
    expect(node.height).toBe(FLOW_CHAT_CARD_HEIGHT);
    expect(node.cubeType).toBe("cube.lf.ChatInput");
    expect(node.lfNodeId).toBe("ChatInput-n1");
  });

  test("lfNodeId matches cube-ai convention: leaf + first 6 hex of graph id without hyphens", () => {
    expect(lfNodeIdForCubeGraphNode("cube.lf.ChatInput", "1e1632af-8910-4499-8aa7-be1329ed2865")).toBe("ChatInput-1e1632");
    expect(lfNodeIdForCubeGraphNode("cube.lf.ChatOutput", "35b255da-3753-40a5-833d-b6f3151d5782")).toBe("ChatOutput-35b255");
  });

  test("lfNodeId strips synthetic companion prefixes so UUID suffix differs per node (fix __aiap collision)", () => {
    const routerId = "550e8400-e29b-41d4-a716-446655440000";
    const agentId = "660e8400-e29b-41d4-a716-446655440001";
    const sr = lfNodeIdForCubeGraphNode("cube.lf.CustomComponent", smartRouterCompanionLlmNodeId(routerId));
    const ag = lfNodeIdForCubeGraphNode("cube.lf.CustomComponent", agentCompanionLlmNodeId(agentId));
    expect(sr).toBe("CustomComponent-550e84");
    expect(ag).toBe("CustomComponent-660e84");
    expect(sr).not.toBe(ag);
    const naiveShort = "__aiapp_sr_llm__".replace(/-/g, "").slice(0, 6).toLowerCase();
    expect(naiveShort).toBe("__aiap");
  });

  test("maps knowledge-retrieval into cube custom component with placeholders", () => {
    const node = buildRuntimeNode(
      {
        id: "node-kr",
        componentKey: "knowledge-retrieval",
        label: "知识检索",
        position: { x: 10, y: 20 },
        data: {
          config: {
            documentIds: ["biz-doc-1", "biz-doc-2"],
            topK: 6,
          },
        },
      },
      knowledgeComponent,
      {},
    );

    expect(node.cubeType).toBe("cube.lf.CustomComponent");
    expect(node.config.knowledge_sources_runtime_json).toBe(
      JSON.stringify([
        { document_id: "biz-doc-1", top_k: 6, min_score: 0.4 },
        { document_id: "biz-doc-2", top_k: 6, min_score: 0.4 },
      ]),
    );
    expect(node.config.api_url).toBe("__AI_CENTER_BASE_URL__/kb/search/by-documents");

    const dsl = node.config.cube_dsl as Record<string, unknown>;
    expect(dsl.dslVersion).toBe(2);
    const out = dsl.output as { name?: string; kind?: string; value_from?: string };
    expect(out.name).toBe("SEARCH_RESULTS");
    expect(out.kind).toBe("text");
    expect(out.value_from).toBe("SEARCH_RESULTS");
    const workflow = dsl.workflow as { blocks?: Array<Record<string, unknown>> };
    const ifBlock = workflow.blocks?.find((block) => block.type === "if") as
      | { condition?: unknown; then?: Array<Record<string, unknown>> }
      | undefined;
    expect(ifBlock?.condition).toEqual({
      kind: "and",
      conditions: [
        { kind: "non_empty", field: "query" },
        { kind: "non_empty", field: "sources" },
      ],
    });
    const bodyExpr = JSON.stringify(ifBlock?.then?.find((block) => block.output_as === "kr_batch_request_body"));
    expect(bodyExpr).toContain("documentId");
    expect(bodyExpr).toContain("topK");
    expect(bodyExpr).toContain("similarityThreshold");
  });

  test("uses ai-center runtime context and mapped document ids when provided", () => {
    const node = buildRuntimeNode(
      {
        id: "node-kr",
        componentKey: "knowledge-retrieval",
        label: "知识检索",
        position: { x: 10, y: 20 },
        data: {
          config: {
            documentIds: ["biz-doc-1", "biz-doc-2"],
            topK: 3,
          },
        },
      },
      knowledgeComponent,
      {
        aiCenterBaseUrl: "https://ai-center.example.com",
        aiCenterApiKey: "key-123",
        aiCenterProjectId: "project-456",
        knowledgeDocumentRuntimeIds: new Map([
          ["biz-doc-1", "doc-101"],
          ["biz-doc-2", "doc-202"],
        ]),
      },
    );

    expect(node.config.knowledge_sources_runtime_json).toBe(
      JSON.stringify([
        { document_id: "doc-101", top_k: 3, min_score: 0.4 },
        { document_id: "doc-202", top_k: 3, min_score: 0.4 },
      ]),
    );
    expect(node.config.api_url).toBe("https://ai-center.example.com/kb/search/by-documents");
    expect(node.config.api_key).toBe("key-123");
    expect(node.config.project_id).toBe("project-456");
  });

  test("language-model maps to CustomComponent with OpenAI-style DSL and resolved chat URL", () => {
    const lmComponent: FlowComponentCatalogItem = {
      id: "builtin:language-model",
      componentKey: "language-model",
      componentName: "语言模型",
      componentGroup: "基础",
      componentType: "processor",
      componentVersion: "1.0.0",
      mappingType: "preset-node",
      mappingTarget: "cube.lf.CustomComponent",
      iconUrl: null,
      enabled: true,
      isBuiltin: true,
      presentationSchema: null,
      protocolSchema: { inputs: ["input"], outputs: ["message"] },
      executionPolicy: null,
    };

    const node = buildRuntimeNode(
      {
        id: "node-lm",
        componentKey: "language-model",
        label: "LLM",
        position: { x: 0, y: 0 },
        data: {
          config: {
            modelId: "m1",
            systemMessage: "You are helpful.",
            userMessage: "",
            temperature: 0.3,
          },
        },
      },
      lmComponent,
      {
        languageModelRuntimeByNodeId: new Map([
          [
            "node-lm",
            {
              providerType: "openai_compatible",
              apiBaseUrl: "https://api.example.com",
              chatUrl: "https://api.example.com/v1/chat/completions",
              apiKey: "sk-test",
              modelCode: "gpt-4o-mini",
              supportsMultimodalInput: true,
            },
          ],
        ]),
      },
    );

    expect(node.cubeType).toBe("cube.lf.CustomComponent");
    expect((node.config as Record<string, unknown>).chat_url).toBe("https://api.example.com/v1/chat/completions");
    expect((node.config as Record<string, unknown>).model_code).toBe("gpt-4o-mini");
    const dsl = (node.config as Record<string, unknown>).cube_dsl as Record<string, unknown>;
    expect(dsl.dslVersion).toBe(2);
    expect((dsl.metadata as { name?: string }).name).toBe("AiApplicationLanguageModelOpenAI");
    expect((dsl.output as { kind?: string })?.kind).toBe("message");
    expect(dsl.outputs).toBeUndefined();
    const wfBlocks = (dsl.workflow as { blocks?: Array<{ action?: string; output_as?: string }> })?.blocks;
    expect((dsl.inputs as Array<{ name?: string; kind?: string; input_types?: string[] }>)[0]).toMatchObject({
      name: "input",
      kind: "handle",
      input_types: ["Message"],
    });
    expect(wfBlocks?.find((b) => b.output_as === "user_content")?.action).toBe("message_to_openai_content");
    expect(wfBlocks?.some((b) => b.output_as === "tenant_lm")).toBe(false);
    const httpBlock = wfBlocks?.find((b) => (b as { action?: string }).action === "http") as
      | { params?: { timeout_ms?: number } }
      | undefined;
    expect(httpBlock?.params?.timeout_ms).toBe(300000);
    const fin = dsl.inputs as Array<{ name?: string }>;
    expect(fin[0]?.name).toBe("input");

    const withTpl = buildRuntimeNode(
      {
        id: "node-lm",
        componentKey: "language-model",
        label: "LLM",
        position: { x: 0, y: 0 },
        data: {
          config: {
            modelId: "m1",
            systemMessage: "",
            userMessage: "",
            temperature: 0.3,
          },
        },
      },
      lmComponent,
      {
        languageModelRuntimeByNodeId: new Map([
          [
            "node-lm",
            {
              providerType: "openai_compatible",
              apiBaseUrl: "https://api.example.com",
              chatUrl: "https://api.example.com/v1/chat/completions",
              apiKey: "sk-test",
              modelCode: "gpt-4o-mini",
              supportsMultimodalInput: true,
            },
          ],
        ]),
        languageModelCubeAiTemplateIds: { openaiVision: "tpl-snowflake-vision-1" },
      },
    );
    expect((withTpl.config as Record<string, unknown>).cube_custom_template_id).toBe("tpl-snowflake-vision-1");

    const textTpl = buildRuntimeNode(
      {
        id: "node-lm-text-template",
        componentKey: "language-model",
        label: "LLM",
        position: { x: 0, y: 0 },
        data: {
          config: {
            modelId: "m-text",
            systemMessage: "",
            userMessage: "",
            temperature: 0.3,
          },
        },
      },
      lmComponent,
      {
        languageModelRuntimeByNodeId: new Map([
          [
            "node-lm-text-template",
            {
              providerType: "openai_compatible",
              apiBaseUrl: "https://api.example.com",
              chatUrl: "https://api.example.com/v1/chat/completions",
              apiKey: "sk-test",
              modelCode: "gpt-4-text",
              supportsMultimodalInput: false,
            },
          ],
        ]),
        languageModelCubeAiTemplateIds: { openaiText: "tpl-snowflake-text-1" },
      },
    );
    expect((textTpl.config as Record<string, unknown>).cube_custom_template_id).toBe("tpl-snowflake-text-1");
  });

  test("language-model strips files from OpenAI DSL when model is not vision capable", () => {
    const lmComponent: FlowComponentCatalogItem = {
      id: "builtin:language-model",
      componentKey: "language-model",
      componentName: "语言模型",
      componentGroup: "基础",
      componentType: "processor",
      componentVersion: "1.0.0",
      mappingType: "preset-node",
      mappingTarget: "cube.lf.CustomComponent",
      iconUrl: null,
      enabled: true,
      isBuiltin: true,
      presentationSchema: null,
      protocolSchema: { inputs: ["input"], outputs: ["message"] },
      executionPolicy: null,
    };

    const node = buildRuntimeNode(
      {
        id: "node-lm-text",
        componentKey: "language-model",
        label: "Text LLM",
        position: { x: 0, y: 0 },
        data: { config: { modelId: "m-text" } },
      },
      lmComponent,
      {
        languageModelRuntimeByNodeId: new Map([
          [
            "node-lm-text",
            {
              providerType: "openai_compatible",
              apiBaseUrl: "https://api.example.com",
              chatUrl: "https://api.example.com/v1/chat/completions",
              apiKey: "sk-test",
              modelCode: "gpt-4-text",
              supportsMultimodalInput: false,
            },
          ],
        ]),
      },
    );

    const dsl = (node.config as Record<string, unknown>).cube_dsl as Record<string, unknown>;
    const wfBlocks = (dsl.workflow as { blocks?: Array<{ action?: string; output_as?: string }> })?.blocks ?? [];
    const userContentBlock = wfBlocks.find((b) => b.output_as === "user_content");
    expect((dsl.inputs as Array<{ name?: string; kind?: string }>)[0]).toMatchObject({
      name: "input",
      kind: "message_text",
    });
    expect(userContentBlock?.action).toBe("assign");
    expect(wfBlocks.some((b) => b.action === "message_to_openai_content")).toBe(false);
  });

  test("language-model vision DSL sets image file size guard for OpenAI content conversion", () => {
    const dsl = buildLanguageModelDslOpenAi({ supportsMultimodalInput: true });
    const wfBlocks =
      (
        dsl.workflow as {
          blocks?: Array<{ action?: string; output_as?: string; params?: Record<string, unknown> }>;
        }
      )?.blocks ?? [];
    const userContentBlock = wfBlocks.find((b) => b.output_as === "user_content");

    expect(userContentBlock?.action).toBe("message_to_openai_content");
    expect(userContentBlock?.params?.max_file_bytes).toBe(20 * 1024 * 1024);
  });

  test("language-model chat response surfaces provider errors instead of empty output", () => {
    const dsl = buildLanguageModelDslOpenAi({ supportsMultimodalInput: true });
    const wfBlocks =
      (
        dsl.workflow as {
          blocks?: Array<{ action?: string; output_as?: string; params?: Record<string, unknown> }>;
        }
      )?.blocks ?? [];
    const messageBlock = wfBlocks.find((b) => b.output_as === "message");
    const expr = String(messageBlock?.params?.expr ?? "");

    expect(expr).toContain('RuntimeError("Chat Completions API failed: " +');
    expect(expr).toContain("choices");
    expect(expr).not.toContain("or [{}]");
  });

  test("language-model chat response does not expose provider reasoning content", () => {
    const dsl = buildLanguageModelDslOpenAi({ supportsMultimodalInput: true });
    const wfBlocks =
      (
        dsl.workflow as {
          blocks?: Array<{ action?: string; output_as?: string; params?: Record<string, unknown> }>;
        }
      )?.blocks ?? [];
    const messageBlock = wfBlocks.find((b) => b.output_as === "message");
    const expr = String(messageBlock?.params?.expr ?? "");

    expect(expr).toContain("message");
    expect(expr).toContain("content");
    expect(expr).not.toContain("reasoning_content");
    expect(expr).not.toContain("### 思考过程");
  });

  test("language-model qwen3 runtime bridges SDK-style extra_body enableThinking into HTTP top-level DSL", () => {
    const lmComponent: FlowComponentCatalogItem = {
      id: "builtin:language-model",
      componentKey: "language-model",
      componentName: "语言模型",
      componentGroup: "基础",
      componentType: "processor",
      componentVersion: "1.0.0",
      mappingType: "preset-node",
      mappingTarget: "cube.lf.CustomComponent",
      iconUrl: null,
      enabled: true,
      isBuiltin: true,
      presentationSchema: null,
      protocolSchema: { inputs: ["input"], outputs: ["message"] },
      executionPolicy: null,
    };

    const node = buildRuntimeNode(
      {
        id: "node-qwen3",
        componentKey: "language-model",
        label: "Qwen3",
        position: { x: 0, y: 0 },
        data: {
          config: {
            modelId: "m-qwen3",
            input: "hi",
            enableThinking: true,
          },
        },
      },
      lmComponent,
      {
        languageModelRuntimeByNodeId: new Map([
          [
            "node-qwen3",
            {
              providerType: "openai_compatible",
              apiBaseUrl: "https://geekai.co/api/v1",
              chatUrl: "https://geekai.co/api/v1/chat/completions",
              apiKey: "sk-test",
              modelCode: "qwen3-235b-a22b",
              nativeFamily: "qwen3",
              channelProfile: "aggregator_unified",
              adapterKey: "geekai.openai_chat",
              requestSchema: {
                requestShape: "openai_chat_compatible",
                extraBodyFields: [
                  {
                    key: "enable_thinking",
                    type: "boolean",
                    wirePath: "extra_body.enable_thinking",
                  },
                ],
              },
            },
          ],
        ]),
        languageModelCubeAiTemplateIds: { openaiText: "tpl-openai-text-1" },
      },
    );

    const cfg = node.config as Record<string, unknown>;
    expect(cfg.enable_thinking).toBe(true);
    expect(cfg.use_enable_thinking).toBe(true);
    expect(cfg.supports_enable_thinking).toBe(true);
    expect(cfg.thinking_wire_path).toBe("enable_thinking");
    expect(cfg.cube_custom_template_id).toBeUndefined();
    const dsl = cfg.cube_dsl as Record<string, unknown>;
    expect(dslInputDefaults(dsl)).toMatchObject({
      supports_enable_thinking: true,
      use_enable_thinking: true,
      enable_thinking: true,
      thinking_wire_path: "enable_thinking",
      thinking_wire_transform: "",
    });
    const blocks = (dsl.workflow as { blocks?: Array<{ output_as?: string; params?: { expr?: string } }> })?.blocks ?? [];
    const requestBody = blocks.find((b) => b.output_as === "request_body");
    expect(requestBody?.params?.expr).toContain("enable_thinking");
  });

  test("language-model volcengine runtime bridges disabled thinking into thinking.type DSL", () => {
    const lmComponent: FlowComponentCatalogItem = {
      id: "builtin:language-model",
      componentKey: "language-model",
      componentName: "语言模型",
      componentGroup: "基础",
      componentType: "processor",
      componentVersion: "1.0.0",
      mappingType: "preset-node",
      mappingTarget: "cube.lf.CustomComponent",
      iconUrl: null,
      enabled: true,
      isBuiltin: true,
      presentationSchema: null,
      protocolSchema: { inputs: ["input"], outputs: ["message"] },
      executionPolicy: null,
    };

    const node = buildRuntimeNode(
      {
        id: "node-doubao",
        componentKey: "language-model",
        label: "Doubao",
        position: { x: 0, y: 0 },
        data: {
          config: {
            modelId: "m-doubao",
            input: "hi",
            enableThinking: false,
            useEnableThinking: true,
          },
        },
      },
      lmComponent,
      {
        languageModelRuntimeByNodeId: new Map([
          [
            "node-doubao",
            {
              providerType: "openai_compatible",
              apiBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
              chatUrl: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
              apiKey: "sk-test",
              modelCode: "doubao-seed-2-0-pro-260215",
              nativeFamily: "doubao",
              channelProfile: "direct",
              adapterKey: "openai.chat",
              requestSchema: {
                requestShape: "openai_chat_compatible",
                extraBodyFields: [
                  {
                    key: "enableThinking",
                    type: "boolean",
                    feature: "thinking",
                    wirePath: "thinking.type",
                    wireTransform: "boolean:enabled_disabled",
                  },
                ],
              },
            },
          ],
        ]),
      },
    );

    const cfg = node.config as Record<string, unknown>;
    expect(cfg.enable_thinking).toBe(false);
    expect(cfg.use_enable_thinking).toBe(true);
    expect(cfg.supports_enable_thinking).toBe(true);
    expect(cfg.thinking_wire_path).toBe("thinking.type");
    expect(cfg.thinking_wire_transform).toBe("boolean:enabled_disabled");
    const dsl = cfg.cube_dsl as Record<string, unknown>;
    expect(dslInputDefaults(dsl)).toMatchObject({
      supports_enable_thinking: true,
      use_enable_thinking: true,
      enable_thinking: false,
      thinking_wire_path: "thinking.type",
      thinking_wire_transform: "boolean:enabled_disabled",
    });
    const blocks = (dsl.workflow as { blocks?: Array<{ output_as?: string; params?: { expr?: string } }> })?.blocks ?? [];
    const requestBody = blocks.find((b) => b.output_as === "request_body");
    expect(requestBody?.params?.expr).toContain("thinking");
    expect(requestBody?.params?.expr).toContain("disabled");
  });

  test("language-model default disabled thinking still emits request field when model supports thinking", () => {
    const lmComponent: FlowComponentCatalogItem = {
      id: "builtin:language-model",
      componentKey: "language-model",
      componentName: "语言模型",
      componentGroup: "基础",
      componentType: "processor",
      componentVersion: "1.0.0",
      mappingType: "preset-node",
      mappingTarget: "cube.lf.CustomComponent",
      iconUrl: null,
      enabled: true,
      isBuiltin: true,
      presentationSchema: null,
      protocolSchema: { inputs: ["input"], outputs: ["message"] },
      executionPolicy: null,
    };

    const node = buildRuntimeNode(
      {
        id: "node-qwen3-default-disabled",
        componentKey: "language-model",
        label: "Qwen3",
        position: { x: 0, y: 0 },
        data: {
          config: {
            modelId: "m-qwen3",
            input: "hi",
          },
        },
      },
      lmComponent,
      {
        languageModelRuntimeByNodeId: new Map([
          [
            "node-qwen3-default-disabled",
            {
              providerType: "openai_compatible",
              apiBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
              chatUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
              apiKey: "sk-test",
              modelCode: "qwen3-max",
              nativeFamily: "qwen3",
              channelProfile: "direct",
              adapterKey: "openai.chat",
              requestSchema: {
                requestShape: "openai_chat_compatible",
                extraBodyFields: [
                  {
                    key: "enable_thinking",
                    type: "boolean",
                    wirePath: "enable_thinking",
                  },
                ],
              },
            },
          ],
        ]),
      },
    );

    const cfg = node.config as Record<string, unknown>;
    expect(cfg.supports_enable_thinking).toBe(true);
    expect(cfg.use_enable_thinking).toBe(false);
    expect(cfg.enable_thinking).toBe(false);
    const dsl = cfg.cube_dsl as Record<string, unknown>;
    expect(dslInputDefaults(dsl)).toMatchObject({
      supports_enable_thinking: true,
      use_enable_thinking: false,
      enable_thinking: false,
      thinking_wire_path: "enable_thinking",
    });
    const blocks = (dsl.workflow as { blocks?: Array<{ output_as?: string; params?: { expr?: string } }> })?.blocks ?? [];
    const requestBody = blocks.find((b) => b.output_as === "request_body");
    expect(requestBody?.params?.expr).not.toContain("use_enable_thinking");
    expect(requestBody?.params?.expr).toContain("supports_enable_thinking");
    expect(requestBody?.params?.expr).toContain("enable_thinking");
  });

  test("language-model volcengine runtime bridges enabled thinking into thinking.type DSL", () => {
    const lmComponent: FlowComponentCatalogItem = {
      id: "builtin:language-model",
      componentKey: "language-model",
      componentName: "语言模型",
      componentGroup: "基础",
      componentType: "processor",
      componentVersion: "1.0.0",
      mappingType: "preset-node",
      mappingTarget: "cube.lf.CustomComponent",
      iconUrl: null,
      enabled: true,
      isBuiltin: true,
      presentationSchema: null,
      protocolSchema: { inputs: ["input"], outputs: ["message"] },
      executionPolicy: null,
    };

    const node = buildRuntimeNode(
      {
        id: "node-doubao-enabled",
        componentKey: "language-model",
        label: "Doubao",
        position: { x: 0, y: 0 },
        data: {
          config: {
            modelId: "m-doubao",
            input: "hi",
            enableThinking: true,
            useEnableThinking: true,
          },
        },
      },
      lmComponent,
      {
        languageModelRuntimeByNodeId: new Map([
          [
            "node-doubao-enabled",
            {
              providerType: "openai_compatible",
              apiBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
              chatUrl: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
              apiKey: "sk-test",
              modelCode: "doubao-seed-2-0-lite-260215",
              nativeFamily: "doubao",
              channelProfile: "direct",
              adapterKey: "openai.chat",
              requestSchema: {
                requestShape: "openai_chat_compatible",
                extraBodyFields: [
                  {
                    key: "enableThinking",
                    type: "boolean",
                    feature: "thinking",
                    wirePath: "thinking.type",
                    wireTransform: "boolean:enabled_disabled",
                  },
                ],
              },
            },
          ],
        ]),
      },
    );

    const cfg = node.config as Record<string, unknown>;
    expect(cfg.enable_thinking).toBe(true);
    expect(cfg.use_enable_thinking).toBe(true);
    expect(cfg.supports_enable_thinking).toBe(true);
    expect(cfg.thinking_wire_path).toBe("thinking.type");
    expect(cfg.thinking_wire_transform).toBe("boolean:enabled_disabled");
    const dsl = cfg.cube_dsl as Record<string, unknown>;
    const blocks = (dsl.workflow as { blocks?: Array<{ output_as?: string; params?: { expr?: string } }> })?.blocks ?? [];
    const requestBody = blocks.find((b) => b.output_as === "request_body");
    expect(requestBody?.params?.expr).toContain("thinking");
    expect(requestBody?.params?.expr).toContain("enabled");
  });

  test("image-generation maps to CustomComponent with DashScope DSL and generation URL", () => {
    const node = buildRuntimeNode(
      {
        id: "node-img",
        componentKey: "image-generation",
        label: "图像生成",
        position: { x: 0, y: 0 },
        data: {
          config: {
            modelId: "m-img",
            prompt: "一只猫",
            size: "1024*1024",
          },
        },
      },
      {
        id: "builtin:image-generation",
        componentKey: "image-generation",
        componentName: "图像生成",
        componentGroup: "基础",
        componentType: "processor",
        componentVersion: "1.0.0",
        mappingType: "preset-node",
        mappingTarget: "cube.lf.CustomComponent",
        iconUrl: null,
        enabled: true,
        isBuiltin: true,
        presentationSchema: null,
        protocolSchema: { inputs: ["prompt"], outputs: ["imageUrl"] },
        executionPolicy: null,
      },
      {
        imageGenerationRuntimeByNodeId: new Map([
          [
            "node-img",
            {
              providerType: "dashscope_text2image",
              apiBaseUrl: "https://dashscope.aliyuncs.com",
              generationUrl: "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
              apiKey: "sk-test",
              modelCode: "qwen-image-2.0-pro",
            },
          ],
        ]),
      },
    );

    expect(node.cubeType).toBe("cube.lf.CustomComponent");
    expect((node.config as Record<string, unknown>).generation_url).toBe(
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    );
    expect((node.config as Record<string, unknown>).model_code).toBe("qwen-image-2.0-pro");
    const dsl = (node.config as Record<string, unknown>).cube_dsl as Record<string, unknown>;
    expect((dsl.metadata as { name?: string }).name).toBe("AiApplicationImageGenerationDashscope");
    const out = dsl.output as { name?: string };
    expect(out.name).toBe("imageUrl");
  });

  test("resolveOpenAiImagesGenerationUrl appends images/generations path", () => {
    expect(resolveOpenAiImagesGenerationUrl("https://api.openai.com")).toBe("https://api.openai.com/v1/images/generations");
    expect(resolveOpenAiImagesGenerationUrl("https://api.openai.com/v1")).toBe("https://api.openai.com/v1/images/generations");
    expect(resolveOpenAiImagesGenerationUrl("https://ark.cn-beijing.volces.com/api/v3")).toBe(
      "https://ark.cn-beijing.volces.com/api/v3/images/generations",
    );
    expect(resolveOpenAiImagesGenerationUrl("https://geekai.co/api/v1")).toBe("https://geekai.co/api/v1/images/generations");
  });

  test("OpenAI image generation DSL uses data[0].url and message output", () => {
    const dsl = buildImageGenerationDslOpenAi();
    expect((dsl.metadata as { name?: string }).name).toBe("AiApplicationImageGenerationOpenAI");
    const blocks = (dsl.workflow as { blocks?: Array<{ type?: string; params?: { expr?: string }; then?: unknown[] }> })?.blocks ?? [];
    const httpIf = blocks.find((b) => b.type === "if") as { then?: Array<{ output_as?: string; params?: { expr?: string } }> } | undefined;
    const httpBlocks = httpIf?.then ?? [];
    const srcAssign = httpBlocks.find((b) => b.output_as === "image_src");
    expect(srcAssign?.params?.expr).toBe(openaiImageSrcFromItemExpr("image_item"));
    expect(srcAssign?.params?.expr).toContain("b64_json");
    expect(httpBlocks.some((b) => b.params?.expr?.includes('__import__("requests").request'))).toBe(true);
    const imageAssign = httpBlocks.find((b) => b.output_as === "imageUrl");
    expect(imageAssign?.params?.expr).toBe(
      openaiImageMarkdownFromSrcAndPayloadExpr("image_src", "submit_payload", "raw_submit", "image_http_ready"),
    );
    const authAssign = httpBlocks.find((b) => b.output_as === "authorization_header");
    expect(authAssign?.params?.expr).toContain("api_key_plain");
    const bodyAssign = httpBlocks.find((b) => b.params?.expr?.includes("response_format"));
    expect(bodyAssign?.params?.expr).toContain('"response_format": "url"');
    expect(openaiImageUrlFromPayloadExpr("submit_payload")).toContain("data");
    const out = dsl.output as { kind?: string; name?: string };
    expect(out.kind).toBe("message");
    expect(out.name).toBe("imageUrl");
  });

  test("image-generation node with openai_image runtime uses OpenAI DSL", () => {
    const imageComponent: FlowComponentCatalogItem = {
      id: "builtin:image-generation",
      componentKey: "image-generation",
      componentName: "图像生成",
      componentGroup: "基础",
      componentType: "processor",
      componentVersion: "1.0.0",
      mappingType: "preset-node",
      mappingTarget: "cube.lf.CustomComponent",
      iconUrl: null,
      enabled: true,
      isBuiltin: true,
      presentationSchema: { fields: [] },
      protocolSchema: { inputs: ["prompt"], outputs: ["imageUrl"] },
      executionPolicy: { runnable: true },
    };
    const node = buildRuntimeNode(
      {
        id: "node-openai-image",
        componentKey: "image-generation",
        label: "图像生成",
        position: { x: 0, y: 0 },
        data: {
          config: {
            modelId: "m-openai-image",
            prompt: "a red apple",
            size: "1024x1024",
          },
        },
      },
      imageComponent,
      {
        imageGenerationRuntimeByNodeId: new Map([
          [
            "node-openai-image",
            {
              providerType: "openai_image",
              apiBaseUrl: "https://api.openai.com",
              generationUrl: "https://api.openai.com/v1/images/generations",
              apiKey: "sk-test",
              modelCode: "dall-e-3",
            },
          ],
        ]),
      },
    );
    expect((node.config as Record<string, unknown>).generation_url).toBe("https://api.openai.com/v1/images/generations");
    const dsl = (node.config as Record<string, unknown>).cube_dsl as Record<string, unknown>;
    expect((dsl.metadata as { name?: string }).name).toBe("AiApplicationImageGenerationOpenAI");
  });

  test("image-generation node with volcengine_ark Seedream uses OpenAI Images DSL and ark generation URL", () => {
    const imageComponent: FlowComponentCatalogItem = {
      id: "builtin:image-generation",
      componentKey: "image-generation",
      componentName: "图像生成",
      componentGroup: "基础",
      componentType: "processor",
      componentVersion: "1.0.0",
      mappingType: "preset-node",
      mappingTarget: "cube.lf.CustomComponent",
      iconUrl: null,
      enabled: true,
      isBuiltin: true,
      presentationSchema: { fields: [] },
      protocolSchema: { inputs: ["prompt"], outputs: ["imageUrl"] },
      executionPolicy: { runnable: true },
    };
    const node = buildRuntimeNode(
      {
        id: "node-ark-seedream",
        componentKey: "image-generation",
        label: "图像生成",
        position: { x: 0, y: 0 },
        data: {
          config: {
            modelId: "m-ark-seedream",
            prompt: "一只猫",
            size: "1024x1024",
          },
        },
      },
      imageComponent,
      {
        imageGenerationRuntimeByNodeId: new Map([
          [
            "node-ark-seedream",
            {
              providerType: "openai_image",
              apiBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
              generationUrl: "https://ark.cn-beijing.volces.com/api/v3/images/generations",
              apiKey: "ark-test-key",
              modelCode: "doubao-seedream-5-0-260128",
              nativeFamily: "seedream",
              channelProfile: "direct",
              adapterKey: "volcengine_ark.openai_image",
              requestSchema: { requestShape: "openai_images_generation" },
            },
          ],
        ]),
      },
    );
    expect((node.config as Record<string, unknown>).generation_url).toBe("https://ark.cn-beijing.volces.com/api/v3/images/generations");
    expect((node.config as Record<string, unknown>).model_code).toBe("doubao-seedream-5-0-260128");
    expect((node.config as Record<string, unknown>).size).toBe("2k");
    const dsl = (node.config as Record<string, unknown>).cube_dsl as Record<string, unknown>;
    expect((dsl.metadata as { name?: string }).name).toBe("AiApplicationImageGenerationOpenAI");
  });

  test("image-generation Seedream aggregator native runtime applies wire size transform", () => {
    const imageComponent: FlowComponentCatalogItem = {
      id: "builtin:image-generation",
      componentKey: "image-generation",
      componentName: "图像生成",
      componentGroup: "基础",
      componentType: "processor",
      componentVersion: "1.0.0",
      mappingType: "preset-node",
      mappingTarget: "cube.lf.CustomComponent",
      iconUrl: null,
      enabled: true,
      isBuiltin: true,
      presentationSchema: { fields: [] },
      protocolSchema: { inputs: ["prompt"], outputs: ["imageUrl"] },
      executionPolicy: { runnable: true },
    };
    const node = buildRuntimeNode(
      {
        id: "node-geekai-seedream",
        componentKey: "image-generation",
        label: "图像生成",
        position: { x: 0, y: 0 },
        data: {
          config: {
            modelId: "m-geekai-seedream",
            prompt: "一只猫",
            size: "1024x1024",
          },
        },
      },
      imageComponent,
      {
        imageGenerationRuntimeByNodeId: new Map([
          [
            "node-geekai-seedream",
            {
              providerType: "openai_image",
              apiBaseUrl: "https://geekai.co/api/v1",
              generationUrl: "https://geekai.co/api/v1/images/generations",
              apiKey: "geekai-test-key",
              modelCode: "doubao-seedream-3.0-t2i",
              nativeFamily: "seedream",
              channelProfile: "aggregator_native",
              adapterKey: "seedream.openai_images",
              requestSchema: { requestShape: "openai_images_generation" },
            },
          ],
        ]),
      },
    );

    expect((node.config as Record<string, unknown>).size).toBe("2K");
    const dsl = (node.config as Record<string, unknown>).cube_dsl as Record<string, unknown>;
    expect((dsl.metadata as { name?: string }).name).toBe("AiApplicationImageGenerationOpenAI");
  });

  test("DashScope image URL expr reads output.choices message content image", () => {
    const expr = dashscopeImageUrlFromPayloadExpr("submit_payload");
    expect(expr).toContain("choices");
    expect(expr).toContain('"image"');
    const dsl = buildImageGenerationDslDashscope();
    const blocks = (dsl.workflow as { blocks?: Array<{ params?: { expr?: string } }> })?.blocks ?? [];
    const imageAssign = blocks.find((b) => b.params?.expr?.includes("choices"));
    expect(imageAssign?.params?.expr).toBe(expr);
    const out = dsl.output as { kind?: string; method?: string; name?: string };
    expect(out.kind).toBe("message");
    expect(out.method).toBe("build_output");
    expect(out.name).toBe("imageUrl");
    expect(dashscopeImageMessageMarkdownExpr("image_url")).toContain("![Generated image]");
  });

  test("smart-router companion language-model (injected id) uses dual-output DSL for model port", () => {
    const lmComponent: FlowComponentCatalogItem = {
      id: "builtin:language-model",
      componentKey: "language-model",
      componentName: "语言模型",
      componentGroup: "基础",
      componentType: "processor",
      componentVersion: "1.0.0",
      mappingType: "preset-node",
      mappingTarget: "cube.lf.CustomComponent",
      iconUrl: null,
      enabled: true,
      isBuiltin: true,
      presentationSchema: null,
      protocolSchema: { inputs: ["input"], outputs: ["message"] },
      executionPolicy: null,
    };
    const companionId = smartRouterCompanionLlmNodeId("router-a");
    const node = buildRuntimeNode(
      {
        id: companionId,
        componentKey: "language-model",
        label: "—",
        position: { x: 0, y: 0 },
        data: {
          config: {
            modelId: "m1",
            systemMessage: "",
            userMessage: "",
            temperature: 0.3,
          },
        },
      },
      lmComponent,
      {
        languageModelRuntimeByNodeId: new Map([
          [
            companionId,
            {
              providerType: "openai_compatible",
              apiBaseUrl: "https://api.example.com",
              chatUrl: "https://api.example.com/v1/chat/completions",
              apiKey: "sk-test",
              modelCode: "gpt-4o-mini",
            },
          ],
        ]),
      },
    );
    const dsl = (node.config as Record<string, unknown>).cube_dsl as Record<string, unknown>;
    expect((dsl.metadata as { name?: string }).name).toBe("AiApplicationLanguageModelOpenAIRouterCompanion");
    expect(dsl.output).toBeUndefined();
    const outs = dsl.outputs as Array<{ kind?: string; value_from?: string }>;
    expect(outs?.length).toBe(2);
    expect(outs[0]?.kind).toBe("language_model");
    expect(outs[0]?.value_from).toBe("tenant_lm");
    const wfBlocks = (dsl.workflow as { blocks?: Array<{ output_as?: string }> })?.blocks;
    expect(wfBlocks?.some((b) => b.output_as === "tenant_lm")).toBe(true);
  });

  test("language-model without runtime still maps to cube.lf.CustomComponent for cube-ai sync", () => {
    const lmComponent: FlowComponentCatalogItem = {
      id: "builtin:language-model",
      componentKey: "language-model",
      componentName: "语言模型",
      componentGroup: "基础",
      componentType: "processor",
      componentVersion: "1.0.0",
      mappingType: "preset-node",
      mappingTarget: "cube.lf.CustomComponent",
      iconUrl: null,
      enabled: true,
      isBuiltin: true,
      presentationSchema: null,
      protocolSchema: { inputs: ["input"], outputs: ["message"] },
      executionPolicy: null,
    };

    const node = buildRuntimeNode(
      {
        id: "node-lm-unresolved",
        componentKey: "language-model",
        label: "LLM",
        position: { x: 10, y: 20 },
        data: {
          config: {
            modelId: "snowflake-model-id",
            systemMessage: "",
            userMessage: "",
          },
        },
      },
      lmComponent,
      {},
    );

    expect(node.cubeType).toBe("cube.lf.CustomComponent");
    expect((node.config as Record<string, unknown>)["_unresolved_reason"]).toBe("language_model_runtime_missing");
    expect((node.config as Record<string, unknown>).model_code).toBe("snowflake-model-id");
    expect((node.config as Record<string, unknown>).cube_dsl).toBeTruthy();
  });

  test("smart-router maps routes to cube-ai fields and points companion language model lf id", () => {
    const srComponent: FlowComponentCatalogItem = {
      id: "builtin:smart-router",
      componentKey: "smart-router",
      componentName: "智能路由",
      componentGroup: "基础",
      componentType: "router",
      componentVersion: "1.0.0",
      mappingType: "subgraph-template",
      mappingTarget: "cube.lf.SmartRouter",
      iconUrl: null,
      enabled: true,
      isBuiltin: true,
      presentationSchema: null,
      protocolSchema: { inputs: ["input_text", "model"], outputs: ["route"] },
      executionPolicy: null,
    };
    const rid = "550e8400-e29b-41d4-a716-446655440000";
    const node = buildRuntimeNode(
      {
        id: rid,
        componentKey: "smart-router",
        label: "SR",
        position: { x: 0, y: 0 },
        data: {
          config: {
            modelId: "m1",
            routes: [
              { route_name: "A", route_description: "Desc A", route_message: "Msg A" },
              { route_name: "B", route_description: "Desc B", route_message: "Msg B" },
            ],
            temperature: 0.2,
            custom_prompt: "Prefer route B when ambiguous.",
          },
        },
      },
      srComponent,
      {},
    );
    expect(node.cubeType).toBe("cube.lf.SmartRouter");
    const cfg = node.config as Record<string, unknown>;
    const companionLf = cfg.model_lf_node_id as string;
    expect(companionLf).toBe(lfNodeIdForCubeGraphNode("cube.lf.CustomComponent", smartRouterCompanionLlmNodeId(rid)));
    expect(cfg.modelId).toBeUndefined();
    const routes = cfg.routes as Array<Record<string, unknown>>;
    expect(routes[0]?.route_category).toBe("A");
    expect(routes[0]?.route_description).toBe("Desc A");
    expect(routes[0]?.output_value).toBe("Msg A");
    expect(cfg.temperature).toBe(0.2);
    expect(cfg.custom_prompt).toBe("Prefer route B when ambiguous.");
  });

  test("padSmartRouterCubeConfigRoutesMinRows appends rows so route count matches minRows for cube-ai", () => {
    const out = padSmartRouterCubeConfigRoutesMinRows(
      {
        modelId: "m1",
        routes: [{ route_name: "A" }, { route_name: "B" }],
      },
      5,
    );
    const routes = out.routes as Array<Record<string, unknown>>;
    expect(routes).toHaveLength(5);
    expect(routes[4]?.route_category).toBe("路由 5");
  });

  test("agent maps system_prompt and tenant companion CustomComponent lf id for external LLM", () => {
    const agentComponent: FlowComponentCatalogItem = {
      id: "builtin:agent",
      componentKey: "agent",
      componentName: "智能体",
      componentGroup: "基础",
      componentType: "processor",
      componentVersion: "1.0.0",
      mappingType: "preset-node",
      mappingTarget: "cube.lf.Agent",
      iconUrl: null,
      enabled: true,
      isBuiltin: true,
      presentationSchema: null,
      protocolSchema: { inputs: ["input_value", "tools", "agent_llm"], outputs: ["response"] },
      executionPolicy: null,
    };
    const rid = "660e8400-e29b-41d4-a716-446655440001";
    const node = buildRuntimeNode(
      {
        id: rid,
        componentKey: "agent",
        label: "Agent",
        position: { x: 0, y: 0 },
        data: {
          config: {
            modelId: "m1",
            systemPrompt: "你是助手",
            n_messages: 5,
            max_iterations: 12,
            add_current_date_tool: true,
          },
        },
      },
      agentComponent,
      {},
    );
    expect(node.cubeType).toBe("cube.lf.Agent");
    const cfg = node.config as Record<string, unknown>;
    expect(cfg.system_prompt).toBe("你是助手");
    expect(cfg.agent_llm).toBe("connect_other_models");
    expect(cfg.model).toBe("connect_other_models");
    expect(cfg.model_lf_node_id).toBe(lfNodeIdForCubeGraphNode("cube.lf.CustomComponent", agentCompanionLlmNodeId(rid)));
    expect(cfg.n_messages).toBe(5);
    expect(cfg.max_iterations).toBe(12);
    expect(cfg.add_current_date_tool).toBe(true);
    expect(cfg.modelId).toBeUndefined();
  });

  test("cubeNodeDimensionsForComponentKey agent matches canvas cards", () => {
    expect(cubeNodeDimensionsForComponentKey("agent")).toEqual({
      width: FLOW_AGENT_NODE_WIDTH,
      height: FLOW_AGENT_NODE_HEIGHT,
    });
  });
});
