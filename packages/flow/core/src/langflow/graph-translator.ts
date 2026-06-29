import {
  CUBE_FLOW_SCHEMA_VERSION,
  type CubeFlowEdge,
  type CubeFlowFieldUi,
  type CubeFlowGraph,
  type CubeFlowNode,
  emptyCubeFlowGraph,
} from "../contracts/cube-flow";
import { rebuildLangflowCustomComponentInnerFromDsl } from "../custom-component/lf-template-from-dsl";
import { type McpListedTool } from "../mcp/mcp-list-tools-sdk";
import {
  AGENT_LLM_CONNECT_OTHER,
  AGENT_PROVIDER_FIELD_NAME_SET,
  CUBE_CUSTOM_COMPONENT_DSL_KEY,
  CUBE_LF_CODE_OPAQUE_KEY,
  CUBE_MCPTOOLS_DYNAMIC_SCHEMA_CONFIG_KEY,
  MCPTOOLS_RESERVED_CUBE_CONFIG_KEYS,
  cubeConfigParserModeIsStringify,
  dedupeFieldOrderNames,
  isAgentExternalLlmMode,
  mcpToolInputSchemaToCubeSchemaInputs,
  mcpToolInputSchemaToLangflowToolsMetadataArgs,
  normalizeSmartRouterSemanticOutputName,
  resolvePromptTemplateVariableNames,
  sanitizeFieldOrderForTemplate,
  smartRouterOutputsFromConfig,
} from "../shared-imports/cube-component-schema";
import {
  type LfSourceHandleObj,
  type LfTargetHandleObj,
  isSourceHandleObj,
  isTargetHandleObj,
  parseLfHandleString,
  parseSemanticSourcePort,
  parseSemanticTargetPort,
  semanticSourcePort,
  semanticTargetPort,
  stringifyLfHandle,
} from "./lf-handle";
import { cubeMcpServerToLangflowMcpInputValue, isLangflowMcpInputServerValue } from "./lf-mcp-server-sync";
type MergeSources<T> = (T extends unknown ? (value: T) => void : never) extends (value: infer R) => void ? R : never;

function mergeObject<T extends object, S extends readonly object[]>(target: T, ...sources: S): T & MergeSources<S[number]> {
  const clone = { ...target } as T & MergeSources<S[number]>;
  return Object.assign(clone, ...sources);
}

type LfNode = Record<string, unknown>;
type LfEdge = Record<string, unknown>;

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/** Langflow 画布节点 `data.node` 上与组件定义无关的持久化字段；Cube 不存这些，合并后需从 base 快照恢复或回填。 */
const LF_INNER_PERSISTED_META_KEYS = ["lf_version", "last_updated"] as const;

function collectLfInnerMetadataByNodeId(rawNodes: unknown[]): {
  byId: Map<string, Record<string, unknown>>;
  sampleLfVersion?: string;
} {
  const byId = new Map<string, Record<string, unknown>>();
  let sampleLfVersion: string | undefined;
  if (!Array.isArray(rawNodes)) {
    return { byId, sampleLfVersion };
  }
  for (const raw of rawNodes) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const id = (raw as LfNode)["id"];
    if (typeof id !== "string") {
      continue;
    }
    const inner = ((raw as LfNode)["data"] as Record<string, unknown> | undefined)?.["node"] as Record<string, unknown> | undefined;
    if (!inner) {
      continue;
    }
    const meta: Record<string, unknown> = {};
    for (const k of LF_INNER_PERSISTED_META_KEYS) {
      const v = inner[k];
      if (v !== undefined) {
        meta[k] = v;
      }
    }
    if (typeof inner["score"] === "number") {
      meta["score"] = inner["score"];
    }
    if (inner["key"] !== undefined) {
      meta["key"] = inner["key"];
    }
    if (typeof inner["edited"] === "boolean") {
      meta["edited"] = inner["edited"];
    }
    if (Object.keys(meta).length > 0) {
      byId.set(id, meta);
    }
    const lv = inner["lf_version"];
    if (typeof lv === "string" && lv.trim() && sampleLfVersion === undefined) {
      sampleLfVersion = lv.trim();
    }
  }
  return { byId, sampleLfVersion };
}

function applyLfInnerMetadataToFlowNodes(
  rawNodes: unknown[],
  byId: Map<string, Record<string, unknown>>,
  fillMissingLfVersion?: string,
): void {
  if (!Array.isArray(rawNodes)) {
    return;
  }
  const fill = fillMissingLfVersion?.trim() || "";
  for (const raw of rawNodes) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const id = (raw as LfNode)["id"];
    if (typeof id !== "string") {
      continue;
    }
    const data = (raw as LfNode)["data"] as Record<string, unknown> | undefined;
    const inner = data?.["node"] as Record<string, unknown> | undefined;
    if (!inner) {
      continue;
    }
    const meta = byId.get(id);
    if (meta) {
      for (const [k, v] of Object.entries(meta)) {
        if (inner[k] === undefined) {
          inner[k] = v;
        }
      }
    }
    if (fill && inner["lf_version"] === undefined) {
      inner["lf_version"] = fill;
    }
  }
}

function templateToConfig(template: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(template)) {
    if (k === "code" || k === "_type") {
      continue;
    }
    if (v && typeof v === "object" && v !== null && "value" in v) {
      const val = (v as { value: unknown }).value;
      if (val !== null && typeof val === "object") {
        out[k] = deepClone(val as Record<string, unknown>);
      } else {
        out[k] = val;
      }
    }
  }
  return out;
}

/** LF 1.8.2+ Agent 使用 `model`；旧快照仅有 `agent_llm`。合并到 LF 模板前把旧键抄到 `model`，避免运行时缺 `model` 槽。 */
function agentConfigForLfTemplateMerge(config: Record<string, unknown>): Record<string, unknown> {
  if (config["model"] !== undefined || config["agent_llm"] === undefined) {
    return config;
  }
  return { ...config, model: config["agent_llm"] };
}

/**
 * 旧导出/旧前端可能只保留了 Agent ← 模型的连线，未把 `connect_other_models` 同步回 config。
 * Langflow 1.8.2 仍会按默认 provider 模板去解析 `OPENAI_API_KEY`，因此这里需要从 Cube 语义边反推外接模型模式。
 */
function agentHasIncomingExternalModelEdge(c: CubeFlowNode, cube: CubeFlowGraph): boolean {
  if (c.cubeType !== "cube.lf.Agent") {
    return false;
  }
  for (const e of cube.edges) {
    if (e.target !== c.id && e.target !== c.lfNodeId) {
      continue;
    }
    const tp = parseSemanticTargetPort(e.targetPort);
    if (!tp) {
      continue;
    }
    if (tp.nodeId !== c.id && tp.nodeId !== c.lfNodeId) {
      continue;
    }
    const fieldName = lfTargetFieldNameForCubeAgentEdge(c, tp.fieldName);
    if (fieldName === "model" || fieldName === "agent_llm") {
      return true;
    }
  }
  return false;
}

function effectiveAgentConfigForLfTemplateMerge(c: CubeFlowNode, cube: CubeFlowGraph): Record<string, unknown> {
  const merged = agentConfigForLfTemplateMerge(c.config);
  if (c.cubeType !== "cube.lf.Agent") {
    return merged;
  }
  if (isAgentExternalLlmMode(merged)) {
    return merged;
  }
  if (!agentHasIncomingExternalModelEdge(c, cube)) {
    return merged;
  }
  return {
    ...merged,
    agent_llm: AGENT_LLM_CONNECT_OTHER,
    model: AGENT_LLM_CONNECT_OTHER,
  };
}

/**
 * Cube 图协议里 Agent 外接语言模型的语义端口名为 `agent_llm`（与 Langflow 无关）；
 * Langflow 1.8.2+ 对应入桩为 `model`。仅在 **Cube → Langflow** 合并时转换，不改写已保存的 Cube 图。
 */
function lfTargetFieldNameForCubeAgentEdge(cubeTargetNode: { cubeType: string } | undefined, cubeSemanticField: string): string {
  if (cubeTargetNode?.cubeType === "cube.lf.Agent" && cubeSemanticField === "agent_llm") {
    return "model";
  }
  return cubeSemanticField;
}

function templateSlotIsLanguageModelHandle(slot: unknown): boolean {
  if (!slot || typeof slot !== "object") {
    return false;
  }
  const it = (slot as Record<string, unknown>)["input_types"];
  return Array.isArray(it) && (it as string[]).includes("LanguageModel");
}

function agentLfInnerTemplateIsExternalLlm(inner: Record<string, unknown>): boolean {
  const tpl = inner["template"];
  if (!tpl || typeof tpl !== "object") {
    return false;
  }
  const T = tpl as Record<string, unknown>;
  if (templateSlotIsLanguageModelHandle(T["model"])) {
    return true;
  }
  if (templateSlotIsLanguageModelHandle(T["agent_llm"])) {
    return true;
  }
  return false;
}

/**
 * Cube 已选内置 Provider，但 LF 快照里仍是外接 LM 的 template 时，用 api-all 整表重置（否则 merge 无法补回已删的 api_key 等槽）。
 */
function restoreAgentProviderTemplateFromDef(
  inner: Record<string, unknown>,
  resolveComponent: (lfKey: string) => Record<string, unknown> | null,
): void {
  const def = resolveComponent("Agent");
  if (!def || typeof def["template"] !== "object" || def["template"] === null) {
    return;
  }
  const freshTpl = deepClone(def["template"]) as Record<string, unknown>;
  // 必须保留 template.code：Langflow `POST /api/v1/custom_component/update` 要求 body.code；
  // 若此处删除 code，持久化到 LF 的节点无源码槽，画布上更新组件会 422（Field required: body.code）。
  inner["template"] = freshTpl;
  const fo = def["field_order"];
  if (Array.isArray(fo)) {
    const names = fo.filter((x): x is string => typeof x === "string");
    if (names.length > 0) {
      inner["field_order"] = dedupeFieldOrderNames(names);
    }
  }
}

/** Langflow：`connect_other_models` 时 template 中 `model`（LF 1.8.2+）或旧版 `agent_llm` 为 LanguageModel 桩并移除内置 Provider 字段。 */
function applyAgentExternalLlmLfTemplate(inner: Record<string, unknown>, config: Record<string, unknown>): void {
  if (!isAgentExternalLlmMode(config)) {
    return;
  }
  const tpl = inner["template"];
  if (!tpl || typeof tpl !== "object") {
    return;
  }
  const T = tpl as Record<string, unknown>;
  const raw = config["model"] ?? config["agent_llm"];
  const v = typeof raw === "string" ? raw : AGENT_LLM_CONNECT_OTHER;

  const patchSlot = (slotName: "model" | "agent_llm") => {
    const ag = T[slotName];
    if (!ag || typeof ag !== "object") {
      return;
    }
    const slot = ag as Record<string, unknown>;
    slot["input_types"] = ["LanguageModel"];
    slot["display_name"] = "Language Model";
    slot["placeholder"] = "Awaiting model input.";
    slot["value"] = v;
  };

  if ("model" in T) {
    patchSlot("model");
  } else if ("agent_llm" in T) {
    patchSlot("agent_llm");
  }

  for (const name of AGENT_PROVIDER_FIELD_NAME_SET) {
    delete T[name];
  }
  const foRaw = inner["field_order"];
  if (Array.isArray(foRaw)) {
    const filtered = foRaw.filter((x) => typeof x === "string" && !AGENT_PROVIDER_FIELD_NAME_SET.has(x));
    inner["field_order"] = dedupeFieldOrderNames(filtered as string[]);
  }
}

/** LF 全局变量占位符多为 `OPENAI_API_KEY`；`http://localhost:11434` 等字面量不得走 DB 解析。 */
function lfValueLooksLikeGlobalVarPlaceholder(val: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/u.test(val);
}

/**
 * api-all 中 Language Model 的 `ollama_base_url` 等默认 `load_from_db: true` + 默认 URL，
 * Langflow 会按「变量名」解析并报 variable not found。对非占位符字面量关闭 load_from_db。
 *
 * 第二遍：SecretStr 等槽若仍为 `load_from_db: true` 且 value 形如 `OPENAI_API_KEY`（Langflow 全局变量名），
 * 在未配置该变量时 LF 会报 variable not found。Cube→LF 同步时改为字面量模式，用户可在画布填写密钥或在 LF 侧改回全局变量。
 */
