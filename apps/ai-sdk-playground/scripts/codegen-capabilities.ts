import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { MANUAL_CAPABILITIES } from "../src/capabilities.manual";
import { type CapabilitiesManifest, type CapabilityEntry, type CapabilityKind } from "../src/playground/types";

interface ClassScanTarget {
  package: string;
  domain: CapabilityEntry["domain"];
  face: CapabilityEntry["face"];
  factory: string;
  file: string;
  className: string;
  apiPath?: string;
  kindOverrides?: Record<string, CapabilityKind>;
  skipMethods?: string[];
}

const SCAN_TARGETS: ClassScanTarget[] = [
  {
    className: "AgenticClient",
    domain: "agent",
    face: "client",
    factory: "createAgenticClient",
    file: "packages/agent/sdk-client/src/client.ts",
    kindOverrides: { healthLive: "json" },
    package: "@cube-ai/agent-sdk-client",
    skipMethods: ["constructor", "buildRequestHeaders", "requestJson"],
  },
  {
    apiPath: "sessions",
    className: "SessionApi",
    domain: "agent",
    face: "client",
    factory: "createAgenticClient",
    file: "packages/agent/sdk-client/src/session.ts",
    kindOverrides: { streamEvents: "sse" },
    package: "@cube-ai/agent-sdk-client",
  },
  {
    apiPath: "files",
    className: "FilesApi",
    domain: "agent",
    face: "client",
    factory: "createAgenticClient",
    file: "packages/agent/sdk-client/src/files.ts",
    package: "@cube-ai/agent-sdk-client",
  },
  {
    apiPath: "grants",
    className: "GrantsApi",
    domain: "agent",
    face: "client",
    factory: "createAgenticClient",
    file: "packages/agent/sdk-client/src/grants.ts",
    package: "@cube-ai/agent-sdk-client",
  },
  {
    apiPath: "toolAcks",
    className: "ToolAcksApi",
    domain: "agent",
    face: "client",
    factory: "createAgenticClient",
    file: "packages/agent/sdk-client/src/tools.ts",
    package: "@cube-ai/agent-sdk-client",
  },
  {
    apiPath: "descriptors",
    className: "DescriptorsApi",
    domain: "agent",
    face: "client",
    factory: "createAgenticClient",
    file: "packages/agent/sdk-client/src/tools.ts",
    package: "@cube-ai/agent-sdk-client",
  },
  {
    apiPath: "tools",
    className: "ToolsApi",
    domain: "agent",
    face: "client",
    factory: "createAgenticClient",
    file: "packages/agent/sdk-client/src/tools.ts",
    package: "@cube-ai/agent-sdk-client",
  },
  {
    apiPath: "jobs",
    className: "JobsApi",
    domain: "agent",
    face: "client",
    factory: "createAgenticClient",
    file: "packages/agent/sdk-client/src/jobs.ts",
    package: "@cube-ai/agent-sdk-client",
  },
  {
    className: "AgentConsoleClientImpl",
    domain: "agent",
    face: "console",
    factory: "createAgentConsoleClient",
    file: "packages/agent/sdk-console/src/client.ts",
    kindOverrides: { createFromDocument: "text-plain", propose: "sse" },
    package: "@cube-ai/agent-sdk-console",
  },
  {
    className: "FlowClient",
    domain: "flow",
    face: "client",
    factory: "createFlowClient",
    file: "packages/flow/sdk-client/src/client.ts",
    kindOverrides: { runFlowStream: "sse", uploadFlowFile: "form-data" },
    package: "@cube-ai/flow-sdk-client",
  },
  {
    className: "FlowConsoleClient",
    domain: "flow",
    face: "console",
    factory: "createFlowConsoleClient",
    file: "packages/flow/sdk-console/src/client.ts",
    package: "@cube-ai/flow-sdk-console",
  },
  {
    className: "KbClient",
    domain: "kb",
    face: "client",
    factory: "createKbClient",
    file: "packages/kb/sdk-client/src/client.ts",
    package: "@cube-ai/kb-sdk-client",
  },
  {
    className: "KbConsoleClient",
    domain: "kb",
    face: "console",
    factory: "createKbConsoleClient",
    file: "packages/kb/sdk-console/src/client.ts",
    kindOverrides: {
      previewDocument: "form-data",
      uploadDocument: "form-data",
    },
    package: "@cube-ai/kb-sdk-console",
  },
  {
    className: "LlmConsoleClient",
    domain: "llm",
    face: "console",
    factory: "createLlmConsoleClient",
    file: "packages/llm/sdk-console/src/client.ts",
    package: "@cube-ai/llm-sdk-console",
  },
];

