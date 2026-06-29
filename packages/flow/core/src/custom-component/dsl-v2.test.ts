import { describe, expect, test } from "bun:test";

import { emptyCubeFlowGraph } from "../contracts/cube-flow";
import { CUBE_CUSTOM_COMPONENT_DSL_KEY } from "../shared-imports/cube-component-schema";
import { compileParsedDslV2, listPipForDslV2 } from "./compile-v2";
import { buildCubeComponentSchemaFromDslPayload } from "./dsl-to-cube-schema";
import { type CubeCustomComponentDslV2, safeParseCubeCustomComponentDslV2 } from "./dsl-v2.schema";
import { prepareCubeGraphLangflowExport } from "./prepare-graph-for-lf";
import { roughPythonBraceBalance } from "./static-check";
import { validateCubeCustomComponentGraph } from "./validate-graph";

function minimalV2(overrides: Partial<CubeCustomComponentDslV2> = {}): CubeCustomComponentDslV2 {
  const base: CubeCustomComponentDslV2 = {
    dslVersion: 2,
    extends: "component",
    inputs: [
      {
        kind: "message_text",
        name: "input_value",
        display_name: "Input",
        default: "x",
        tool_mode: true,
      },
    ],
    metadata: {
      description: "test",
      display_name: "V2 Demo",
      name: "V2Demo",
      wrap_build_in_try: false,
    },
    workflow: { blocks: [] },
    ...overrides,
  };
  return base;
}

describe("DSL v2 / schema", () => {
  test("safeParse accepts minimal v2", () => {
    const r = safeParseCubeCustomComponentDslV2(minimalV2());
    expect(r.success).toBe(true);
  });

  test("condition and nested blocks parse", () => {
    const dsl = minimalV2({
      workflow: {
        blocks: [
          {
            condition: { field: "input_value", kind: "non_empty" },
            else: [
              {
                type: "op",
                action: "assign",
                params: { expr: '"no"' },
                output_as: "flag",
              },
            ],
            then: [
              {
                type: "op",
                action: "assign",
                params: { expr: '"ok"' },
                output_as: "flag",
              },
            ],
            type: "if",
          },
        ],
      },
    });
    const r = safeParseCubeCustomComponentDslV2(dsl);
    expect(r.success).toBe(true);
  });
});

