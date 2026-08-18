import { AgenticEngineError } from "../../infra/errors/agentic-error";

export const BIZ_ONTOLOGY_ASK_BUSINESS_DATA_TOOL = "mcp.biz-ontology.ask_business_data";

const DEPRECATED_BIZ_ONTOLOGY_TOOL_REFS = new Set([
  "mcp.biz-ontology.query_database",
  "mcp.biz-ontology.resolve_business_query",
]);

const DEPRECATED_BIZ_ONTOLOGY_LOCAL_TOOL_NAMES = new Set(["query_database", "resolve_business_query"]);

export function isDeprecatedBizOntologyToolRef(toolRef: string): boolean {
  const ref = toolRef.trim();
  if (DEPRECATED_BIZ_ONTOLOGY_TOOL_REFS.has(ref)) return true;
  const normalizedMcpRef = ref.startsWith("mcp.biz-ontology.") ? ref.slice("mcp.biz-ontology.".length) : ref;
  return DEPRECATED_BIZ_ONTOLOGY_LOCAL_TOOL_NAMES.has(normalizedMcpRef);
}

export function assertNoDeprecatedBizOntologyToolRefs(toolRefs: readonly string[], source: string): void {
  const deprecated = toolRefs.filter(isDeprecatedBizOntologyToolRef);
  if (deprecated.length === 0) return;
  throw AgenticEngineError.fromCode(
    "INVALID_ARGUMENT_SCHEMA_VIOLATION",
    `Deprecated biz-ontology MCP tool reference is not allowed in ${source}; migrate to ${BIZ_ONTOLOGY_ASK_BUSINESS_DATA_TOOL}`,
    {
      source,
      deprecatedToolRefs: deprecated,
      migrationTarget: BIZ_ONTOLOGY_ASK_BUSINESS_DATA_TOOL,
    },
  );
}

export function assertMcpToolIsNotDeprecatedBizOntologyTool(serverId: string, toolName: string): void {
  const fullRef = `mcp.${serverId}.${toolName}`;
  assertNoDeprecatedBizOntologyToolRefs([fullRef, toolName], "mcp tool invocation");
}