function slugPackage(pkg: string): string {
  return pkg.replace("@cube-ai/", "");
}

function extractClassBody(source: string, className: string): string | null {
  const marker = `class ${className}`;
  const start = source.indexOf(marker);
  if (start === -1) {
    return null;
  }
  const braceStart = source.indexOf("{", start);
  if (braceStart === -1) {
    return null;
  }

  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      depth++;
    }
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(braceStart + 1, i);
      }
    }
  }
  return null;
}

function extractPublicMethods(classBody: string): string[] {
  const methods = new Set<string>();
  const lines = classBody.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("private ") || trimmed.startsWith("protected ")) {
      continue;
    }
    if (trimmed.startsWith("get ") || trimmed.startsWith("set ")) {
      continue;
    }
    const match = trimmed.match(/^(?:public\s+)?(?:async\s+)?(\w+)\s*\(/u);
    if (!match) {
      continue;
    }
    const name = match[1];
    if (name === "constructor") {
      continue;
    }
    methods.add(name);
  }
  return [...methods].toSorted();
}

function findMethodStart(classBody: string, methodName: string): number {
  for (const re of [new RegExp(`\\n\\s+async\\s+${methodName}\\s*\\(`, "u"), new RegExp(`\\n\\s+${methodName}\\s*\\(`, "u")]) {
    const match = re.exec(classBody);
    if (match) {
      return match.index;
    }
  }
  return -1;
}

function extractParamListSource(classBody: string, methodName: string): string {
  const start = findMethodStart(classBody, methodName);
  if (start === -1) {
    return "";
  }
  const parenStart = classBody.indexOf("(", start);
  if (parenStart === -1) {
    return "";
  }

  let depth = 0;
  for (let i = parenStart; i < classBody.length; i++) {
    const ch = classBody[i];
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) {
        return classBody.slice(parenStart + 1, i);
      }
    }
  }
  return "";
}

function extractMethodBlock(classBody: string, methodName: string): string {
  const start = findMethodStart(classBody, methodName);
  if (start === -1) {
    return "";
  }
  const parenStart = classBody.indexOf("(", start);
  if (parenStart === -1) {
    return "";
  }

  let depth = 0;
  let paramEnd = -1;
  for (let i = parenStart; i < classBody.length; i++) {
    const ch = classBody[i];
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) {
        paramEnd = i;
        break;
      }
    }
  }
  if (paramEnd === -1) {
    return "";
  }

  const braceStart = classBody.indexOf("{", paramEnd);
  if (braceStart === -1) {
    return "";
  }

  depth = 0;
  for (let i = braceStart; i < classBody.length; i++) {
    const ch = classBody[i];
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return classBody.slice(start, i + 1);
      }
    }
  }
  return classBody.slice(start);
}

function splitParamParts(paramList: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of paramList) {
    if (ch === "{" || ch === "(" || ch === "[") {
      depth++;
    }
    if (ch === "}" || ch === ")" || ch === "]") {
      depth--;
    }
    if (ch === "," && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) {
        parts.push(trimmed);
      }
      current = "";
    } else {
      current += ch;
    }
  }
  const tail = current.trim();
  if (tail) {
    parts.push(tail);
  }
  return parts;
}

interface ParsedSignatureParam {
  name: string;
  typeStr: string;
  optional: boolean;
}

function parseSignatureParam(part: string): ParsedSignatureParam | null {
  const withoutDefault = part.split("=")[0]?.trim() ?? part.trim();
  const match = withoutDefault.match(/^(\w+)(\??)\s*:\s*(.+)$/su);
  if (!match) {
    return null;
  }
  const [, name, optionalMark, typeStr] = match;
  if (!name || !typeStr) {
    return null;
  }
  return {
    name,
    optional: optionalMark === "?" || part.includes("="),
    typeStr: typeStr.trim(),
  };
}

function mapParamType(typeStr: string, kind: CapabilityKind): CapabilityEntry["params"][number]["type"] {
  if (kind === "form-data" || typeStr.includes("FormData")) {
    return "form-data";
  }
  if (typeStr === "string" || typeStr.endsWith("string")) {
    return "string";
  }
  if (typeStr === "number" || typeStr.endsWith("number")) {
    return "number";
  }
  if (typeStr === "boolean" || typeStr.endsWith("boolean")) {
    return "boolean";
  }
  return "json";
}