describe("DSL v2 / compile", () => {
  test("empty workflow falls back to first input", () => {
    const py = compileParsedDslV2(minimalV2());
    expect(py).toContain("class V2Demo(Component):");
    expect(py).toContain("self.input_value");
    expect(roughPythonBraceBalance(py).ok).toBe(true);
  });

  test("rejects both output and outputs", () => {
    const dsl = minimalV2({
      output: { kind: "data", method: "build_output", name: "output" },
      outputs: [{ kind: "data", method: "x", name: "a" }],
    });
    const r = safeParseCubeCustomComponentDslV2(dsl);
    expect(r.success).toBe(false);
  });

  test("output kind language_model emits LanguageModel and schema types", () => {
    const dsl = minimalV2({
      output: {
        display_name: "Model",
        kind: "language_model",
        method: "build_model",
        name: "model_output",
      },
    });
    const py = compileParsedDslV2(dsl);
    expect(py).toContain("from lfx.field_typing import LanguageModel");
    expect(py).toContain("def build_model(self) -> LanguageModel:");
    expect(py).toContain("return _lm");
    expect(buildCubeComponentSchemaFromDslPayload(dsl).outputs[0]!.types).toEqual(["LanguageModel"]);
    expect(roughPythonBraceBalance(py).ok).toBe(true);
  });

  test("outputs[] pairs LanguageModel + Message with cached workflow", () => {
    const dsl = minimalV2({
      outputs: [
        {
          display_name: "Model",
          kind: "language_model",
          method: "build_model",
          name: "model_output",
          value_from: "input_value",
        },
        {
          display_name: "Text",
          kind: "message",
          method: "build_text",
          name: "text_output",
          value_from: "input_value",
        },
      ],
    });
    const py = compileParsedDslV2(dsl);
    expect(py).toContain("def _cube_run_workflow_once(self)");
    expect(py).toContain("self._cube_o0");
    expect(py).toContain("self._cube_o1");
    expect(py).toContain("def build_model(self) -> LanguageModel:");
    expect(py).toContain("def build_text(self) -> Message:");
    expect(py).toContain(
      'self._cube_o1 = _cube_o1_value if isinstance(_cube_o1_value, Message) else Message(text=str(_cube_o1_value) if _cube_o1_value is not None else "", sender="Machine", sender_name="AI")',
    );
    expect(py).toContain('if getattr(self._cube_o1, "text", None) is None:');
    expect(py).toContain('if not getattr(self._cube_o1, "sender", None):');
    expect(py).toContain('if not getattr(self._cube_o1, "sender_name", None):');
    const sch = buildCubeComponentSchemaFromDslPayload(dsl);
    expect(sch.outputs.map((o) => o.types)).toEqual([["LanguageModel"], ["Message"]]);
    expect(roughPythonBraceBalance(py).ok).toBe(true);
  });

  test("output kind message wraps plain text and Cube schema types Message", () => {
    const dsl = minimalV2({
      output: {
        display_name: "Output",
        kind: "message",
        method: "build_output",
        name: "output",
      },
    });
    const py = compileParsedDslV2(dsl);
    expect(py).toContain("from lfx.schema.message import Message");
    expect(py).not.toContain("from lfx.schema.data import Data");
    expect(py).toContain("def build_output(self) -> Message:");
    expect(py).toContain(
      'msg = _cube_message_value if isinstance(_cube_message_value, Message) else Message(text=str(_cube_message_value) if _cube_message_value is not None else "", sender="Machine", sender_name="AI")',
    );
    expect(py).toContain('if getattr(msg, "text", None) is None:');
    expect(py).toContain('if not getattr(msg, "sender", None):');
    expect(py).toContain('if not getattr(msg, "sender_name", None):');
    expect(py).toContain("return msg");
    expect(buildCubeComponentSchemaFromDslPayload(dsl).outputs[0]!.types).toEqual(["Message"]);
    expect(roughPythonBraceBalance(py).ok).toBe(true);
  });

  test("message_merge op preserves Message inputs for multimodal forwarding", () => {
    const dsl = minimalV2({
      inputs: [
        {
          kind: "message_text",
          name: "text",
          display_name: "Text",
          default: "",
          tool_mode: true,
        },
        {
          kind: "handle",
          name: "original_message",
          display_name: "Original Message",
          input_types: ["Message"],
          required: true,
        },
      ],
      output: {
        display_name: "Message",
        kind: "message",
        method: "build_output",
        name: "message",
        value_from: "merged_message",
      },
      workflow: {
        blocks: [
          {
            type: "op",
            action: "message_merge",
            params: {
              text: "{{text}}",
              message: "{{original_message}}",
            },
            output_as: "merged_message",
          },
        ],
      },
    });

    const r = safeParseCubeCustomComponentDslV2(dsl);
    expect(r.success).toBe(true);

    const py = compileParsedDslV2(dsl);
    expect(py).toContain("HandleInput(");
    expect(py).toContain('input_types=["Message"]');
    expect(py).toContain('_merged_message_text = getattr(_merged_message_text_source, "text", None)');
    expect(py).toContain('_merged_message_original_text = getattr(_merged_message_source, "text", None)');
    expect(py).toContain("if not _merged_message_text and _merged_message_original_text:");
    expect(py).toContain(
      'merged_message = Message(text=str(_merged_message_text) if _merged_message_text is not None else "", sender="Machine", sender_name="AI")',
    );
    expect(py).toContain("if _merged_message_files is None and isinstance(_merged_message_source_data, dict):");
    expect(py).toContain("merged_message.files = _merged_message_files");
    expect(py).toContain('if not getattr(msg, "sender_name", None):');
    expect(buildCubeComponentSchemaFromDslPayload(dsl).inputs.find((i) => i.name === "original_message")?.inputTypes).toEqual(["Message"]);
    expect(buildCubeComponentSchemaFromDslPayload(dsl).outputs[0]!.types).toEqual(["Message"]);
    expect(roughPythonBraceBalance(py).ok).toBe(true);
  });

  test("message_to_openai_content op converts Message files to OpenAI content parts", () => {
    const dsl = minimalV2({
      inputs: [
        {
          kind: "handle",
          name: "input",
          display_name: "Input",
          input_types: ["Message"],
          required: false,
        },
      ],
      output: {
        display_name: "Output",
        kind: "data",
        method: "build_output",
        name: "output",
        value_from: "user_content",
      },
      workflow: {
        blocks: [
          {
            type: "op",
            action: "message_to_openai_content",
            params: {
              message: "{{input}}",
            },
            output_as: "user_content",
          },
        ],
      },
    });

    const r = safeParseCubeCustomComponentDslV2(dsl);
    expect(r.success).toBe(true);

    const py = compileParsedDslV2(dsl);
    expect(py).toContain("import base64");
    expect(py).toContain("import mimetypes");
    expect(py).toContain("import os");
    expect(py).toContain("import requests");
    expect(py).toContain("import urllib.parse");
    expect(py).toContain("from lfx.base.data.storage_utils import parse_storage_path, read_file_bytes");
    expect(py).toContain("from lfx.utils.async_helpers import run_until_complete");
    expect(py).toContain('_user_content_message_data = getattr(_user_content_message, "data", None)');
    expect(py).toContain("if not _user_content_text and isinstance(_user_content_message_data, dict):");
    expect(py).toContain("if _user_content_files is None and isinstance(_user_content_message_data, dict):");
    expect(py).toContain('user_content = str(_user_content_text or "")');
    expect(py).toContain('{"type": "text", "text": str(_user_content_text or "")}');
    expect(py).toContain('{"type": "image_url", "image_url": {"url": str(_user_content_url)}}');
    expect(py).toContain("_user_content_max_file_bytes = 20971520");
    expect(py).toContain(
      '_user_content_raw_candidates.extend([_user_content_file.get("path"), _user_content_file.get("file_path"), _user_content_file.get("url")',
    );
    expect(py).toContain("if parse_storage_path(_path):");
    expect(py).toContain("return run_until_complete(read_file_bytes(_path)), _path");
    expect(py).toContain("requests.get(_user_content_fetch_url, timeout=30)");
    expect(py).toContain('base64.b64encode(_user_content_bytes).decode("ascii")');
    expect(py).toContain('not str(_user_content_mime).lower().startswith("image/")');
    expect(py).toContain("if len(_user_content_bytes) > _user_content_max_file_bytes:");
    expect(py).toContain('raise RuntimeError("Message.files was provided but no image bytes could be read. "');
    expect(py).not.toContain("_user_content_url = _user_content_raw_url");
    expect(buildCubeComponentSchemaFromDslPayload(dsl).inputs[0]?.inputType).toBe("HandleInput");
    expect(roughPythonBraceBalance(py).ok).toBe(true);
  });

  test("message_to_openai_content op accepts custom local image size limit", () => {
    const dsl = minimalV2({
      inputs: [
        {
          kind: "handle",
          name: "input",
          display_name: "Input",
          input_types: ["Message"],
          required: false,
        },
      ],
      output: {
        display_name: "Output",
        kind: "data",
        method: "build_output",
        name: "output",
        value_from: "user_content",
      },
      workflow: {
        blocks: [
          {
            type: "op",
            action: "message_to_openai_content",
            params: {
              message: "{{input}}",
              max_file_bytes: 1024,
            },
            output_as: "user_content",
          },
        ],
      },
    });

    const py = compileParsedDslV2(dsl);

    expect(py).toContain("_user_content_max_file_bytes = 1024");
    expect(roughPythonBraceBalance(py).ok).toBe(true);
  });

  test("http op emits requests + json", () => {
    const dsl = minimalV2({
      workflow: {
        blocks: [
          {
            action: "http",
            output_as: "raw",
            params: {
              body: { query: "{{input_value}}" },
              body_type: "json",
              headers: { "Content-Type": "application/json" },
              method: "POST",
              timeout_ms: 300000,
              url: "http://example.com",
            },
            type: "op",
          },
          { action: "json_parse", output_as: "data", params: { from: "{{raw}}" }, type: "op" },
        ],
      },
    });
    const py = compileParsedDslV2(dsl);
    expect(py).toContain("import requests");
    expect(py).toContain("json.dumps(");
    expect(py).toContain("requests.request(");
    expect(py).toContain("timeout=300");
    expect(py).toMatch(/Content-Type.*application\/json|"application\/json"/u);
    expect(listPipForDslV2(dsl).some((p) => p.name === "requests")).toBe(true);
  });

  test("vector_store extends LCVectorStoreComponent and search_documents", () => {
    const dsl = minimalV2({
      extends: "vector_store",
      workflow: {
        blocks: [
          {
            action: "assign",
            output_as: "out",
            params: { expr: "[]" },
            type: "op",
          },
        ],
      },
    });
    const py = compileParsedDslV2(dsl);
    expect(py).toContain("class V2Demo(LCVectorStoreComponent):");
    expect(py).toContain("def search_documents(self) -> list[Data]:");
    expect(py).toContain("return out");
  });

  test("foreach emits for-loop", () => {
    const dsl = minimalV2({
      inputs: [
        {
          default: "[]",
          display_name: "Items",
          kind: "str",
          name: "items_json",
        },
      ],
      workflow: {
        blocks: [
          { action: "json_parse", output_as: "items", params: { from: "{{items_json}}" }, type: "op" },
          {
            as: "row",
            body: [
              {
                type: "op",
                action: "assign",
                params: { expr: '"x"' },
                output_as: "last",
              },
            ],
            over: "{{items}}",
            type: "foreach",
          },
        ],
      },
    });
    const py = compileParsedDslV2(dsl);
    expect(py).toContain("for row in items:");
  });

  test("transform builds Data list", () => {
    const dsl = minimalV2({
      extends: "vector_store",
      variables: [{ initial: "[]", name: "items" }],
      workflow: {
        blocks: [
          {
            action: "transform",
            output_as: "results",
            params: {
              from: "{{items}}",
              mapping: {
                data: { score: "$.score" },
                text: "$.text",
              },
            },
            type: "op",
          },
        ],
      },
    });
    const py = compileParsedDslV2(dsl);
    expect(py).toContain(".append(Data(");
    expect(py).toContain("for _it in items:");
  });

  test("prepare validates and compiles v2 graph", () => {
    const g = emptyCubeFlowGraph();
    g.nodes.push({
      config: { [CUBE_CUSTOM_COMPONENT_DSL_KEY]: JSON.stringify(minimalV2()) },
      cubeType: "cube.lf.CustomComponent",
      height: 80,
      id: "n1",
      lfNodeId: "lf1",
      width: 200,
      x: 0,
      y: 0,
    });
    validateCubeCustomComponentGraph(g);
    const p = prepareCubeGraphLangflowExport(g);
    expect((p.nodes[0]!.config["code"] as string).includes("V2Demo")).toBe(true);
  });

  test("handle input emits HandleInput for ingest_data", () => {
    const dsl = minimalV2({
      inputs: [
        {
          display_name: "Ingest Data",
          input_types: ["Data", "DataFrame"],
          is_list: true,
          kind: "handle",
          name: "ingest_data",
          required: false,
        },
        {
          default: "x",
          display_name: "Input",
          kind: "message_text",
          name: "input_value",
          tool_mode: true,
        },
      ],
    });
    const py = compileParsedDslV2(dsl);
    expect(py).toContain("HandleInput(");
    expect(py).toContain('name="ingest_data"');
    expect(py).toContain("Ingest Data");
    expect(py).toContain("is_list=True");
  });

  test("traits and ui_rules appear as comments", () => {
    const dsl = minimalV2({
      traits: ["logging"],
      ui_rules: [{ hide: ["api_url"], if: "mode == 'local'" }],
    });
    const py = compileParsedDslV2(dsl);
    expect(py).toContain("# cube DSL traits:");
    expect(py).toContain("# cube DSL ui_rules:");
  });
});