function normalizeLoadFromDbInlineLiteralsOneLevel(template: Record<string, unknown>): void {
  for (const [key, v] of Object.entries(template)) {
    if (key === "code" || key === "_type") {
      continue;
    }
    if (!v || typeof v !== "object" || !("value" in (v as object))) {
      continue;
    }
    const s = v as Record<string, unknown>;
    if (s["load_from_db"] !== true) {
      continue;
    }
    const val = s["value"];
    if (typeof val !== "string" || val.length === 0) {
      continue;
    }
    if (lfValueLooksLikeGlobalVarPlaceholder(val)) {
      continue;
    }
    s["load_from_db"] = false;
  }
  for (const [key, v] of Object.entries(template)) {
    if (key === "code" || key === "_type") {
      continue;
    }
    if (!v || typeof v !== "object" || !("value" in (v as object))) {
      continue;
    }
    const s = v as Record<string, unknown>;
    if (s["load_from_db"] !== true) {
      continue;
    }
    const isSecret = s["_input_type"] === "SecretStrInput" || s["password"] === true;
    if (!isSecret) {
      continue;
    }
    const val = s["value"];
    if (typeof val !== "string" || val.length === 0) {
      continue;
    }
    if (!lfValueLooksLikeGlobalVarPlaceholder(val)) {
      continue;
    }
    s["load_from_db"] = false;
  }
}

function descendNestedTemplatesForLoadFromDb(slotValue: unknown, depth: number): void {
  if (depth > 40) {
    return;
  }
  if (slotValue === null || typeof slotValue !== "object") {
    return;
  }
  if (Array.isArray(slotValue)) {
    for (const it of slotValue) {
      descendNestedTemplatesForLoadFromDb(it, depth + 1);
    }
    return;
  }
  const o = slotValue as Record<string, unknown>;
  const t = o["template"];
  if (t && typeof t === "object" && t !== null && !Array.isArray(t)) {
    normalizeLoadFromDbInlineLiteralsDeep(t as Record<string, unknown>, depth + 1);
  }
  const node = o["node"];
  if (node && typeof node === "object" && node !== null && !Array.isArray(node)) {
    const nt = (node as Record<string, unknown>)["template"];
    if (nt && typeof nt === "object" && nt !== null && !Array.isArray(nt)) {
      normalizeLoadFromDbInlineLiteralsDeep(nt as Record<string, unknown>, depth + 1);
    }
  }
}

/**
 * Agent `model` / ModelInput 等槽的 `value` 内可嵌套整段组件（`template.api_key`），仅规范化顶层会漏掉，
 * Langflow 仍会对嵌套槽解析全局变量并报 OPENAI_API_KEY variable not found。
 */
export function normalizeLoadFromDbInlineLiteralsDeep(template: Record<string, unknown>, depth = 0): void {
  if (depth > 40) {
    return;
  }
  normalizeLoadFromDbInlineLiteralsOneLevel(template);
  for (const [key, v] of Object.entries(template)) {
    if (key === "code" || key === "_type") {
      continue;
    }
    if (!v || typeof v !== "object" || !("value" in (v as object))) {
      continue;
    }
    descendNestedTemplatesForLoadFromDb((v as Record<string, unknown>)["value"], depth + 1);
  }
}

/** 对整份 LF `data` 扫描各节点 `template`（含嵌套）。由 `cubeGraphToLfFlowData` 返回前调用。 */
export function normalizeLfFlowDataLoadFromDbPlaceholders(lfData: Record<string, unknown>): void {
  const rawNodes = lfData["nodes"];
  if (!Array.isArray(rawNodes)) {
    return;
  }
  for (const raw of rawNodes) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const wrap = (raw as Record<string, unknown>)["data"];
    if (!wrap || typeof wrap !== "object") {
      continue;
    }
    const inner = (wrap as Record<string, unknown>)["node"];
    if (!inner || typeof inner !== "object") {
      continue;
    }
    const tpl = (inner as Record<string, unknown>)["template"];
    if (!tpl || typeof tpl !== "object" || tpl === null) {
      continue;
    }
    normalizeLoadFromDbInlineLiteralsDeep(tpl as Record<string, unknown>, 0);
  }
}

/**
 * 同步到外部编排草稿的节点模板前，将 MCP 输入值规范为含 `bizData` 的形状：
 * 已有 `bizData` 则原样写入（并去掉多余的 `config`）；仅有 `config` 时提升为 `bizData`。
 * 供本模块合并模板使用；单测可直接引用。
 */
export function normalizeMcpServerValueForFlowExport(val: unknown): unknown {
  if (val === null || val === undefined) {
    return val;
  }
  if (typeof val !== "object" || Array.isArray(val)) {
    return val;
  }
  const o = deepClone(val as Record<string, unknown>);
  const bd = o["bizData"];
  if (bd !== null && bd !== undefined && typeof bd === "object" && !Array.isArray(bd)) {
    if ("config" in o) {
      delete o["config"];
    }
    return o;
  }
  const cfg = o["config"];
  if (cfg !== null && cfg !== undefined && typeof cfg === "object" && !Array.isArray(cfg)) {
    delete o["config"];
    o["bizData"] = deepClone(cfg as Record<string, unknown>);
  }
  return o;
}

function mergeTemplateFromConfig(template: Record<string, unknown>, config: Record<string, unknown>): void {
  for (const [k, val] of Object.entries(config)) {
    if (k === CUBE_MCPTOOLS_DYNAMIC_SCHEMA_CONFIG_KEY) {
      continue;
    }
    if (k === CUBE_CUSTOM_COMPONENT_DSL_KEY || k === CUBE_LF_CODE_OPAQUE_KEY) {
      continue;
    }
    const slot = template[k];
    if (slot && typeof slot === "object" && slot !== null && "value" in slot) {
      let toWrite: unknown = val;
      if (k === "mcp_server") {
        toWrite = isLangflowMcpInputServerValue(val) ? val : normalizeMcpServerValueForFlowExport(val);
      }
      if (k === "tool" && toWrite !== null && toWrite !== undefined && typeof toWrite !== "string") {
        toWrite = String(toWrite).trim();
      }
      (slot as { value: unknown }).value = toWrite;
      const s = slot as Record<string, unknown>;
      // Langflow：SecretStr 等字段 `load_from_db: true` 时从全局变量解析，不会采用 flow 文档里的 value；
      // Cube 侧显式写入的密钥需落盘到 flow，否则 PATCH 后 LF 画布仍为空（见 OpenAIModel `api_key` 等）。
      if (
        s["load_from_db"] === true &&
        (s["_input_type"] === "SecretStrInput" || s["password"] === true) &&
        typeof val === "string" &&
        val.length > 0
      ) {
        s["load_from_db"] = false;
      } else if (s["load_from_db"] === true && typeof val === "string" && val.length > 0 && !lfValueLooksLikeGlobalVarPlaceholder(val)) {
        // MessageTextInput / StrInput 等：图内字面量（URL、路径等）勿当变量名
        s["load_from_db"] = false;
      }
    }
  }
}

/** Langflow `update_build_config` 在切 MCP server 时会把 `tool.value` 写成随机 UUID，仅用于触发表单刷新，不是可执行工具名。 */
function isLangflowMcpToolRefreshUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.trim());
}

/** 从 `template.tool` 槽读当前值（LF 可能为 str；少数序列化下为 number）。 */
function readTemplateToolValueString(toolSlot: unknown): string {
  if (!toolSlot || typeof toolSlot !== "object" || toolSlot === null || !("value" in toolSlot)) {
    return "";
  }
  const v = (toolSlot as Record<string, unknown>)["value"];
  if (typeof v === "string") {
    return v.trim();
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(v);
  }
  return "";
}

function readLfInnerTemplateToolStringValue(inner: Record<string, unknown>): string {
  const tpl = inner["template"];
  if (!tpl || typeof tpl !== "object" || tpl === null) {
    return "";
  }
  return readTemplateToolValueString((tpl as Record<string, unknown>)["tool"]);
}

/** 与 api-all MCPTools 一致的固定输入槽；若 LF 快照缺 `tool` 等或槽无 `value`，merge 会整段跳过，导致 Cube 已选 tool 永远写不进去。 */
const LF_MCPTOOLS_BASELINE_TEMPLATE_KEYS = ["mcp_server", "use_cache", "verify_ssl", "tool", "tool_placeholder"] as const;

function lfTemplateSlotMissingOrInvalid(slot: unknown): boolean {
  if (slot === null || slot === undefined) {
    return true;
  }
  if (typeof slot !== "object" || Array.isArray(slot)) {
    return true;
  }
  return !("value" in (slot as object));
}

function ensureMcpToolsBaselineTemplateSlots(
  inner: Record<string, unknown>,
  resolveComponent?: (lfComponentKey: string) => Record<string, unknown> | null,
): void {
  if (!resolveComponent) {
    return;
  }
  const def = resolveComponent("MCPTools");
  if (!def || typeof def["template"] !== "object" || def["template"] === null) {
    return;
  }
  let tpl = inner["template"] as Record<string, unknown> | undefined;
  if (!tpl || typeof tpl !== "object") {
    tpl = {};
    inner["template"] = tpl;
  }
  const baseline = def["template"] as Record<string, unknown>;
  for (const key of LF_MCPTOOLS_BASELINE_TEMPLATE_KEYS) {
    if (!lfTemplateSlotMissingOrInvalid(tpl[key])) {
      continue;
    }
    const b = baseline[key];
    if (b && typeof b === "object" && !Array.isArray(b)) {
      tpl[key] = deepClone(b as Record<string, unknown>);
    }
  }
}

function mcpToolNameFromCubeConfig(cfg: Record<string, unknown>): string {
  const raw = cfg["tool"];
  if (typeof raw === "string") {
    return raw.trim();
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return String(raw);
  }
  if (raw !== null && raw !== undefined && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const n = o["name"] ?? o["value"];
    if (typeof n === "string" && n.trim()) {
      return n.trim();
    }
    if (typeof n === "number" && Number.isFinite(n)) {
      return String(n);
    }
  }
  return "";
}

/**
 * 合并后再写入一次：当 `effectiveMcpToolsConfigForLfTemplateMerge` 未带 `tool` 键、`mergeTemplateFromConfig` 未触达槽位、
 * 或客户端以非字符串形态落盘 `config.tool` 时，仍可把 Cube 已选工具写进 LF `template.tool.value`（供 PATCH 与首次打开 LF 使用）。
 */
function applyCubeMcpToolSelectionToLfTemplate(template: Record<string, unknown>, cubeCfg: Record<string, unknown>): void {
  const name = mcpToolNameFromCubeConfig(cubeCfg);
  if (!name) {
    return;
  }
  const slot = template["tool"];
  if (!slot || typeof slot !== "object" || slot === null || !("value" in slot)) {
    return;
  }
  (slot as Record<string, unknown>)["value"] = name;
}

/**
 * Cube 端在 tools/list 晚返回时可能把 `config.tool` 清空，但动态参数字段仍在；合并 LF 模板时不要据此把 LF 侧 tool 冲成空。
 * 若 Cube 未提供工具名，则沿用当前 LF 快照 `template.tool.value`（排除刷新用 UUID）。
 */
function effectiveMcpToolsConfigForLfTemplateMerge(c: CubeFlowNode, inner: Record<string, unknown>): Record<string, unknown> {
  const base = c.config;
  if (c.cubeType !== "cube.lf.MCPTools") {
    return base;
  }
  const out = { ...base };
  out["mcp_server"] = cubeMcpServerToLangflowMcpInputValue(out["mcp_server"], out["verify_ssl"]);
  const t = mcpToolNameFromCubeConfig(out);
  if (t) {
    out["tool"] = t;
  } else {
    const snap = readLfInnerTemplateToolStringValue(inner);
    if (snap && !isLangflowMcpToolRefreshUuid(snap)) {
      out["tool"] = snap;
    }
  }
  return out;
}

/**
 * LF Dropdown 的 `options` 常为空直到前端/组件内 `update_tool_list`。
 * Cube→LF **推送**（`pushToLangflow`）在 `patchFlow` 前会调用 `enrichLfFlowDataWithLiveMcpToolOptions`，按 MCP URL 拉全量 tools 写入 `options`。
 * 此处仅在合并阶段 `options` 仍缺少当前 `value` 时**追加该工具名**（stdio 无 URL、或 live list 失败时的回退）。
 */
function ensureMcpToolsToolSlotCoherent(template: Record<string, unknown>): void {
  const slot = template["tool"];
  if (!slot || typeof slot !== "object" || slot === null || !("value" in slot)) {
    return;
  }
  const s = slot as Record<string, unknown>;
  const toolName = readTemplateToolValueString(slot);
  if (!toolName || isLangflowMcpToolRefreshUuid(toolName)) {
    return;
  }
  if (typeof s["value"] !== "string") {
    s["value"] = toolName;
  }
  const optsRaw = s["options"];
  const opts = Array.isArray(optsRaw) ? (optsRaw as unknown[]).filter((x): x is string => typeof x === "string") : [];
  if (!opts.includes(toolName)) {
    s["options"] = [...opts, toolName];
  }
}

/** 与 api-all MCPTools `field_order` 一致（无动态段） */
const LF_MCPTOOLS_DEFAULT_FIELD_ORDER = ["mcp_server", "use_cache", "verify_ssl", "tool", "tool_placeholder"] as const;