function inferPlacement(methodBlock: string, param: ParsedSignatureParam, index: number): CapabilityEntry["params"][number]["placement"] {
  const { name, typeStr } = param;
  if (new RegExp(`\\$\\{${name}\\}`, "u").test(methodBlock)) {
    return "path";
  }
  const querySection = methodBlock.match(/query:\s*\{([\s\S]*?)\}/u);
  if (querySection) {
    const q = querySection[1] ?? "";
    if (q.includes(`${name}.`) || name === "filter" || name === "opts") {
      return "query";
    }
  }
  if (methodBlock.includes("body:") || methodBlock.includes("body,")) {
    if (
      name === "body" ||
      name === "req" ||
      name === "patch" ||
      name === "request" ||
      typeStr.includes("Request") ||
      typeStr.includes("Body")
    ) {
      return "body";
    }
    if (index > 0 && !/^(string|number|boolean)$/u.test(typeStr)) {
      return "body";
    }
  }
  if (/^(string|number)$/u.test(typeStr)) {
    return "path";
  }
  return "body";
}

function describeParam(param: ParsedSignatureParam, placement: CapabilityEntry["params"][number]["placement"]): string {
  const kind =
    placement === "path"
      ? "Path parameter"
      : placement === "query"
        ? "Query / filter object"
        : placement === "body"
          ? "Request body"
          : "Method argument";
  return `${kind} (${param.typeStr})`;
}

function extractParamsFromMethod(classBody: string, method: string, kind: CapabilityKind): CapabilityEntry["params"] {
  if (kind === "form-data") {
    return [{ name: "formData", placement: "body", position: 0, required: true, type: "form-data" }];
  }

  const paramList = extractParamListSource(classBody, method);
  if (!paramList.trim()) {
    return [];
  }

  const methodBlock = extractMethodBlock(classBody, method);
  const parsed = splitParamParts(paramList)
    .map((value) => parseSignatureParam(value))
    .filter((p): p is ParsedSignatureParam => p !== null && p !== undefined);

  return parsed.map((param, index) => {
    const placement = inferPlacement(methodBlock, param, index);
    return {
      description: describeParam(param, placement),
      name: param.name,
      placement,
      position: index,
      required: !param.optional,
      type: mapParamType(param.typeStr, kind),
    };
  });
}

function inferParams(method: string, kind: CapabilityKind): CapabilityEntry["params"] {
  if (kind === "form-data") {
    return [{ name: "formData", placement: "body", position: 0, required: true, type: "form-data" }];
  }
  if (method === "healthLive" || method === "listProviders" || method === "listFlows") {
    return [];
  }
  if (method.startsWith("get") || method.startsWith("delete") || method.startsWith("remove")) {
    return [{ name: "id", placement: "path", position: 0, required: true, type: "string" }];
  }
  return [
    {
      description: "Method arguments as JSON object or __positional array",
      name: "args",
      placement: "body",
      position: 0,
      required: false,
      type: "json",
    },
  ];
}

function scanClass(target: ClassScanTarget, repoRoot: string): CapabilityEntry[] {
  const source = readFileSync(join(repoRoot, target.file), "utf8");
  const body = extractClassBody(source, target.className);
  if (!body) {
    return [];
  }

  const skip = new Set(target.skipMethods);
  const methods = extractPublicMethods(body).filter((m) => !skip.has(m));
  const pkgSlug = slugPackage(target.package);

  return methods.map((method) => {
    const kind = target.kindOverrides?.[method] ?? "json";
    const id = target.apiPath ? `${pkgSlug}.${target.apiPath}.${method}` : `${pkgSlug}.${method}`;
    const params = extractParamsFromMethod(body, method, kind);
    const resolvedParams = params.length > 0 ? params : inferParams(method, kind);
    return {
      apiPath: target.apiPath,
      domain: target.domain,
      face: target.face,
      factory: target.factory,
      id,
      kind,
      method,
      package: target.package,
      params: resolvedParams,
    };
  });
}

export function generateCapabilitiesManifest(repoRoot: string): CapabilitiesManifest {
  const generated = SCAN_TARGETS.flatMap((target) => scanClass(target, repoRoot));
  const byId = new Map<string, CapabilityEntry>();
  for (const entry of generated) {
    byId.set(entry.id, entry);
  }
  for (const entry of MANUAL_CAPABILITIES) {
    byId.set(entry.id, entry);
  }
  return {
    entries: [...byId.values()].toSorted((a, b) => a.id.localeCompare(b.id)),
    generatedAt: new Date().toISOString(),
  };
}

export function writeCapabilitiesManifest(repoRoot: string, outFile: string): CapabilitiesManifest {
  const manifest = generateCapabilitiesManifest(repoRoot);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

if (import.meta.main) {
  const repoRoot = join(import.meta.dir, "../../..");
  const outFile = join(import.meta.dir, "../src/generated/capabilities.json");
  const manifest = writeCapabilitiesManifest(repoRoot, outFile);
  console.log(`codegen: wrote ${manifest.entries.length} capabilities → ${outFile}`);
}
