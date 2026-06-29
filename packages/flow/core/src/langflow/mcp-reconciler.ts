/**
 * MCP Tools 动态 schema 协调与 Langflow 模板注入。
 * 实际逻辑位于 graph-translator.ts；此文件是面向外部的导入入口。
 */
export {
  normalizeCubeGraphMcpDynamicSchema,
  injectLfMcpToolsDynamicSlotsFromListedTools,
  reconcileMcpToolsToolsetTemplateInLfData,
} from "./graph-translator";