function readMcpDescriptorName(d: Record<string, unknown>): string {
  const n = d["name"];
  return typeof n === "string" && n ? n : "";
}

/** 无 `mcpDynamicSchemaInputs` 时从 config 非保留键推断（与 cube prune 规则一致） */
function mcpDescriptorsForLfExport(c: CubeFlowNode): Record<string, unknown>[] {
  let raw = c.mcpDynamicSchemaInputs;
  if (!Array.isArray(raw) || raw.length === 0) {
    const cfg = c.config;
    const bak = cfg?.[CUBE_MCPTOOLS_DYNAMIC_SCHEMA_CONFIG_KEY];
    if (Array.isArray(bak) && bak.length > 0) {
      raw = bak as Record<string, unknown>[];
    }
  }
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.filter((x): x is Record<string, unknown> => x !== null && x !== undefined && typeof x === "object" && !Array.isArray(x));
  }
  const names: string[] = [];
  for (const k of Object.keys(c.config)) {
    if (k === "display_name") {
      continue;
    }
    if (k === CUBE_MCPTOOLS_DYNAMIC_SCHEMA_CONFIG_KEY) {
      continue;
    }
    if (MCPTOOLS_RESERVED_CUBE_CONFIG_KEYS.has(k)) {
      continue;
    }
    names.push(k);
  }
  names.sort();
  return names.map((name) => ({
    displayName: name.replace(/_/gu, " ").replace(/\b\w/gu, (ch) => ch.toUpperCase()),
    fieldType: "str",
    info: "",
    inputType: "MessageTextInput",
    name,
    required: false,
  }));
}

/** 若客户端只写了 `config` 内备份而无顶层 `mcpDynamicSchemaInputs`，补全后便于 SQLite / LF 同步一致 */
export function normalizeCubeGraphMcpDynamicSchema(graph: CubeFlowGraph): CubeFlowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      if (n.cubeType !== "cube.lf.MCPTools") {
        return n;
      }
      const top = n.mcpDynamicSchemaInputs;
      if (Array.isArray(top) && top.length > 0) {
        return n;
      }
      const bak = n.config?.[CUBE_MCPTOOLS_DYNAMIC_SCHEMA_CONFIG_KEY];
      if (!Array.isArray(bak) || bak.length === 0) {
        return n;
      }
      return mergeObject({}, n, {
        mcpDynamicSchemaInputs: bak.map((x) =>
          x !== null && x !== undefined && typeof x === "object" && !Array.isArray(x) ? mergeObject({}, x as Record<string, unknown>) : {},
        ),
      });
    }),
  };
}

function lfCoerceConfigForMcpSlot(fieldType: string, inputType: string, configVal: unknown): unknown {
  if (configVal === undefined) {
    if (inputType === "BoolInput") {
      return false;
    }
    if (inputType === "IntInput") {
      return 0;
    }
    if (inputType === "FloatInput") {
      return 0;
    }
    if (inputType === "CodeInput") {
      return "";
    }
    return "";
  }
  if (inputType === "BoolInput") {
    return configVal === true || configVal === "true";
  }
  if (inputType === "IntInput") {
    const n = typeof configVal === "number" ? configVal : Number(configVal);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  if (inputType === "FloatInput") {
    const n = typeof configVal === "number" ? configVal : Number(configVal);
    return Number.isFinite(n) ? n : 0;
  }
  if (inputType === "CodeInput") {
    if (typeof configVal === "string") {
      return configVal;
    }
    try {
      return JSON.stringify(configVal);
    } catch {
      return "";
    }
  }
  if (typeof configVal === "string") {
    return configVal;
  }
  if (configVal === null || configVal === undefined) {
    return "";
  }
  try {
    return JSON.stringify(configVal);
  } catch {
    return String(configVal);
  }
}

/**
 * 将设计器侧 MCP tool 参数描述转为 Langflow `inner.template` 槽（与 `schema_to_langflow_inputs` 形状对齐）。
 */
function lfMcpDynamicTemplateSlot(descriptor: Record<string, unknown>, configVal: unknown): Record<string, unknown> {
  const name = readMcpDescriptorName(descriptor);
  const displayNameRaw = descriptor["displayName"] ?? descriptor["display_name"];
  const displayName = typeof displayNameRaw === "string" && displayNameRaw.trim() ? displayNameRaw.trim() : name;
  const infoRaw = descriptor["info"];
  const info = typeof infoRaw === "string" ? infoRaw : "";
  const required = descriptor["required"] === true;
  const inputTypeRaw = descriptor["inputType"] ?? descriptor["input_type"];
  const inputType = typeof inputTypeRaw === "string" ? inputTypeRaw : "MessageTextInput";
  const fieldTypeRaw = descriptor["fieldType"] ?? descriptor["type"];
  const fieldType = typeof fieldTypeRaw === "string" ? fieldTypeRaw : "str";
  const val = lfCoerceConfigForMcpSlot(fieldType, inputType, configVal);

  if (inputType === "BoolInput") {
    return {
      _input_type: "BoolInput",
      advanced: false,
      display_name: displayName,
      dynamic: false,
      info,
      list: false,
      list_add_label: "Add More",
      name,
      override_skip: false,
      placeholder: "",
      required,
      show: true,
      title_case: false,
      tool_mode: false,
      trace_as_metadata: true,
      track_in_telemetry: true,
      type: "bool",
      value: val === true,
    };
  }
  if (inputType === "IntInput") {
    return {
      _input_type: "IntInput",
      advanced: false,
      display_name: displayName,
      dynamic: false,
      info,
      list: false,
      list_add_label: "Add More",
      name,
      override_skip: false,
      placeholder: "",
      required,
      show: true,
      title_case: false,
      tool_mode: false,
      trace_as_metadata: true,
      track_in_telemetry: true,
      type: "int",
      value: val as number,
    };
  }
  if (inputType === "FloatInput") {
    return {
      _input_type: "FloatInput",
      advanced: false,
      display_name: displayName,
      dynamic: false,
      info,
      list: false,
      list_add_label: "Add More",
      name,
      override_skip: false,
      placeholder: "",
      required,
      show: true,
      title_case: false,
      tool_mode: false,
      trace_as_metadata: true,
      track_in_telemetry: true,
      type: "float",
      value: val as number,
    };
  }
  if (inputType === "CodeInput") {
    return {
      _input_type: "CodeInput",
      advanced: false,
      display_name: displayName,
      dynamic: false,
      info,
      list: false,
      list_add_label: "Add More",
      name,
      override_skip: false,
      placeholder: "",
      required,
      show: true,
      title_case: false,
      tool_mode: false,
      trace_as_input: true,
      track_in_telemetry: false,
      type: "code",
      value: typeof val === "string" ? val : String(val),
    };
  }
  const inputTypesRaw = descriptor["inputTypes"] ?? descriptor["input_types"];
  const inputTypes = Array.isArray(inputTypesRaw)
    ? (inputTypesRaw as unknown[]).filter((x): x is string => typeof x === "string")
    : ["Message"];
  return {
    _input_type: "MessageTextInput",
    advanced: false,
    display_name: displayName,
    dynamic: false,
    info,
    input_types: inputTypes.length > 0 ? inputTypes : ["Message"],
    list: false,
    list_add_label: "Add More",
    load_from_db: false,
    name,
    override_skip: false,
    placeholder: "Type something...",
    required,
    show: true,
    title_case: false,
    tool_mode: false,
    trace_as_input: true,
    trace_as_metadata: true,
    track_in_telemetry: false,
    type: fieldType === "str" ? "str" : fieldType,
    value: typeof val === "string" ? val : val === null || val === undefined ? "" : String(val),
  };
}

function mergeMcpToolsLfFieldOrder(inner: Record<string, unknown>, dynamicNamesInOrder: string[]): void {
  const raw = inner["field_order"];
  const base = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [...LF_MCPTOOLS_DEFAULT_FIELD_ORDER];
  const dynSet = new Set(dynamicNamesInOrder);
  const withoutDyn = base.filter((n) => !dynSet.has(n));
  const ti = withoutDyn.indexOf("tool");
  const merged =
    ti !== -1
      ? [...withoutDyn.slice(0, ti + 1), ...dynamicNamesInOrder, ...withoutDyn.slice(ti + 1)]
      : [...withoutDyn, ...dynamicNamesInOrder];
  inner["field_order"] = dedupeFieldOrderNames(merged);
}

/**
 * Langflow `mergeTemplateFromConfig` 只更新已有槽；MCP 动态参数须在合并前注入 `template` 与 `field_order`。
 */
function syncLfMcpToolsDynamicInputs(inner: Record<string, unknown>, c: CubeFlowNode): void {
  if (c.cubeType !== "cube.lf.MCPTools") {
    return;
  }
  const tpl = inner["template"];
  if (!tpl || typeof tpl !== "object" || tpl === null) {
    return;
  }
  const T = tpl as Record<string, unknown>;

  const descriptors = mcpDescriptorsForLfExport(c);
  const dynamicNamesInOrder = descriptors.map((d) => readMcpDescriptorName(d)).filter((n) => n !== "");
  const dynamicSet = new Set(dynamicNamesInOrder);

  for (const key of Object.keys(T)) {
    if (key === "code" || key === "_type") {
      continue;
    }
    if (MCPTOOLS_RESERVED_CUBE_CONFIG_KEYS.has(key)) {
      continue;
    }
    if (!dynamicSet.has(key)) {
      delete T[key];
    }
  }

  for (const d of descriptors) {
    const name = readMcpDescriptorName(d);
    if (!name) {
      continue;
    }
    const configVal = c.config[name];
    T[name] = lfMcpDynamicTemplateSlot(d, configVal);
  }

  mergeMcpToolsLfFieldOrder(inner, dynamicNamesInOrder);
}

/**
 * 节点 Tool 模式（Toolset）：LF 侧由组件 `schema_inputs` / 工具元数据管理参数字段，主 `template` 不应保留
 * `begin_time` 等 Message 槽，否则与 Langflow 前端重复渲染（cube-ai 画布仍需动态桩，仅导出 LF 时剥除）。
 */
function stripMcpToolsDynamicSlotsForLangflowToolset(inner: Record<string, unknown>): void {
  const tpl = inner["template"];
  if (!tpl || typeof tpl !== "object" || tpl === null) {
    return;
  }
  const T = tpl as Record<string, unknown>;
  for (const key of Object.keys(T)) {
    if (key === "code" || key === "_type") {
      continue;
    }
    if (MCPTOOLS_RESERVED_CUBE_CONFIG_KEYS.has(key)) {
      continue;
    }
    delete T[key];
  }
  mergeMcpToolsLfFieldOrder(inner, []);
}

/**
 * 解析当前应对外展示/编辑的 MCP 工具名，供 Push 时从 `listTools` 回填 `inputSchema` 动态槽。
 * 顺序：`template.tool.value`（排除 LF 刷新 UUID）→ `config.tool` → `tools_metadata` 首行 `name`。
 */
function mcpPrimaryToolNameForDynamicSchema(cube: CubeFlowNode, template: Record<string, unknown>): string {
  const toolSlot = template["tool"];
  const fromTpl = readTemplateToolValueString(toolSlot);
  if (fromTpl && !isLangflowMcpToolRefreshUuid(fromTpl)) {
    return fromTpl;
  }
  const fromCfg = mcpToolNameFromCubeConfig(cube.config);
  if (fromCfg) {
    return fromCfg;
  }
  const tm = cube.config["tools_metadata"];
  if (Array.isArray(tm) && tm.length > 0) {
    const row0 = tm[0];
    if (row0 && typeof row0 === "object" && !Array.isArray(row0)) {
      const n = (row0 as Record<string, unknown>)["name"];
      if (typeof n === "string" && n.trim()) {
        return n.trim();
      }
    }
  }
  return "";
}

/**
 * Push 前：若 Cube 未持久化 `mcpDynamicSchemaInputs`（仅画布上有工具、参数在 cube-ai 侧可预览），
 * 则用已 enrich 的 `listTools` 命中当前工具并注入 LF `inner.template` 动态槽，避免 LF 打开后参数区空白直至手动切 tool。
 */
export function injectLfMcpToolsDynamicSlotsFromListedTools(
  lfData: Record<string, unknown>,
  cubeGraph: CubeFlowGraph,
  listedByLfNodeId: Map<string, McpListedTool[]>,
): void {
  const rawNodes = lfData["nodes"];
  if (!Array.isArray(rawNodes)) {
    return;
  }
  const byLf = new Map(cubeGraph.nodes.map((n) => [n.lfNodeId, n]));

  for (const raw of rawNodes) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const node = raw as Record<string, unknown>;
    const id = typeof node["id"] === "string" ? node["id"] : "";
    if (!id) {
      continue;
    }
    const cube = byLf.get(id);
    if (!cube || cube.cubeType !== "cube.lf.MCPTools") {
      continue;
    }
    /** Toolset：由 LF 管理参数 UI，勿再向 template 注入动态槽（避免与 schema_inputs 重复） */
    if (cube.fieldUi?.nodeToolMode === true) {
      continue;
    }

    if (mcpDescriptorsForLfExport(cube).length > 0) {
      continue;
    }

    const listed = listedByLfNodeId.get(id);
    if (!listed?.length) {
      continue;
    }

    const wrap = node["data"];
    if (!wrap || typeof wrap !== "object") {
      continue;
    }
    const inner = (wrap as Record<string, unknown>)["node"];
    if (!inner || typeof inner !== "object") {
      continue;
    }

    const tpl = (inner as Record<string, unknown>)["template"];
    if (!tpl || typeof tpl !== "object") {
      continue;
    }
    const T = tpl as Record<string, unknown>;

    const toolName = mcpPrimaryToolNameForDynamicSchema(cube, T);
    if (!toolName) {
      continue;
    }
    const hit = listed.find((t) => t.name.trim() === toolName.trim());
    if (hit === null || hit === undefined || hit.inputSchema === null || hit.inputSchema === undefined) {
      continue;
    }

    const fields = mcpToolInputSchemaToCubeSchemaInputs(hit.inputSchema);
    if (fields.length === 0) {
      continue;
    }

    const asRecords: Record<string, unknown>[] = fields.map((f) =>
      mergeObject(
        {
          displayName: f.displayName,
          fieldType: f.fieldType,
          info: f.info,
          inputType: f.inputType,
          name: f.name,
          required: f.required,
        },
        f.inputTypes?.length ? { inputTypes: f.inputTypes } : {},
      ),
    );
    const synthetic: CubeFlowNode = { ...cube, mcpDynamicSchemaInputs: asRecords };
    syncLfMcpToolsDynamicInputs(inner as Record<string, unknown>, synthetic);
  }
}

