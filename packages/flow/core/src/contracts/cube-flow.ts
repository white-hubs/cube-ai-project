/** Cube canonical flow graph — see cube-ai/docs/protocol-v1.md */

export const CUBE_FLOW_SCHEMA_VERSION = 1 as const;

export interface CubeFlowViewport {
  x: number;
  y: number;
  zoom: number;
}

/** 与 Langflow 画布控件启用状态对齐；不放入 config，避免与 template value 混淆 */
export interface CubeFlowFieldUi {
  /** 输入字段名 → 是否在侧栏/画布启用；缺省键表示沿用组件 schema 的静态 show */
  fieldEnabled?: Record<string, boolean>;
  /** 输入字段名 → 是否高级字段（与 LF template slot `advanced` 对齐）；缺省键沿用 schema */
  fieldAdvanced?: Record<string, boolean>;
  /** 节点级 Tool 模式（与 api-all 中组件默认 tool_mode 独立） */
  nodeToolMode?: boolean;
}

export interface CubeFlowNode {
  id: string;
  lfNodeId: string;
  cubeType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  config: Record<string, unknown>;
  /**
   * 与 Langflow `data.node.custom_fields` 对齐（Prompt 模板变量等）。
   * 缺省时不写入 LF，合并时保留快照原有 `custom_fields`。
   */
  customFields?: Record<string, unknown>;
  fieldUi?: CubeFlowFieldUi;
  /**
   * 多输出组件当前选中的输出（索引），与 Langflow `data.selected_output`（按 output `name`）对应。
   */
  selectedOutputIdx?: number;
  /** 与 Langflow 节点 `field_order` 一致；缺省则设计器仅用 api-all schema 中的顺序 */
  fieldOrder?: string[];
  /**
   * MCP Tools：当前 tool 的参数字段元数据（与 web `CubeSchemaInputField` 同形 JSON）。
   * 导出 LF 时用于在 `template` 中注入 Langflow 可识别的动态槽；缺省时从 `config` 非保留键推断。
   */
  mcpDynamicSchemaInputs?: Record<string, unknown>[];
}

export interface CubeFlowEdge {
  id: string;
  source: string;
  target: string;
  sourcePort: string;
  targetPort: string;
}

export interface CubeFlowGraph {
  schemaVersion: typeof CUBE_FLOW_SCHEMA_VERSION;
  nodes: CubeFlowNode[];
  edges: CubeFlowEdge[];
  viewport?: CubeFlowViewport;
}

export function emptyCubeFlowGraph(): CubeFlowGraph {
  return { edges: [], nodes: [], schemaVersion: CUBE_FLOW_SCHEMA_VERSION };
}
