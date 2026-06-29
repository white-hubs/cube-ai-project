import { type CubeFlowNode } from "../contracts/cube-flow";
import { getLfComponentDef } from "../langflow/lf-api-all-registry";
import {
  CUBE_CUSTOM_COMPONENT_DSL_KEY,
  CUBE_LF_CODE_OPAQUE_KEY,
  type CubeSchemaInputField,
  type CubeSchemaOutputField,
} from "../shared-imports/cube-component-schema";
import { buildCubeComponentSchemaFromDslPayload, readCustomDslMetadataForLf } from "./dsl-to-cube-schema";

function lfTemplateTypeForField(f: CubeSchemaInputField): string {
  switch (f.inputType) {
    case "QueryInput": {
      return "query";
    }
    case "MessageTextInput":
    case "StrInput":
    case "SecretStrInput":
    case "DropdownInput": {
      return "str";
    }
    case "BoolInput": {
      return "bool";
    }
    case "IntInput": {
      return "int";
    }
    case "FloatInput": {
      return "float";
    }
    case "HandleInput": {
      return "other";
    }
    default: {
      return typeof f.fieldType === "string" ? f.fieldType : "str";
    }
  }
}

function lfTemplateSlotFromSchemaInput(f: CubeSchemaInputField, configValue: unknown): Record<string, unknown> {
  const traceAsInput = f.inputTypes.length > 0 || f.inputType === "MessageTextInput" || f.inputType === "QueryInput";
  const val =
    configValue !== undefined && configValue !== null && configValue !== ""
      ? configValue
      : f.value !== undefined
        ? f.value
        : f.inputType === "BoolInput"
          ? false
          : "";

  const slot: Record<string, unknown> = {
    _input_type: f.inputType,
    advanced: f.advanced,
    display_name: f.displayName,
    dynamic: false,
    info: typeof f.info === "string" ? f.info : "",
    list: f.list === true,
    list_add_label: "Add More",
    load_from_db: false,
    name: f.name,
    override_skip: false,
    placeholder: typeof f.placeholder === "string" ? f.placeholder : "",
    required: f.required,
    show: f.show,
    title_case: false,
    tool_mode: f.fieldToolMode === true,
    trace_as_input: traceAsInput,
    trace_as_metadata: true,
    track_in_telemetry: false,
    type: lfTemplateTypeForField(f),
    value: val,
  };

  if (f.inputTypes.length > 0) {
    slot["input_types"] = [...f.inputTypes];
  }
  if (f.password) {
    slot["password"] = true;
  }
  if (Array.isArray(f.options) && f.options.length > 0) {
    const opts = f.options.filter((x): x is string => typeof x === "string");
    if (opts.length > 0) {
      slot["options"] = opts;
    }
  }

  return slot;
}

function lfOutputFromSchema(o: CubeSchemaOutputField): Record<string, unknown> {
  const types = o.types.length > 0 ? o.types : ["Data"];
  return {
    allows_loop: o.allowsLoop,
    cache: true,
    display_name: o.displayName,
    group_outputs: false,
    method: o.method ?? "build_output",
    name: o.name,
    selected: types[0],
    tool_mode: o.toolMode,
    types: [...types],
    value: "__UNDEFINED__",
  };
}

function cloneCodeSlotFromApiAll(apiAllPath: string): Record<string, unknown> {
  const def = getLfComponentDef("CustomComponent", apiAllPath);
  const t = def?.["template"] as Record<string, unknown> | undefined;
  const code = t?.["code"];
  if (code && typeof code === "object" && code !== null) {
    return JSON.parse(JSON.stringify(code)) as Record<string, unknown>;
  }
  return {
    _input_type: "CodeInput",
    advanced: true,
    dynamic: true,
    fileTypes: [],
    file_path: "",
    info: "",
    list: false,
    load_from_db: false,
    multiline: true,
    name: "code",
    password: false,
    placeholder: "",
    required: true,
    show: true,
    title_case: false,
    type: "code",
    value: "",
  };
}

/**
 * 将 Cube DSL + 已编译 LF 源码同步为 Langflow `data.node` 内与「Code Check & Save」等价的 template/outputs/field_order，
 * 避免 PATCH 后仍保留默认 `input_value` 桩导致连线目标（如 search_query）失效。
 */
export function rebuildLangflowCustomComponentInnerFromDsl(
  inner: Record<string, unknown>,
  cubeNode: CubeFlowNode,
  apiAllPath: string,
): boolean {
  if (cubeNode.cubeType !== "cube.lf.CustomComponent") {
    return false;
  }

  const cfg = cubeNode.config as Record<string, unknown>;
  const codeStr = cfg["code"];
  const dslRaw = cfg[CUBE_CUSTOM_COMPONENT_DSL_KEY];

  if (typeof codeStr !== "string" || codeStr.length === 0) {
    return false;
  }
  if (dslRaw === null || dslRaw === undefined || String(dslRaw).trim() === "") {
    return false;
  }

  const path = apiAllPath;

  const schema = buildCubeComponentSchemaFromDslPayload(dslRaw);
  const meta = readCustomDslMetadataForLf(dslRaw);

  const codeSlot = cloneCodeSlotFromApiAll(path);
  codeSlot["value"] = codeStr;

  const template: Record<string, unknown> = {
    _type: "Component",
    code: codeSlot,
  };

  for (const inp of schema.inputs) {
    const cv = cfg[inp.name];
    template[inp.name] = lfTemplateSlotFromSchemaInput(inp, cv);
  }

  const fieldOrder = schema.fieldOrder?.length ? [...schema.fieldOrder] : schema.inputs.map((i) => i.name);

  const outputs = schema.outputs.map(lfOutputFromSchema);

  inner["template"] = template;
  inner["outputs"] = outputs;
  inner["field_order"] = fieldOrder;
  inner["display_name"] = meta.display_name;
  inner["description"] = meta.description;
  inner["icon"] = meta.icon;

  mergeTemplateFromConfigForCustomComponent(template, cfg);

  return true;
}

/** 仅合入允许的 config 键到 template 槽位（与 graph-translator.mergeTemplateFromConfig 对齐，略） */
function mergeTemplateFromConfigForCustomComponent(template: Record<string, unknown>, config: Record<string, unknown>): void {
  for (const [k, val] of Object.entries(config)) {
    if (k === CUBE_CUSTOM_COMPONENT_DSL_KEY || k === CUBE_LF_CODE_OPAQUE_KEY) {
      continue;
    }
    if (k === "code") {
      continue;
    }
    const slot = template[k];
    if (slot && typeof slot === "object" && slot !== null && "value" in slot) {
      (slot as { value: unknown }).value = val;
      const s = slot as Record<string, unknown>;
      if (
        s["load_from_db"] === true &&
        (s["_input_type"] === "SecretStrInput" || s["password"] === true) &&
        typeof val === "string" &&
        val.length > 0
      ) {
        s["load_from_db"] = false;
      }
    }
  }
}