function cubeMcpDynamicSchemaInputsFromLfTemplate(
  cubeType: string,
  template: Record<string, unknown>,
  fieldOrder: string[] | undefined,
): Record<string, unknown>[] {
  if (cubeType !== "cube.lf.MCPTools") {
    return [];
  }
  const order = (fieldOrder?.length ? fieldOrder : Object.keys(template)).filter((k) => {
    if (k === "code" || k === "_type") {
      return false;
    }
    if (MCPTOOLS_RESERVED_CUBE_CONFIG_KEYS.has(k)) {
      return false;
    }
    return lfTemplateSlotHasValue(template[k]);
  });
  const out: Record<string, unknown>[] = [];
  for (const k of order) {
    const v = template[k];
    if (!lfTemplateSlotHasValue(v)) {
      continue;
    }
    const slot = v as Record<string, unknown>;
    const it = slot["input_types"];
    const inputTypes = Array.isArray(it) ? (it as unknown[]).filter((x): x is string => typeof x === "string") : ["Message"];
    out.push({
      advanced: slot["advanced"] === true,
      displayName: typeof slot["display_name"] === "string" && slot["display_name"].trim() ? String(slot["display_name"]).trim() : k,
      fieldToolMode: slot["tool_mode"] === true,
      fieldType: typeof slot["type"] === "string" ? slot["type"] : "str",
      info: typeof slot["info"] === "string" ? slot["info"] : "",
      inputType: typeof slot["_input_type"] === "string" ? slot["_input_type"] : "MessageTextInput",
      inputTypes,
      name: k,
      password: slot["password"] === true,
      required: slot["required"] === true,
      show: slot["show"] !== false,
      value: slot["value"],
    });
  }
  return out;
}

/** LF `inner.template` 中 PromptInput 槽的 `name`（一般为 `template`）。 */
function lfPromptSlotNameFromInnerTemplate(T: Record<string, unknown>): string {
  for (const [key, v] of Object.entries(T)) {
    if (key === "code" || key === "_type") {
      continue;
    }
    if (!v || typeof v !== "object") {
      continue;
    }
    const s = v as Record<string, unknown>;
    if (s["_input_type"] === "PromptInput" || s["type"] === "prompt") {
      return typeof s["name"] === "string" && s["name"] ? s["name"] : key;
    }
  }
  return "template";
}

function lfTemplateSlotHasValue(slot: unknown): slot is Record<string, unknown> {
  return Boolean(slot && typeof slot === "object" && slot !== null && "value" in (slot as object));
}

/** 与 LF `process_prompt_template` 生成的动态槽一致：可调线的 Message 占位字段。 */
function lfDefaultPromptFieldSlot(varName: string, configVal: unknown): Record<string, unknown> {
  const value = typeof configVal === "string" ? configVal : configVal === null || configVal === undefined ? "" : String(configVal);
  return {
    _input_type: "DefaultPromptField",
    advanced: false,
    display_name: varName,
    dynamic: false,
    input_types: ["Message"],
    list: false,
    list_add_label: "Add More",
    multiline: true,
    name: varName,
    override_skip: false,
    placeholder: "",
    required: false,
    show: true,
    title_case: false,
    tool_mode: false,
    trace_as_input: true,
    track_in_telemetry: false,
    type: "str",
    value,
  };
}

function isLfDynamicPromptVarSlot(slot: Record<string, unknown>): boolean {
  const it = slot["_input_type"];
  if (it === "DefaultPromptField") {
    return true;
  }
  if (it === "MessageTextInput" && slot["tool_mode"] !== true && slot["name"] !== "tool_placeholder") {
    return true;
  }
  return false;
}

const LF_PROMPT_TEMPLATE_STATIC_KEYS = new Set(["code", "_type", "template", "tool_placeholder", "input_variables"]);

/**
 * 同步 Prompt Template 的动态变量槽、`custom_fields` 与 `field_order`，供 LF 识别并与 `process_prompt_template` 对齐。
 */
function syncLfPromptTemplateDynamicSlots(inner: Record<string, unknown>, c: CubeFlowNode): void {
  if (c.cubeType !== "cube.lf.Prompt Template") {
    return;
  }
  const tpl = inner["template"];
  if (!tpl || typeof tpl !== "object") {
    return;
  }
  const T = tpl as Record<string, unknown>;

  const resolvedName = lfPromptSlotNameFromInnerTemplate(T);
  const varNames = resolvePromptTemplateVariableNames(c.customFields, c.config, resolvedName);

  const prevCf =
    c.customFields !== undefined && typeof c.customFields === "object"
      ? deepClone(c.customFields)
      : typeof inner["custom_fields"] === "object" && inner["custom_fields"] !== null
        ? deepClone(inner["custom_fields"] as Record<string, unknown>)
        : {};
  prevCf[resolvedName] = varNames;
  inner["custom_fields"] = prevCf;

  for (const key of Object.keys(T)) {
    if (LF_PROMPT_TEMPLATE_STATIC_KEYS.has(key)) {
      continue;
    }
    if (varNames.includes(key)) {
      continue;
    }
    const slot = T[key];
    if (!lfTemplateSlotHasValue(slot)) {
      continue;
    }
    if (isLfDynamicPromptVarSlot(slot as Record<string, unknown>)) {
      delete T[key];
    }
  }

  for (const v of varNames) {
    const cur = T[v];
    if (lfTemplateSlotHasValue(cur) && isLfDynamicPromptVarSlot(cur as Record<string, unknown>)) {
      if (Object.hasOwn(c.config, v)) {
        (cur as Record<string, unknown>)["value"] = c.config[v];
      }
      continue;
    }
    T[v] = lfDefaultPromptFieldSlot(v, Object.hasOwn(c.config, v) ? c.config[v] : "");
  }

  const prevFo = Array.isArray(inner["field_order"])
    ? (inner["field_order"] as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const staticTail = prevFo.filter((n) => n !== resolvedName && !varNames.includes(n));
  const newFo = dedupeFieldOrderNames([resolvedName, ...varNames, ...staticTail]);
  const cleaned = sanitizeFieldOrderForTemplate(newFo, T);
  if (cleaned.length > 0) {
    inner["field_order"] = cleaned;
  }
}

/** 自 LF template 各输入 slot 读取 show（与 schema 静态 show 独立，表实例级控件开关） */
function fieldEnabledFromTemplate(template: Record<string, unknown>): Record<string, boolean> | undefined {
  const out: Record<string, boolean> = {};
  let n = 0;
  for (const [key, v] of Object.entries(template)) {
    if (key === "code" || key === "_type") {
      continue;
    }
    if (!v || typeof v !== "object" || v === null || !("value" in v)) {
      continue;
    }
    const slot = v as Record<string, unknown>;
    const name = typeof slot["name"] === "string" ? slot["name"] : key;
    out[name] = slot["show"] !== false;
    n += 1;
  }
  return n > 0 ? out : undefined;
}

function fieldAdvancedFromTemplate(template: Record<string, unknown>): Record<string, boolean> | undefined {
  const out: Record<string, boolean> = {};
  let n = 0;
  for (const [key, v] of Object.entries(template)) {
    if (key === "code" || key === "_type") {
      continue;
    }
    if (!v || typeof v !== "object" || v === null || !("value" in v)) {
      continue;
    }
    const slot = v as Record<string, unknown>;
    const name = typeof slot["name"] === "string" ? slot["name"] : key;
    out[name] = slot["advanced"] === true;
    n += 1;
  }
  return n > 0 ? out : undefined;
}

function fieldUiFromLfNode(inner: Record<string, unknown>, template: Record<string, unknown> | undefined): CubeFlowFieldUi | undefined {
  const fe = template ? fieldEnabledFromTemplate(template) : undefined;
  const fa = template ? fieldAdvancedFromTemplate(template) : undefined;
  const tm = inner["tool_mode"];
  const nodeToolMode = tm === true ? true : tm === false ? false : undefined;
  if (!fe && !fa && nodeToolMode === undefined) {
    return undefined;
  }
  return {
    ...(fe ? { fieldEnabled: fe } : {}),
    ...(fa ? { fieldAdvanced: fa } : {}),
    ...(nodeToolMode !== undefined ? { nodeToolMode } : {}),
  };
}

function mergeTemplateFieldUi(template: Record<string, unknown>, fieldUi: CubeFlowFieldUi | undefined): void {
  const fe = fieldUi?.fieldEnabled;
  if (!fe) {
    return;
  }
  for (const [key, v] of Object.entries(template)) {
    if (key === "code" || key === "_type") {
      continue;
    }
    if (!v || typeof v !== "object" || v === null || !("value" in v)) {
      continue;
    }
    const slot = v as Record<string, unknown>;
    const name = typeof slot["name"] === "string" ? slot["name"] : key;
    if (Object.hasOwn(fe, name)) {
      slot["show"] = fe[name] !== false;
    }
  }
}

function mergeTemplateFieldAdvanced(template: Record<string, unknown>, fieldUi: CubeFlowFieldUi | undefined): void {
  const fa = fieldUi?.fieldAdvanced;
  if (!fa) {
    return;
  }
  for (const [key, v] of Object.entries(template)) {
    if (key === "code" || key === "_type") {
      continue;
    }
    if (!v || typeof v !== "object" || v === null || !("value" in v)) {
      continue;
    }
    const slot = v as Record<string, unknown>;
    const name = typeof slot["name"] === "string" ? slot["name"] : key;
    if (Object.hasOwn(fa, name)) {
      slot["advanced"] = fa[name] === true;
    }
  }
}

/**
 * 旧图仅有 fieldAdvanced（关「应用到节点」写 advanced=true），未写 fieldEnabled。
 * Langflow 画布显隐主要看 template.show，仅此补齐 show=false 才能与 Cube 卡片一致。
 */
/**
 * api-all 中 SmartRouter 的 `outputs` 为空，动态出口由 LF 前端 `update_outputs` 写入。
 * 合并/新建节点时若不写入 `inner.outputs`，`fillSourceHandleFromNode` 无法推导 `output_types`，
 * 远端 cleanEdges 会报 「Some connections were removed…」并删掉 category_* → 下游 的边。
 */
function syncLfSmartRouterDynamicOutputs(inner: Record<string, unknown>, c: CubeFlowNode): void {
  if (c.cubeType !== "cube.lf.SmartRouter") {
    return;
  }
  const dyn = smartRouterOutputsFromConfig(c.config);
  inner["outputs"] = dyn.map((o) => {
    const types = [...o.types];
    const row: Record<string, unknown> = {
      allows_loop: o.allowsLoop,
      cache: true,
      display_name: o.displayName,
      group_outputs: true,
      hidden: false,
      loop_types: null,
      method: o.name === "default_result" ? "default_response" : "process_case",
      name: o.name,
      options: null,
      required_inputs: null,
      tool_mode: o.toolMode,
      types,
      value: "__UNDEFINED__",
    };
    return row;
  });
}

function mergeTemplateShowFallbackFromAdvanced(template: Record<string, unknown>, fieldUi: CubeFlowFieldUi | undefined): void {
  const fa = fieldUi?.fieldAdvanced;
  const fe = fieldUi?.fieldEnabled;
  if (!fa) {
    return;
  }
  for (const [key, v] of Object.entries(template)) {
    if (key === "code" || key === "_type") {
      continue;
    }
    if (!v || typeof v !== "object" || v === null || !("value" in v)) {
      continue;
    }
    const slot = v as Record<string, unknown>;
    const name = typeof slot["name"] === "string" ? slot["name"] : key;
    if (!Object.hasOwn(fa, name)) {
      continue;
    }
    if (fe && Object.hasOwn(fe, name)) {
      continue;
    }
    if (fa[name] === true) {
      slot["show"] = false;
    }
  }
}

function dataSelectedOutputNameFromIdx(inner: Record<string, unknown>, idx: number | undefined): string | undefined {
  if (idx === undefined) {
    return undefined;
  }
  const outs = inner["outputs"];
  if (!Array.isArray(outs) || idx < 0 || idx >= outs.length) {
    return undefined;
  }
  const o = outs[idx] as Record<string, unknown>;
  const nm = o?.["name"];
  return typeof nm === "string" ? nm : undefined;
}

/**
 * 从 cube 边上的 semantic source 推断当前「实际在用」的输出名。
 * 若与 `selectedOutputIdx` 不一致即写入错误 `data.selected_output`，Langflow 前端常会不渲染边，
 * 直到用户在 LF 里切换输出（与 handle 对齐）才恢复。
 * 仅当该节点所有出边对应**同一** outputName 时采用（多分叉时仍回退 idx）。
 */
function selectedOutputNameInferredFromCubeEdges(c: CubeFlowNode, cube: CubeFlowGraph): string | undefined {
  const names = new Set<string>();
  for (const e of cube.edges) {
    if (e.source !== c.id) {
      continue;
    }
    const sp = parseSemanticSourcePort(e.sourcePort);
    if (!sp) {
      continue;
    }
    if (sp.nodeId !== c.lfNodeId && sp.nodeId !== c.id) {
      continue;
    }
    names.add(sp.outputName);
  }
  if (names.size === 1) {
    return [...names][0]!;
  }
  return undefined;
}

/** Smart Router 多条出边且输出桩不同时，规范名后的集合大小 >1 */
function smartRouterDistinctCanonicalOutgoingNames(c: CubeFlowNode, cube: CubeFlowGraph): string[] {
  const seen = new Set<string>();
  for (const e of cube.edges) {
    if (e.source !== c.id) {
      continue;
    }
    const sp = parseSemanticSourcePort(e.sourcePort);
    if (!sp) {
      continue;
    }
    if (sp.nodeId !== c.lfNodeId && sp.nodeId !== c.id) {
      continue;
    }
    seen.add(normalizeSmartRouterSemanticOutputName(c.config, sp.outputName));
  }
  return [...seen];
}

/**
 * Langflow cleanEdges：若存在 `data.selected_output`，会先用该名选中唯一 output 再校验所有出边，
 * 多输出口 Smart Router 会被误删只剩一条。多桩出边时不要写 `selected_output`，走按边匹配 output 的分支。
 */
function selectedOutputNameForLfNode(c: CubeFlowNode, cube: CubeFlowGraph, inner: Record<string, unknown>): string | undefined {
  if (c.cubeType === "cube.lf.SmartRouter") {
    const distinct = smartRouterDistinctCanonicalOutgoingNames(c, cube);
    if (distinct.length > 1) {
      return undefined;
    }
    if (distinct.length === 1) {
      return distinct[0];
    }
    return dataSelectedOutputNameFromIdx(inner, c.selectedOutputIdx);
  }
  const fromEdges = selectedOutputNameInferredFromCubeEdges(c, cube);
  return fromEdges ?? dataSelectedOutputNameFromIdx(inner, c.selectedOutputIdx);
}

/** LF cleanEdges 会依据「当前激活输出」的 `types`/`selected`；仅改 `data.selected_output` 而不同步 `outputs[].selected` 时边仍可能不显示。 */
function alignInnerOutputsSelectedWithActiveName(inner: Record<string, unknown>, activeOutputName: string): void {
  const outs = inner["outputs"];
  if (!Array.isArray(outs)) {
    return;
  }
  for (const o of outs) {
    if (!o || typeof o !== "object") {
      continue;
    }
    const r = o as Record<string, unknown>;
    if (r["name"] !== activeOutputName) {
      continue;
    }
    const types = Array.isArray(r["types"]) ? (r["types"] as unknown[]).filter((t): t is string => typeof t === "string") : [];
    if (types.length === 0) {
      return;
    }
    const cur = r["selected"];
    if (typeof cur === "string" && types.includes(cur)) {
      return;
    }
    r["selected"] = types[0];
    return;
  }
}

function lfInnerTemplate(inner: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!inner) {
    return undefined;
  }
  const tpl = inner["template"];
  return tpl && typeof tpl === "object" ? (tpl as Record<string, unknown>) : undefined;
}

