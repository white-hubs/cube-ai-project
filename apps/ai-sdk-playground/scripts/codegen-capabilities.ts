import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CapabilityEntry, CapabilityKind, CapabilitiesManifest } from '../src/playground/types';
import { MANUAL_CAPABILITIES } from '../src/capabilities.manual';

interface ClassScanTarget {
  package: string;
  domain: CapabilityEntry['domain'];
  face: CapabilityEntry['face'];
  factory: string;
  file: string;
  className: string;
  apiPath?: string;
  kindOverrides?: Record<string, CapabilityKind>;
  skipMethods?: string[];
}

const SCAN_TARGETS: ClassScanTarget[] = [
  {
    package: '@cube-ai/agent-sdk-client',
    domain: 'agent',
    face: 'client',
    factory: 'createAgenticClient',
    file: 'packages/agent/sdk-client/src/client.ts',
    className: 'AgenticClient',
    skipMethods: ['constructor', 'buildRequestHeaders', 'requestJson'],
    kindOverrides: { healthLive: 'json' },
  },
  {
    package: '@cube-ai/agent-sdk-client',
    domain: 'agent',
    face: 'client',
    factory: 'createAgenticClient',
    file: 'packages/agent/sdk-client/src/session.ts',
    className: 'SessionApi',
    apiPath: 'sessions',
    kindOverrides: { streamEvents: 'sse' },
  },
  {
    package: '@cube-ai/agent-sdk-client',
    domain: 'agent',
    face: 'client',
    factory: 'createAgenticClient',
    file: 'packages/agent/sdk-client/src/files.ts',
    className: 'FilesApi',
    apiPath: 'files',
  },
  {
    package: '@cube-ai/agent-sdk-client',
    domain: 'agent',
    face: 'client',
    factory: 'createAgenticClient',
    file: 'packages/agent/sdk-client/src/grants.ts',
    className: 'GrantsApi',
    apiPath: 'grants',
  },
  {
    package: '@cube-ai/agent-sdk-client',
    domain: 'agent',
    face: 'client',
    factory: 'createAgenticClient',
    file: 'packages/agent/sdk-client/src/tools.ts',
    className: 'ToolAcksApi',
    apiPath: 'toolAcks',
  },
  {
    package: '@cube-ai/agent-sdk-client',
    domain: 'agent',
    face: 'client',
    factory: 'createAgenticClient',
    file: 'packages/agent/sdk-client/src/tools.ts',
    className: 'DescriptorsApi',
    apiPath: 'descriptors',
  },
  {
    package: '@cube-ai/agent-sdk-client',
    domain: 'agent',
    face: 'client',
    factory: 'createAgenticClient',
    file: 'packages/agent/sdk-client/src/tools.ts',
    className: 'ToolsApi',
    apiPath: 'tools',
  },
  {
    package: '@cube-ai/agent-sdk-client',
    domain: 'agent',
    face: 'client',
    factory: 'createAgenticClient',
    file: 'packages/agent/sdk-client/src/jobs.ts',
    className: 'JobsApi',
    apiPath: 'jobs',
  },
  {
    package: '@cube-ai/agent-sdk-console',
    domain: 'agent',
    face: 'console',
    factory: 'createAgentConsoleClient',
    file: 'packages/agent/sdk-console/src/client.ts',
    className: 'AgentConsoleClientImpl',
    kindOverrides: { propose: 'sse', createFromDocument: 'text-plain' },
  },
  {
    package: '@cube-ai/flow-sdk-client',
    domain: 'flow',
    face: 'client',
    factory: 'createFlowClient',
    file: 'packages/flow/sdk-client/src/client.ts',
    className: 'FlowClient',
    kindOverrides: { runFlowStream: 'sse', uploadFlowFile: 'form-data' },
  },
  {
    package: '@cube-ai/flow-sdk-console',
    domain: 'flow',
    face: 'console',
    factory: 'createFlowConsoleClient',
    file: 'packages/flow/sdk-console/src/client.ts',
    className: 'FlowConsoleClient',
  },
  {
    package: '@cube-ai/kb-sdk-client',
    domain: 'kb',
    face: 'client',
    factory: 'createKbClient',
    file: 'packages/kb/sdk-client/src/client.ts',
    className: 'KbClient',
  },
  {
    package: '@cube-ai/kb-sdk-console',
    domain: 'kb',
    face: 'console',
    factory: 'createKbConsoleClient',
    file: 'packages/kb/sdk-console/src/client.ts',
    className: 'KbConsoleClient',
    kindOverrides: {
      uploadDocument: 'form-data',
      previewDocument: 'form-data',
    },
  },
  {
    package: '@cube-ai/llm-sdk-console',
    domain: 'llm',
    face: 'console',
    factory: 'createLlmConsoleClient',
    file: 'packages/llm/sdk-console/src/client.ts',
    className: 'LlmConsoleClient',
  },
];

function slugPackage(pkg: string): string {
  return pkg.replace('@cube-ai/', '');
}

function extractClassBody(source: string, className: string): string | null {
  const marker = `class ${className}`;
  const start = source.indexOf(marker);
  if (start === -1) return null;
  const braceStart = source.indexOf('{', start);
  if (braceStart === -1) return null;

  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    if (ch === '}') {
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
  const lines = classBody.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('private ') || trimmed.startsWith('protected ')) continue;
    if (trimmed.startsWith('get ') || trimmed.startsWith('set ')) continue;
    const match = trimmed.match(/^(?:public\s+)?(?:async\s+)?(\w+)\s*\(/);
    if (!match) continue;
    const name = match[1];
    if (name === 'constructor') continue;
    methods.add(name);
  }
  return [...methods].sort();
}

function findMethodStart(classBody: string, methodName: string): number {
  for (const re of [
    new RegExp(`\\n\\s+async\\s+${methodName}\\s*\\(`),
    new RegExp(`\\n\\s+${methodName}\\s*\\(`),
  ]) {
    const match = re.exec(classBody);
    if (match) return match.index;
  }
  return -1;
}

function extractParamListSource(classBody: string, methodName: string): string {
  const start = findMethodStart(classBody, methodName);
  if (start === -1) return '';
  const parenStart = classBody.indexOf('(', start);
  if (parenStart === -1) return '';

  let depth = 0;
  for (let i = parenStart; i < classBody.length; i++) {
    const ch = classBody[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return classBody.slice(parenStart + 1, i);
    }
  }
  return '';
}

function extractMethodBlock(classBody: string, methodName: string): string {
  const start = findMethodStart(classBody, methodName);
  if (start === -1) return '';
  const parenStart = classBody.indexOf('(', start);
  if (parenStart === -1) return '';

  let depth = 0;
  let paramEnd = -1;
  for (let i = parenStart; i < classBody.length; i++) {
    const ch = classBody[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        paramEnd = i;
        break;
      }
    }
  }
  if (paramEnd === -1) return '';

  const braceStart = classBody.indexOf('{', paramEnd);
  if (braceStart === -1) return '';

  depth = 0;
  for (let i = braceStart; i < classBody.length; i++) {
    const ch = classBody[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return classBody.slice(start, i + 1);
    }
  }
  return classBody.slice(start);
}

function splitParamParts(paramList: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of paramList) {
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    if (ch === '}' || ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) parts.push(trimmed);
      current = '';
    } else {
      current += ch;
    }
  }
  const tail = current.trim();
  if (tail) parts.push(tail);
  return parts;
}

interface ParsedSignatureParam {
  name: string;
  typeStr: string;
  optional: boolean;
}

function parseSignatureParam(part: string): ParsedSignatureParam | null {
  const withoutDefault = part.split('=')[0]?.trim() ?? part.trim();
  const match = withoutDefault.match(/^(\w+)(\??)\s*:\s*(.+)$/s);
  if (!match) return null;
  const [, name, optionalMark, typeStr] = match;
  if (!name || !typeStr) return null;
  return {
    name,
    typeStr: typeStr.trim(),
    optional: optionalMark === '?' || part.includes('='),
  };
}

function mapParamType(typeStr: string, kind: CapabilityKind): CapabilityEntry['params'][number]['type'] {
  if (kind === 'form-data' || typeStr.includes('FormData')) return 'form-data';
  if (typeStr === 'string' || typeStr.endsWith('string')) return 'string';
  if (typeStr === 'number' || typeStr.endsWith('number')) return 'number';
  if (typeStr === 'boolean' || typeStr.endsWith('boolean')) return 'boolean';
  return 'json';
}