const PARSER_DEFAULT_FIELD_ORDER = ["input_data", "mode", "pattern", "sep"] as const;

/**
 * 镜像 lfx ParserComponent.update_build_config：Cube 合并 config 只更新槽位 value，不会跑 LF 前端的动态表单；
 * Stringify 时必须隐藏 Template、放宽 required，并保留 clean_data 槽，否则与 LF 存盘不一致且运行期可能缺属性。
 */
function syncLfParserComponentModeCoherence(inner: Record<string, unknown>): void {
  const tpl = lfInnerTemplate(inner);
  if (!tpl) {
    return;
  }
  const modeSlot = tpl["mode"];
  if (!modeSlot || typeof modeSlot !== "object") {
    return;
  }
  const raw = (modeSlot as Record<string, unknown>)["value"];
  const modeStr = typeof raw === "string" ? raw.trim() : "";
  const isStringify = cubeConfigParserModeIsStringify({ mode: modeStr });
  if (modeStr !== "" && !isStringify && modeStr.toLowerCase() !== "parser") {
    return;
  }
  const isParserMode = !isStringify;

  const pattern = tpl["pattern"];
  if (pattern && typeof pattern === "object") {
    const p = pattern as Record<string, unknown>;
    p["show"] = isParserMode;
    p["required"] = isParserMode;
  }

  if (!isStringify) {
    return;
  }

  if (!tpl["clean_data"] || typeof tpl["clean_data"] !== "object") {
    tpl["clean_data"] = {
      _input_type: "BoolInput",
      advanced: true,
      display_name: "Clean Data",
      dynamic: false,
      info: "Enable to clean the data by removing empty rows and lines in each cell of the DataFrame/ Data object.",
      list: false,
      list_add_label: "Add More",
      name: "clean_data",
      override_skip: false,
      placeholder: "",
      required: false,
      show: true,
      title_case: false,
      tool_mode: false,
      trace_as_metadata: true,
      track_in_telemetry: true,
      type: "bool",
      value: true,
    };
  }

  const foRaw = inner["field_order"];
  let names: string[] = Array.isArray(foRaw) ? foRaw.filter((x): x is string => typeof x === "string") : [...PARSER_DEFAULT_FIELD_ORDER];
  if (!names.includes("clean_data")) {
    names = [...names, "clean_data"];
  }
  const cleaned = sanitizeFieldOrderForTemplate(names, tpl);
  if (cleaned.length > 0) {
    inner["field_order"] = cleaned;
  }
}

function fieldOrderFromLfInner(inner: Record<string, unknown> | undefined): string[] | undefined {
  if (!inner) {
    return undefined;
  }
  const fo = inner["field_order"];
  if (!Array.isArray(fo)) {
    return undefined;
  }
  const names = fo.filter((x): x is string => typeof x === "string");
  if (names.length === 0) {
    return undefined;
  }
  const cleaned = sanitizeFieldOrderForTemplate(names, lfInnerTemplate(inner));
  return cleaned.length > 0 ? cleaned : undefined;
}

function selectedOutputIdxFromLfData(data: Record<string, unknown>, inner: Record<string, unknown> | undefined): number | undefined {
  const selectedRaw = data["selected_output"];
  if (typeof selectedRaw !== "string" || !inner?.["outputs"]) {
    return undefined;
  }
  const outs = inner["outputs"] as unknown[];
  if (!Array.isArray(outs)) {
    return undefined;
  }
  const idx = outs.findIndex((o) => o && typeof o === "object" && (o as Record<string, unknown>)["name"] === selectedRaw);
  return idx !== -1 ? idx : undefined;
}

/**
 * tool_mode 节点的 tool_mode 输出需更新 types 与 selected，使 LF 前端
 * cleanEdges 能按 [output.selected] 推导出与 Tools 输入兼容的 output_types。
 * 镜像 LF 前端 NodeOutputParameter 中 `selectedType = output.selected ?? output.types[0]`
 * 和 cleanEdges 中 `output.types.length > 1 ? [output.selected!] : output.types` 的逻辑。
 */
function applyToolModeOutputsToInner(inner: Record<string, unknown>, nodeToolMode: boolean | undefined): void {
  if (!nodeToolMode) {
    return;
  }
  const outs = inner["outputs"];
  if (!Array.isArray(outs)) {
    return;
  }
  for (const o of outs) {
    if (!o || typeof o !== "object") {
      continue;
    }
    const r = o as Record<string, unknown>;
    if (r["tool_mode"] !== true) {
      continue;
    }
    const types = Array.isArray(r["types"]) ? (r["types"] as unknown[]).filter((t): t is string => typeof t === "string") : [];
    if (!types.includes("Tool")) {
      r["types"] = [...types, "Tool"];
    }
    r["selected"] = "Tool";
  }
}

/**
 * Langflow 1.8+：`tool_mode` 开启时，连到上游 Agent `tools` 的输出为 **component_as_tool**（Toolset）。
 * 适用于 **Agent** 与 **MCPTools**（api-all 上原为 `response` + tool_mode，LF 画布与持久化与 Agent 同属 Toolset 句柄）。
 * 在 applyToolModeOutputsToInner 之后调用。
 */
function normalizeLfAgentToolModeOutputs(inner: Record<string, unknown>): void {
  if (inner["tool_mode"] !== true) {
    return;
  }
  const outs = inner["outputs"];
  if (!Array.isArray(outs)) {
    return;
  }

  const byName = (n: string): Record<string, unknown> | undefined => {
    const o = outs.find((x) => x && typeof x === "object" && (x as Record<string, unknown>)["name"] === n);
    return o && typeof o === "object" ? (o as Record<string, unknown>) : undefined;
  };

  const existingCat = byName("component_as_tool");
  if (existingCat) {
    inner["outputs"] = [deepClone(existingCat)];
    return;
  }

  const resp = byName("response");
  if (!resp || resp["tool_mode"] !== true) {
    return;
  }
  const types = Array.isArray(resp["types"]) ? (resp["types"] as unknown[]).filter((t): t is string => typeof t === "string") : [];
  if (!types.includes("Tool")) {
    return;
  }

  inner["outputs"] = [
    {
      allows_loop: false,
      cache: resp["cache"] !== false,
      display_name: "Toolset",
      group_outputs: false,
      loop_types: null,
      method: "to_toolkit",
      name: "component_as_tool",
      options: null,
      required_inputs: null,
      selected: "Tool",
      tool_mode: true,
      types: ["Tool"],
      value: "__UNDEFINED__",
    },
  ];
}

function humanizeSnakeCaseToolName(name: string): string {
  const n = name.trim();
  if (!n) {
    return n;
  }
  return n.replaceAll(/_/gu, " ").replaceAll(/\b\w/gu, (c) => c.toUpperCase());
}

function jsonSchemaRootTitle(schema: unknown): string {
  if (schema === null || schema === undefined || typeof schema !== "object" || Array.isArray(schema)) {
    return "";
  }
  const t = (schema as Record<string, unknown>)["title"];
  return typeof t === "string" && t.trim() ? t.trim() : "";
}

function mcpToolsLfMetadataEntryForToolName(
  name: string,
  opts?: { description?: string; displayName?: string; args?: Record<string, unknown> },
): Record<string, unknown> {
  const n = name.trim() || "build_output";
  const desc = (opts?.description ?? "").trim();
  const dn = (opts?.displayName ?? "").trim() || humanizeSnakeCaseToolName(n);
  const args = opts?.args && typeof opts.args === "object" && !Array.isArray(opts.args) ? opts.args : {};
  return {
    args,
    description: desc,
    display_description: desc,
    display_name: dn,
    name: n,
    status: true,
    tags: [n],
  };
}

function toolNamesFromLfTemplateToolSlot(T: Record<string, unknown>): string[] {
  const toolSlot = T["tool"];
  if (!toolSlot || typeof toolSlot !== "object") {
    return [];
  }
  const opts = (toolSlot as Record<string, unknown>)["options"];
  if (!Array.isArray(opts)) {
    return [];
  }
  return (opts as unknown[]).filter((x): x is string => typeof x === "string" && x.trim() !== "");
}

function buildMcpToolsToolsMetadataValue(
  cube: CubeFlowNode,
  optionNames: string[],
  listedTools?: McpListedTool[],
): Record<string, unknown>[] {
  const descByName = new Map<string, string>();
  const titleByName = new Map<string, string>();
  const schemaByName = new Map<string, unknown | null>();
  if (listedTools) {
    for (const t of listedTools) {
      const key = t.name.trim();
      if (!key) {
        continue;
      }
      const d = t.description.trim();
      if (d) {
        descByName.set(key, d);
      }
      const tit = jsonSchemaRootTitle(t.inputSchema);
      if (tit) {
        titleByName.set(key, tit);
      }
      schemaByName.set(key, t.inputSchema);
    }
  }
  if (optionNames.length > 0) {
    return optionNames.map((rawName) => {
      const n = rawName.trim();
      const desc = descByName.get(n) ?? "";
      const displayTitle = titleByName.get(n);
      const sch = schemaByName.get(n);
      const args = sch !== null && sch !== undefined ? mcpToolInputSchemaToLangflowToolsMetadataArgs(sch) : {};
      return mcpToolsLfMetadataEntryForToolName(n, {
        args,
        description: desc,
        displayName: displayTitle,
      });
    });
  }
  const fromCfg = cube.config["tools_metadata"];
  if (Array.isArray(fromCfg) && fromCfg.length > 0) {
    return fromCfg.map((x) => {
      const row: Record<string, unknown> = x && typeof x === "object" && !Array.isArray(x) ? deepClone(x as Record<string, unknown>) : {};
      const n = typeof row["name"] === "string" ? row["name"].trim() : "";
      if (n && listedTools) {
        const sch = schemaByName.get(n);
        if (sch !== null && sch !== undefined) {
          const args = mcpToolInputSchemaToLangflowToolsMetadataArgs(sch);
          if (Object.keys(args).length > 0) {
            row["args"] = args;
          }
        }
      }
      return row;
    });
  }
  return [mcpToolsLfMetadataEntryForToolName("build_output")];
}

/**
 * Langflow MCPTools：`update_build_config` 用 `build_config["tools_metadata"]["show"]` 判断 Actions / 整包工具模式；
 * 仅节点级 `tool_mode` 不会在持久化模板里隐藏 `tool` 下拉，需写入 `tools_metadata` + `template.tool.show=false`。
 */
function applyMcpToolsLangflowToolsetModeTemplate(inner: Record<string, unknown>, cube: CubeFlowNode, listedTools?: McpListedTool[]): void {
  if (cube.cubeType !== "cube.lf.MCPTools") {
    return;
  }
  if (inner["tool_mode"] !== true) {
    return;
  }
  const tplRaw = inner["template"];
  if (!tplRaw || typeof tplRaw !== "object") {
    return;
  }
  const T = tplRaw as Record<string, unknown>;
  const toolSlot = T["tool"];
  if (toolSlot && typeof toolSlot === "object") {
    (toolSlot as Record<string, unknown>)["show"] = false;
  }
  const optionNames = toolNamesFromLfTemplateToolSlot(T);
  const metaVal = buildMcpToolsToolsMetadataValue(cube, optionNames, listedTools);
  const existing = T["tools_metadata"];
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    const slot = existing as Record<string, unknown>;
    slot["show"] = true;
    slot["value"] = metaVal;
    if (slot["_input_type"] === null || slot["_input_type"] === undefined) {
      slot["_input_type"] = "ToolsInput";
    }
    if (slot["type"] === null || slot["type"] === undefined) {
      slot["type"] = "tools";
    }
    if (slot["display_name"] === null || slot["display_name"] === undefined) {
      slot["display_name"] = "Actions";
    }
    if (slot["name"] === null || slot["name"] === undefined) {
      slot["name"] = "tools_metadata";
    }
  } else {
    T["tools_metadata"] = {
      _input_type: "ToolsInput",
      advanced: false,
      display_name: "Actions",
      dynamic: false,
      info: "Modify tool names and descriptions to help agents understand when to use each tool.",
      is_list: true,
      list_add_label: "Add More",
      name: "tools_metadata",
      override_skip: false,
      placeholder: "",
      real_time_refresh: true,
      required: false,
      show: true,
      title_case: false,
      tool_mode: false,
      trace_as_metadata: true,
      track_in_telemetry: false,
      type: "tools",
      value: metaVal,
    };
  }
}

/** Push 前在 `enrichLfFlowDataWithLiveMcpToolOptions` 之后调用：全量 options 写入后再强制 Actions 模式，避免 LF 仍显示 Tool 下拉。 */
export function reconcileMcpToolsToolsetTemplateInLfData(
  lfData: Record<string, unknown>,
  graph: CubeFlowGraph,
  listedToolsByLfNodeId?: Map<string, McpListedTool[]>,
): void {
  const byLf = new Map(graph.nodes.map((n) => [n.lfNodeId, n]));
  const rawNodes = lfData["nodes"];
  if (!Array.isArray(rawNodes)) {
    return;
  }
  for (const raw of rawNodes) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const id = (raw as Record<string, unknown>)["id"];
    if (typeof id !== "string") {
      continue;
    }
    const cube = byLf.get(id);
    if (!cube || cube.cubeType !== "cube.lf.MCPTools") {
      continue;
    }
    const wrap = (raw as Record<string, unknown>)["data"];
    if (!wrap || typeof wrap !== "object") {
      continue;
    }
    if ((wrap as Record<string, unknown>)["type"] !== "MCPTools") {
      continue;
    }
    const inner = (wrap as Record<string, unknown>)["node"];
    if (!inner || typeof inner !== "object") {
      continue;
    }
    const listed = listedToolsByLfNodeId?.get(id);
    applyMcpToolsLangflowToolsetModeTemplate(inner as Record<string, unknown>, cube, listed);
  }
}

/**
 * 按 LF 前端 cleanEdges 公式从合并后节点数据推导 sourceHandle 字段。
 * - dataType = lfComponentKey（组件 key，如 "Agent"），与 node.data.type 一致
 * - output_types: types.length === 1 ? types : [selected]（单类型取数组，多类型取 selected）
 */
function fillSourceHandleFromNode(
  mergedLfNodes: LfNode[],
  srcNodeLf: string,
  outputName: string,
  lfComponentKey: string,
  srcObj: LfSourceHandleObj,
): void {
  srcObj.dataType = lfComponentKey;
  for (const n of mergedLfNodes) {
    if (n["id"] !== srcNodeLf) {
      continue;
    }
    const data = n["data"] as Record<string, unknown> | undefined;
    const inner = data?.["node"] as Record<string, unknown> | undefined;
    const outs = inner?.["outputs"];
    if (!Array.isArray(outs)) {
      return;
    }
    for (const o of outs) {
      if (!o || typeof o !== "object") {
        continue;
      }
      const r = o as Record<string, unknown>;
      if (r["name"] !== outputName) {
        continue;
      }
      const types = Array.isArray(r["types"]) ? (r["types"] as unknown[]).filter((t): t is string => typeof t === "string") : [];
      const selected = typeof r["selected"] === "string" ? r["selected"] : undefined;
      // 镜像 cleanEdges：单类型用 types，多类型用 [selected]
      srcObj.output_types = types.length === 1 ? [...types] : selected ? [selected] : types.slice(0, 1);
      return;
    }
    return;
  }
}

function enrichTargetHandleFromDef(def: Record<string, unknown> | null | undefined, fieldName: string, tgtObj: LfTargetHandleObj): void {
  if (!def || (tgtObj.inputTypes?.length ?? 0) > 0) {
    return;
  }
  const template = def["template"];
  if (!template || typeof template !== "object") {
    return;
  }
  for (const [key, v] of Object.entries(template as Record<string, unknown>)) {
    if (key === "code" || key === "_type") {
      continue;
    }
    if (!v || typeof v !== "object") {
      continue;
    }
    const s = v as Record<string, unknown>;
    const name = typeof s["name"] === "string" ? s["name"] : key;
    if (name !== fieldName) {
      continue;
    }
    const it = Array.isArray(s["input_types"]) ? (s["input_types"] as unknown[]).filter((t): t is string => typeof t === "string") : [];
    tgtObj.inputTypes = [...it];
    // type 必须来自模板字段的 type 属性（如 HandleInput = "other"），与 LF 前端 cleanEdges 期望一致
    tgtObj.type = typeof s["type"] === "string" ? (s["type"] as string) : "other";
    return;
  }
}

/**
 * api-all 静态模板不含 Prompt 动态变量槽；合并后的节点 inner.template 才有 DefaultPromptField 等，据此补全 targetHandle。
 */
function enrichTargetHandleFromMergedNodeTemplate(
  mergedLfNodes: LfNode[],
  tgtNodeLfId: string,
  fieldName: string,
  tgtObj: LfTargetHandleObj,
): void {
  for (const n of mergedLfNodes) {
    if (n["id"] !== tgtNodeLfId) {
      continue;
    }
    const data = n["data"] as Record<string, unknown> | undefined;
    const inner = data?.["node"] as Record<string, unknown> | undefined;
    const tpl = inner?.["template"];
    if (!tpl || typeof tpl !== "object") {
      return;
    }
    const T = tpl as Record<string, unknown>;
    const slot = T[fieldName];
    if (!slot || typeof slot !== "object" || !("value" in (slot as object))) {
      return;
    }
    const s = slot as Record<string, unknown>;
    const it = Array.isArray(s["input_types"]) ? (s["input_types"] as unknown[]).filter((t): t is string => typeof t === "string") : [];
    if (it.length > 0) {
      tgtObj.inputTypes = [...it];
    }
    const ty = typeof s["type"] === "string" ? (s["type"] as string) : "";
    if (ty) {
      tgtObj.type = ty;
    }
    return;
  }
}

function applyFieldUiToLfInner(inner: Record<string, unknown>, fieldUi: CubeFlowFieldUi | undefined): void {
  if (!fieldUi) {
    return;
  }
  if (fieldUi.nodeToolMode !== undefined) {
    inner["tool_mode"] = fieldUi.nodeToolMode;
  }
  const template = inner["template"];
  if (typeof template === "object" && template !== null) {
    const t = template as Record<string, unknown>;
    mergeTemplateFieldUi(t, fieldUi);
    mergeTemplateFieldAdvanced(t, fieldUi);
    mergeTemplateShowFallbackFromAdvanced(t, fieldUi);
  }
}