function inferPlacement(
  methodBlock: string,
  param: ParsedSignatureParam,
  index: number,
): CapabilityEntry['params'][number]['placement'] {
  const { name, typeStr } = param;
  if (new RegExp(`\\$\\{${name}\\}`).test(methodBlock)) return 'path';
  const querySection = methodBlock.match(/query:\s*\{([\s\S]*?)\}/);
  if (querySection) {
    const q = querySection[1] ?? '';
    if (q.includes(`${name}.`) || name === 'filter' || name === 'opts') return 'query';
  }
  if (methodBlock.includes('body:') || methodBlock.includes('body,')) {
    if (
      name === 'body' ||
      name === 'req' ||
      name === 'patch' ||
      name === 'request' ||
      typeStr.includes('Request') ||
      typeStr.includes('Body')
    ) {
      return 'body';
    }
    if (index > 0 && !/^(string|number|boolean)$/.test(typeStr)) return 'body';
  }
  if (/^(string|number)$/.test(typeStr)) return 'path';
  return 'body';
}

function describeParam(param: ParsedSignatureParam, placement: CapabilityEntry['params'][number]['placement']): string {
  const kind =
    placement === 'path'
      ? 'Path parameter'
      : placement === 'query'
        ? 'Query / filter object'
        : placement === 'body'
          ? 'Request body'
          : 'Method argument';
  return `${kind} (${param.typeStr})`;
}

function extractParamsFromMethod(
  classBody: string,
  method: string,
  kind: CapabilityKind,
): CapabilityEntry['params'] {
  if (kind === 'form-data') {
    return [{ name: 'formData', type: 'form-data', required: true, position: 0, placement: 'body' }];
  }

  const paramList = extractParamListSource(classBody, method);
  if (!paramList.trim()) return [];

  const methodBlock = extractMethodBlock(classBody, method);
  const parsed = splitParamParts(paramList)
    .map(parseSignatureParam)
    .filter((p): p is ParsedSignatureParam => p != null);

  return parsed.map((param, index) => {
    const placement = inferPlacement(methodBlock, param, index);
    return {
      name: param.name,
      type: mapParamType(param.typeStr, kind),
      required: !param.optional,
      position: index,
      placement,
      description: describeParam(param, placement),
    };
  });
}

function inferParams(method: string, kind: CapabilityKind): CapabilityEntry['params'] {
  if (kind === 'form-data') {
    return [{ name: 'formData', type: 'form-data', required: true, position: 0, placement: 'body' }];
  }
  if (method === 'healthLive' || method === 'listProviders' || method === 'listFlows') {
    return [];
  }
  if (method.startsWith('get') || method.startsWith('delete') || method.startsWith('remove')) {
    return [{ name: 'id', type: 'string', required: true, position: 0, placement: 'path' }];
  }
  return [
    {
      name: 'args',
      type: 'json',
      required: false,
      position: 0,
      placement: 'body',
      description: 'Method arguments as JSON object or __positional array',
    },
  ];
}

function scanClass(target: ClassScanTarget, repoRoot: string): CapabilityEntry[] {
  const source = readFileSync(join(repoRoot, target.file), 'utf8');
  const body = extractClassBody(source, target.className);
  if (!body) return [];

  const skip = new Set(target.skipMethods ?? []);
  const methods = extractPublicMethods(body).filter((m) => !skip.has(m));
  const pkgSlug = slugPackage(target.package);

  return methods.map((method) => {
    const kind = target.kindOverrides?.[method] ?? 'json';
    const id = target.apiPath
      ? `${pkgSlug}.${target.apiPath}.${method}`
      : `${pkgSlug}.${method}`;
    const params = extractParamsFromMethod(body, method, kind);
    const resolvedParams = params.length > 0 ? params : inferParams(method, kind);
    return {
      id,
      package: target.package,
      domain: target.domain,
      face: target.face,
      factory: target.factory,
      apiPath: target.apiPath,
      method,
      kind,
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
    generatedAt: new Date().toISOString(),
    entries: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function writeCapabilitiesManifest(repoRoot: string, outFile: string): CapabilitiesManifest {
  const manifest = generateCapabilitiesManifest(repoRoot);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

if (import.meta.main) {
  const repoRoot = join(import.meta.dir, '../../..');
  const outFile = join(import.meta.dir, '../src/generated/capabilities.json');
  const manifest = writeCapabilitiesManifest(repoRoot, outFile);
  console.log(`codegen: wrote ${manifest.entries.length} capabilities → ${outFile}`);
}