function buildLfGenericNodeFromDef(
  c: CubeFlowNode,
  lfComponentKey: string,
  def: Record<string, unknown>,
  cube: CubeFlowGraph,
  langflowApiAllPath?: string,
): LfNode {
  const inner = deepClone(def);
  if (typeof inner["template"] === "object" && inner["template"] !== null) {
    const effectiveAgentCfg = c.cubeType === "cube.lf.Agent" ? effectiveAgentConfigForLfTemplateMerge(c, cube) : c.config;
    if (c.cubeType === "cube.lf.MCPTools") {
      if (c.fieldUi?.nodeToolMode === true) {
        stripMcpToolsDynamicSlotsForLangflowToolset(inner);
      } else {
        syncLfMcpToolsDynamicInputs(inner, c);
      }
    }
    const cfgForLfTpl = c.cubeType === "cube.lf.MCPTools" ? effectiveMcpToolsConfigForLfTemplateMerge(c, inner) : effectiveAgentCfg;
    const customPreparedNew =
      c.cubeType === "cube.lf.CustomComponent" &&
      typeof c.config["code"] === "string" &&
      (c.config["code"] as string).length > 0 &&
      c.config[CUBE_CUSTOM_COMPONENT_DSL_KEY] !== null &&
      c.config[CUBE_CUSTOM_COMPONENT_DSL_KEY] !== undefined &&
      String(c.config[CUBE_CUSTOM_COMPONENT_DSL_KEY]).trim() !== "";
    if (customPreparedNew && langflowApiAllPath) {
      rebuildLangflowCustomComponentInnerFromDsl(inner, c, langflowApiAllPath);
    } else if (customPreparedNew) {
      /* langflowApiAllPath not available - skip DSL rebuild, fallback to config merge */
    } else {
      mergeTemplateFromConfig(inner["template"] as Record<string, unknown>, cfgForLfTpl);
    }
    if (c.cubeType === "cube.lf.MCPTools") {
      applyCubeMcpToolSelectionToLfTemplate(inner["template"] as Record<string, unknown>, c.config);
      ensureMcpToolsToolSlotCoherent(inner["template"] as Record<string, unknown>);
    }
    applyAgentExternalLlmLfTemplate(inner, effectiveAgentCfg);
    normalizeLoadFromDbInlineLiteralsDeep(inner["template"] as Record<string, unknown>);
  }
  syncLfPromptTemplateDynamicSlots(inner, c);
  if (c.cubeType !== "cube.lf.Prompt Template" && c.customFields !== undefined) {
    inner["custom_fields"] = deepClone(c.customFields);
  }
  const tpl = lfInnerTemplate(inner);

  const defFo = inner["field_order"];
  if (Array.isArray(defFo)) {
    const names = defFo.filter((x): x is string => typeof x === "string");
    if (names.length > 0) {
      const cleaned = sanitizeFieldOrderForTemplate(names, tpl);
      if (cleaned.length > 0) {
        inner["field_order"] = cleaned;
      } else {
        delete inner["field_order"];
      }
    }
  }

  const cubeTitle = c.config["display_name"];
  if (typeof cubeTitle === "string" && cubeTitle.trim()) {
    inner["display_name"] = cubeTitle.trim();
  }
  applyFieldUiToLfInner(inner, c.fieldUi);
  // applyFieldUiToLfInner 已将 fieldUi.nodeToolMode 写入 inner.tool_mode；以 inner 状态为准
  applyToolModeOutputsToInner(inner, inner["tool_mode"] === true);
  if (lfComponentKey === "Agent" || lfComponentKey === "MCPTools") {
    normalizeLfAgentToolModeOutputs(inner);
  }
  if (c.cubeType === "cube.lf.MCPTools") {
    applyMcpToolsLangflowToolsetModeTemplate(inner, c);
  }
  if (c.cubeType === "cube.lf.SmartRouter") {
    syncLfSmartRouterDynamicOutputs(inner, c);
  }
  if (
    c.fieldOrder &&
    c.fieldOrder.length > 0 &&
    c.cubeType !== "cube.lf.Prompt Template" &&
    c.cubeType !== "cube.lf.MCPTools" &&
    c.cubeType !== "cube.lf.CustomComponent"
  ) {
    const cleaned = sanitizeFieldOrderForTemplate(c.fieldOrder, lfInnerTemplate(inner));
    if (cleaned.length > 0) {
      inner["field_order"] = cleaned;
    } else {
      delete inner["field_order"];
    }
  }
  if (c.cubeType === "cube.lf.ParserComponent") {
    syncLfParserComponentModeCoherence(inner);
  }
  const selName = selectedOutputNameForLfNode(c, cube, inner as Record<string, unknown>);
  const dataOut: Record<string, unknown> = {
    id: c.lfNodeId,
    node: inner,
    type: lfComponentKey,
  };
  if (c.cubeType === "cube.lf.SmartRouter") {
    if (typeof selName === "string") {
      dataOut["selected_output"] = selName;
      alignInnerOutputsSelectedWithActiveName(inner, selName);
    }
  } else if (typeof selName === "string") {
    dataOut["selected_output"] = selName;
    alignInnerOutputsSelectedWithActiveName(inner, selName);
  }
  if (
    (lfComponentKey === "Agent" || lfComponentKey === "MCPTools") &&
    inner["tool_mode"] === true &&
    Array.isArray(inner["outputs"]) &&
    inner["outputs"].length === 1 &&
    inner["outputs"][0] &&
    typeof inner["outputs"][0] === "object" &&
    (inner["outputs"][0] as Record<string, unknown>)["name"] === "component_as_tool"
  ) {
    dataOut["selected_output"] = "component_as_tool";
    alignInnerOutputsSelectedWithActiveName(inner, "component_as_tool");
  }
  return {
    data: dataOut,
    dragging: false,
    id: c.lfNodeId,
    measured: { height: c.height, width: c.width },
    position: { x: c.x, y: c.y },
    selected: false,
    type: "genericNode",
  };
}

function buildLfNoteNode(c: CubeFlowNode): LfNode {
  const desc = typeof c.config["description"] === "string" ? c.config["description"] : "";
  return {
    data: {
      id: c.lfNodeId,
      node: {
        description: desc,
        display_name: "",
        documentation: "",
        template: { backgroundColor: "neutral" },
      },
      type: "note",
    },
    dragging: false,
    id: c.lfNodeId,
    measured: { height: c.height, width: c.width },
    position: { x: c.x, y: c.y },
    selected: false,
    type: "noteNode",
  };
}

function lfNodeToCubeType(node: LfNode): string | null {
  const t = node["type"];
  if (t === "noteNode") {
    return "cube.lf.note";
  }
  const data = node["data"] as Record<string, unknown> | undefined;
  if (!data) {
    return null;
  }
  const comp = data["type"];
  if (typeof comp === "string") {
    return `cube.lf.${comp}`;
  }
  return null;
}

function lfNodeToCubeNode(node: LfNode): CubeFlowNode | null {
  const id = node["id"];
  if (typeof id !== "string") {
    return null;
  }
  const position = node["position"] as { x?: number; y?: number } | undefined;
  const measured = node["measured"] as { width?: number; height?: number } | undefined;
  const data = node["data"] as Record<string, unknown> | undefined;
  if (!data) {
    return null;
  }

  const cubeType = lfNodeToCubeType(node);
  if (!cubeType) {
    return null;
  }

  let config: Record<string, unknown> = {};
  const inner = data["node"] as Record<string, unknown> | undefined;
  if (cubeType === "cube.lf.note") {
    const desc = inner?.["description"];
    if (typeof desc === "string") {
      config = { description: desc };
    }
  } else {
    const template = inner?.["template"] as Record<string, unknown> | undefined;
    if (template) {
      config = templateToConfig(template);
    }
    if (cubeType === "cube.lf.Agent" && template) {
      const slot = template["model"] ?? template["agent_llm"];
      if (slot && typeof slot === "object") {
        const it = (slot as Record<string, unknown>)["input_types"];
        if (Array.isArray(it) && (it as string[]).includes("LanguageModel")) {
          config = {
            ...config,
            agent_llm: AGENT_LLM_CONNECT_OTHER,
            model: AGENT_LLM_CONNECT_OTHER,
          };
        }
      }
    }
    const innerTitle = inner?.["display_name"];
    if (typeof innerTitle === "string" && innerTitle.trim()) {
      config = { ...config, display_name: innerTitle.trim() };
    }
    if (cubeType === "cube.lf.CustomComponent" && template) {
      const codeSlot = template["code"];
      if (codeSlot && typeof codeSlot === "object" && codeSlot !== null && "value" in codeSlot) {
        const cv = (codeSlot as { value: unknown }).value;
        if (typeof cv === "string" && cv.length > 0) {
          config = { ...config, [CUBE_LF_CODE_OPAQUE_KEY]: cv };
        }
      }
    }
    const rawCf = inner?.["custom_fields"];
    const customFields: Record<string, unknown> | undefined =
      rawCf !== undefined && typeof rawCf === "object" && !Array.isArray(rawCf) ? deepClone(rawCf as Record<string, unknown>) : undefined;
    const fieldUi = inner && template ? fieldUiFromLfNode(inner, template) : undefined;
    const selectedOutputIdx = data ? selectedOutputIdxFromLfData(data, inner) : undefined;
    const fieldOrder = fieldOrderFromLfInner(inner);
    const mcpDyn =
      cubeType === "cube.lf.MCPTools" && template ? cubeMcpDynamicSchemaInputsFromLfTemplate(cubeType, template, fieldOrder) : [];
    return {
      config,
      cubeType,
      height: measured?.height ?? 80,
      id,
      lfNodeId: id,
      width: measured?.width ?? 240,
      x: position?.x ?? 0,
      y: position?.y ?? 0,
      ...(customFields !== undefined ? { customFields } : {}),
      ...(fieldUi ? { fieldUi } : {}),
      ...(selectedOutputIdx !== undefined ? { selectedOutputIdx } : {}),
      ...(fieldOrder ? { fieldOrder } : {}),
      ...(mcpDyn.length > 0 ? { mcpDynamicSchemaInputs: mcpDyn } : {}),
    };
  }

  return {
    config,
    cubeType,
    height: measured?.height ?? 80,
    id,
    lfNodeId: id,
    width: measured?.width ?? 240,
    x: position?.x ?? 0,
    y: position?.y ?? 0,
  };
}

function readHandleObjects(edge: LfEdge): {
  src: LfSourceHandleObj | null;
  tgt: LfTargetHandleObj | null;
} {
  const data = edge["data"] as Record<string, unknown> | undefined;
  let srcRaw: unknown = data?.["sourceHandle"];
  let tgtRaw: unknown = data?.["targetHandle"];
  if (srcRaw === undefined && typeof edge["sourceHandle"] === "string") {
    try {
      srcRaw = parseLfHandleString(edge["sourceHandle"] as string);
    } catch {
      srcRaw = undefined;
    }
  }
  if (tgtRaw === undefined && typeof edge["targetHandle"] === "string") {
    try {
      tgtRaw = parseLfHandleString(edge["targetHandle"] as string);
    } catch {
      tgtRaw = undefined;
    }
  }
  return {
    src: isSourceHandleObj(srcRaw) ? srcRaw : null,
    tgt: isTargetHandleObj(tgtRaw) ? tgtRaw : null,
  };
}

export function lfFlowDocumentToCubeGraph(lfFlow: Record<string, unknown>): CubeFlowGraph {
  const data = lfFlow["data"] as Record<string, unknown> | undefined;
  if (!data) {
    return emptyCubeFlowGraph();
  }

  const rawNodes = data["nodes"];
  const rawEdges = data["edges"];
  const viewport = data["viewport"] as CubeFlowGraph["viewport"] | undefined;

  const nodes: CubeFlowNode[] = [];
  if (Array.isArray(rawNodes)) {
    for (const n of rawNodes) {
      const cn = lfNodeToCubeNode(n as LfNode);
      if (cn) {
        nodes.push(cn);
      }
    }
  }

  const edges: CubeFlowEdge[] = [];
  if (Array.isArray(rawEdges)) {
    for (const e of rawEdges) {
      const edge = e as LfEdge;
      const id = edge["id"];
      const source = edge["source"];
      const target = edge["target"];
      if (typeof id !== "string" || typeof source !== "string" || typeof target !== "string") {
        continue;
      }
      const { src, tgt } = readHandleObjects(edge);
      if (!src || !tgt) {
        continue;
      }
      edges.push({
        id,
        source,
        sourcePort: semanticSourcePort(src.id, src.name),
        target,
        targetPort: semanticTargetPort(tgt.id, tgt.fieldName),
      });
    }
  }

  return {
    edges,
    nodes,
    schemaVersion: CUBE_FLOW_SCHEMA_VERSION,
    viewport,
  };
}

/**
 * Merge Cube graph into existing Langflow `data` object (deep-cloned).
 * Existing LF nodes matched by `lfNodeId` are updated (position, template from config).
 * When `resolveComponent` is set, Cube nodes missing from the LF list are appended
 * using api-all-style definitions (genericNode / noteNode).
 * **Nodes present in LF but absent from Cube are removed** so Cube remains authoritative.
 */
export function cubeGraphToLfFlowData(
  cube: CubeFlowGraph,
  baseLfData: Record<string, unknown>,
  resolveComponent?: (lfComponentKey: string) => Record<string, unknown> | null,
  langflowApiAllPath?: string,
): Record<string, unknown> {
  const baseNodesRaw = baseLfData["nodes"];
  const { byId: lfInnerMetaById, sampleLfVersion } = collectLfInnerMetadataByNodeId(Array.isArray(baseNodesRaw) ? baseNodesRaw : []);
  const out = deepClone(baseLfData);
  let rawNodes = out["nodes"] as unknown;
  if (!Array.isArray(rawNodes)) {
    rawNodes = [];
    out["nodes"] = rawNodes;
  }
  const nodeList = rawNodes as unknown[];

  const x6ToLf = new Map<string, string>();
  for (const n of cube.nodes) {
    x6ToLf.set(n.id, n.lfNodeId);
    x6ToLf.set(n.lfNodeId, n.lfNodeId);
  }

  const cubeByLf = new Map(cube.nodes.map((n) => [n.lfNodeId, n]));

  for (const n of nodeList) {
    const node = n as LfNode;
    const id = node["id"];
    if (typeof id !== "string") {
      continue;
    }
    const c = cubeByLf.get(id);
    if (!c) {
      continue;
    }

    if (!node["position"]) {
      node["position"] = { x: c.x, y: c.y };
    } else {
      const p = node["position"] as Record<string, number>;
      p["x"] = c.x;
      p["y"] = c.y;
    }
    if (!node["measured"]) {
      node["measured"] = { width: c.width, height: c.height };
    } else {
      const m = node["measured"] as Record<string, number>;
      m["width"] = c.width;
      m["height"] = c.height;
    }

    const data = node["data"] as Record<string, unknown> | undefined;
    if (!data) {
      continue;
    }
    const inner = data["node"] as Record<string, unknown> | undefined;
    if (!inner) {
      continue;
    }
    const effectiveAgentCfg = c.cubeType === "cube.lf.Agent" ? effectiveAgentConfigForLfTemplateMerge(c, cube) : c.config;

    if (c.cubeType === "cube.lf.Agent" && resolveComponent) {
      const backToInlineProvider = !isAgentExternalLlmMode(effectiveAgentCfg) && agentLfInnerTemplateIsExternalLlm(inner);
      if (backToInlineProvider) {
        restoreAgentProviderTemplateFromDef(inner, resolveComponent);
      }
    }
    if (c.cubeType === "cube.lf.MCPTools") {
      if (typeof inner["template"] !== "object" || inner["template"] === null) {
        inner["template"] = {};
      }
      ensureMcpToolsBaselineTemplateSlots(inner, resolveComponent);
      if (c.fieldUi?.nodeToolMode === true) {
        stripMcpToolsDynamicSlotsForLangflowToolset(inner);
      } else {
        syncLfMcpToolsDynamicInputs(inner, c);
      }
    }
    if (typeof inner["template"] === "object" && inner["template"] !== null) {
      const cfgForLfTpl =
        c.cubeType === "cube.lf.MCPTools"
          ? effectiveMcpToolsConfigForLfTemplateMerge(c, inner)
          : c.cubeType === "cube.lf.Agent"
            ? effectiveAgentCfg
            : c.config;
      const customPrepared =
        c.cubeType === "cube.lf.CustomComponent" &&
        typeof c.config["code"] === "string" &&
        (c.config["code"] as string).length > 0 &&
        c.config[CUBE_CUSTOM_COMPONENT_DSL_KEY] !== null &&
        c.config[CUBE_CUSTOM_COMPONENT_DSL_KEY] !== undefined &&
        String(c.config[CUBE_CUSTOM_COMPONENT_DSL_KEY]).trim() !== "";
      if (customPrepared && langflowApiAllPath) {
        rebuildLangflowCustomComponentInnerFromDsl(inner, c, langflowApiAllPath);
      } else if (customPrepared) {
        /* langflowApiAllPath not available - skip DSL rebuild, fallback to config merge */
      } else {
        mergeTemplateFromConfig(inner["template"] as Record<string, unknown>, cfgForLfTpl);
      }
      if (c.cubeType === "cube.lf.MCPTools") {
        applyCubeMcpToolSelectionToLfTemplate(inner["template"] as Record<string, unknown>, c.config);
        ensureMcpToolsToolSlotCoherent(inner["template"] as Record<string, unknown>);
      }
    }
    if (c.cubeType === "cube.lf.Agent") {
      applyAgentExternalLlmLfTemplate(inner, effectiveAgentCfg);
    }
    if (typeof inner["template"] === "object" && inner["template"] !== null) {
      normalizeLoadFromDbInlineLiteralsDeep(inner["template"] as Record<string, unknown>);
    }
    syncLfPromptTemplateDynamicSlots(inner, c);
    if (c.cubeType !== "cube.lf.Prompt Template" && c.customFields !== undefined) {
      inner["custom_fields"] = deepClone(c.customFields);
    }
    const cubeTitle = c.config["display_name"];
    if (typeof cubeTitle === "string" && cubeTitle.trim()) {
      inner["display_name"] = cubeTitle.trim();
    }
    applyFieldUiToLfInner(inner, c.fieldUi);
    // 合并后 inner.tool_mode 可能来自 fieldUi 或 LF 快照；以 inner 状态为准
    applyToolModeOutputsToInner(inner, inner["tool_mode"] === true);
    if (c.cubeType === "cube.lf.Agent" || c.cubeType === "cube.lf.MCPTools") {
      normalizeLfAgentToolModeOutputs(inner);
    }
    if (c.cubeType === "cube.lf.MCPTools") {
      applyMcpToolsLangflowToolsetModeTemplate(inner, c);
    }
    if (c.cubeType === "cube.lf.SmartRouter") {
      syncLfSmartRouterDynamicOutputs(inner, c);
    }

    const tpl = lfInnerTemplate(inner);
    const mergeFo = inner["field_order"];
    if (Array.isArray(mergeFo)) {
      const mergeNames = mergeFo.filter((x): x is string => typeof x === "string");
      if (mergeNames.length > 0) {
        const cleaned = sanitizeFieldOrderForTemplate(mergeNames, tpl);
        if (cleaned.length > 0) {
          inner["field_order"] = cleaned;
        } else {
          delete inner["field_order"];
        }
      }
    }
    // MCPTools：`syncLfMcpToolsDynamicInputs` 已写入含动态参数名的 `field_order`；cube 侧 `field_order` 常不含动态段，勿覆盖。
    // CustomComponent：`rebuildLangflowCustomComponentInnerFromDsl` 已按 DSL 写好 field_order；cube 侧若残留桩顺序勿覆盖。
    if (
      c.fieldOrder &&
      c.fieldOrder.length > 0 &&
      c.cubeType !== "cube.lf.Prompt Template" &&
      c.cubeType !== "cube.lf.MCPTools" &&
      c.cubeType !== "cube.lf.CustomComponent"
    ) {
      const cleaned = sanitizeFieldOrderForTemplate(c.fieldOrder, tpl);
      if (cleaned.length > 0) {
        inner["field_order"] = cleaned;
      } else {
        delete inner["field_order"];
      }
    }
    if (c.cubeType === "cube.lf.ParserComponent") {
      syncLfParserComponentModeCoherence(inner);
    }

    const selName = selectedOutputNameForLfNode(c, cube, inner);
    if (c.cubeType === "cube.lf.SmartRouter") {
      if (typeof selName === "string") {
        data["selected_output"] = selName;
      } else {
        delete data["selected_output"];
      }
    } else if (typeof selName === "string") {
      data["selected_output"] = selName;
    }
    if (
      (c.cubeType === "cube.lf.Agent" || c.cubeType === "cube.lf.MCPTools") &&
      inner["tool_mode"] === true &&
      Array.isArray(inner["outputs"]) &&
      inner["outputs"].length === 1 &&
      inner["outputs"][0] &&
      typeof inner["outputs"][0] === "object" &&
      (inner["outputs"][0] as Record<string, unknown>)["name"] === "component_as_tool"
    ) {
      data["selected_output"] = "component_as_tool";
    }

    const activeOut = data["selected_output"];
    if (typeof activeOut === "string") {
      alignInnerOutputsSelectedWithActiveName(inner, activeOut);
    }

    if (c.cubeType === "cube.lf.note" && typeof c.config["description"] === "string") {
      inner["description"] = c.config["description"];
    }
  }

  if (resolveComponent) {
    const existingLfIds = new Set(nodeList.map((n) => (n as LfNode)["id"]).filter((x): x is string => typeof x === "string"));
    for (const c of cube.nodes) {
      if (existingLfIds.has(c.lfNodeId)) {
        continue;
      }

      if (c.cubeType === "cube.lf.note") {
        nodeList.push(buildLfNoteNode(c));
        existingLfIds.add(c.lfNodeId);
        continue;
      }

      const lfKey = c.cubeType.replace(/^cube\.lf\./u, "");
      if (!lfKey) {
        continue;
      }

      const def = resolveComponent(lfKey);
      if (!def) {
        console.warn(`[graph-translator] no Langflow component definition for key: ${lfKey}`);
        continue;
      }
      nodeList.push(buildLfGenericNodeFromDef(c, lfKey, def, cube, langflowApiAllPath));
      existingLfIds.add(c.lfNodeId);
    }
  }

  const keepLfIds = new Set(cube.nodes.map((n) => n.lfNodeId));
  const prunedNodes = nodeList.filter((n) => {
    const id = (n as LfNode)["id"];
    return typeof id === "string" && keepLfIds.has(id);
  });
  out["nodes"] = prunedNodes;
  const mergedLfNodes = prunedNodes as LfNode[];

  const mergedOutputNamesFor = (nodeId: string): string[] => {
    for (const n of mergedLfNodes) {
      if (n["id"] !== nodeId) {
        continue;
      }
      const inner = (n["data"] as Record<string, unknown> | undefined)?.["node"] as Record<string, unknown> | undefined;
      const outs = inner?.["outputs"];
      if (!Array.isArray(outs)) {
        return [];
      }
      const names: string[] = [];
      for (const o of outs) {
        if (!o || typeof o !== "object") {
          continue;
        }
        const nm = (o as Record<string, unknown>)["name"];
        if (typeof nm === "string") {
          names.push(nm);
        }
      }
      return names;
    }
    return [];
  };

  const rebuiltEdges: LfEdge[] = [];
  for (const ce of cube.edges) {
    const sp = parseSemanticSourcePort(ce.sourcePort);
    const tp = parseSemanticTargetPort(ce.targetPort);
    if (!sp || !tp) {
      continue;
    }

    const sourceLf = x6ToLf.get(ce.source) ?? ce.source;
    const targetLf = x6ToLf.get(ce.target) ?? ce.target;
    const srcNodeLf = x6ToLf.get(sp.nodeId) ?? sp.nodeId;
    const tgtNodeLf = x6ToLf.get(tp.nodeId) ?? tp.nodeId;

    const srcCnForEdge = cubeByLf.get(srcNodeLf);
    const tgtCnForEdge = cubeByLf.get(tgtNodeLf);
    const lfTargetFieldName = lfTargetFieldNameForCubeAgentEdge(tgtCnForEdge, tp.fieldName);
    let effSourceName = sp.outputName;
    if (
      tp.fieldName === "tools" &&
      (srcCnForEdge?.cubeType === "cube.lf.Agent" || srcCnForEdge?.cubeType === "cube.lf.MCPTools") &&
      sp.outputName === "response" &&
      mergedOutputNamesFor(srcNodeLf).includes("component_as_tool")
    ) {
      effSourceName = "component_as_tool";
    }
    if (srcCnForEdge?.cubeType === "cube.lf.SmartRouter") {
      effSourceName = normalizeSmartRouterSemanticOutputName(srcCnForEdge.config, effSourceName);
    }

    const srcObj: LfSourceHandleObj = {
      dataType: "",
      id: srcNodeLf,
      name: effSourceName,
      output_types: [],
    };
    const tgtObj: LfTargetHandleObj = {
      fieldName: lfTargetFieldName,
      id: tgtNodeLf,
      inputTypes: [],
      type: "other",
    };

    const allBase = Array.isArray(baseLfData["edges"]) ? (baseLfData["edges"] as LfEdge[]) : [];
    let baseEdge = allBase.find((ed) => ed["id"] === ce.id);
    if (!baseEdge) {
      baseEdge = allBase.find((ed) => ed["source"] === ce.source && ed["target"] === ce.target);
    }
    if (!baseEdge) {
      baseEdge = allBase.find((ed) => ed["source"] === sourceLf && ed["target"] === targetLf);
    }

    if (baseEdge?.["data"] && typeof baseEdge["data"] === "object") {
      const d = baseEdge["data"] as Record<string, unknown>;
      const bs = d["sourceHandle"];
      const bt = d["targetHandle"];
      if (isSourceHandleObj(bs)) {
        srcObj.dataType = bs.dataType;
        srcObj.output_types = [...bs.output_types];
      }
      if (isTargetHandleObj(bt)) {
        tgtObj.inputTypes = [...bt.inputTypes];
        tgtObj.type = bt.type;
      }
    }

    if (resolveComponent) {
      const srcCn = cubeByLf.get(srcNodeLf);
      const tgtCn = cubeByLf.get(tgtNodeLf);
      if (srcCn && srcCn.cubeType !== "cube.lf.note") {
        const k = srcCn.cubeType.replace(/^cube\.lf\./u, "");
        if (k) {
          fillSourceHandleFromNode(mergedLfNodes, srcNodeLf, effSourceName, k, srcObj);
        }
      }
      if (tgtCn && tgtCn.cubeType !== "cube.lf.note") {
        const k = tgtCn.cubeType.replace(/^cube\.lf\./u, "");
        if (k) {
          enrichTargetHandleFromDef(resolveComponent(k), lfTargetFieldName, tgtObj);
        }
      }
    }
    enrichTargetHandleFromMergedNodeTemplate(mergedLfNodes, tgtNodeLf, lfTargetFieldName, tgtObj);

    const sourceHandleStr = stringifyLfHandle(srcObj);
    const targetHandleStr = stringifyLfHandle(tgtObj);

    rebuiltEdges.push({
      animated: false,
      className: "",
      data: { sourceHandle: srcObj, targetHandle: tgtObj },
      id: ce.id,
      selected: false,
      source: sourceLf,
      sourceHandle: sourceHandleStr,
      target: targetLf,
      targetHandle: targetHandleStr,
    });
  }

  out["edges"] = rebuiltEdges;

  if (cube.viewport) {
    out["viewport"] = cube.viewport;
  }

  const envLv = typeof process !== "undefined" && process.env ? String(process.env["CUBE_LANGFLOW_LF_VERSION"] ?? "").trim() : "";
  const fillMissingLf = envLv || sampleLfVersion;
  applyLfInnerMetadataToFlowNodes(prunedNodes, lfInnerMetaById, fillMissingLf);

  // 整图收尾：嵌套 model 与各节点 template 的 load_from_db 占位符；映射逻辑集中在 translator。
  normalizeLfFlowDataLoadFromDbPlaceholders(out);

  return out;
}
