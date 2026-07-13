import { type ToolDescriptor, ToolDescriptor as ToolDescriptorSchema } from "@cube-ai/contracts";

import type { DescriptorRegistryService } from "./descriptor-registry.service";

export const ENGINE_BUILTIN_TOOL_NAMES = [
  "currentDate",
  "session_recall",
  "image.qwen",
  "platform.knowledge.query",
  "platform.flow.list",
  "platform.flow.invoke",
] as const;

/**
 * 暂时不注册的引擎内置工具（代码与 reserved 名单保留，外部同名 descriptor 仍会被丢弃）。
 * 重新启用：从本集合移除对应 name 即可。
 */
export const DISABLED_ENGINE_BUILTIN_TOOL_NAMES = ["platform.flow.list", "platform.flow.invoke"] as const;

const CURRENT_DATE_DESCRIPTOR_RAW = {
  schemaVersion: 1,
  kind: "TOOL" as const,
  name: "currentDate",
  displayName: "Current time (UTC)",
  description: "Returns authoritative server time in UTC as { iso, epochMs }; arguments must be {}. No timezone conversion is performed.",
  isPreset: true,
  version: "1.0.0",
  meta: {
    execution: "LOCAL" as const,
    consent: "NEVER" as const,
    requiresPrincipal: "USER" as const,
    timeoutMs: 5_000,
    idempotent: true,
    sideEffects: ["read:engine.clock"],
  },
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
  outputSchema: {
    type: "object" as const,
    properties: {
      iso: { type: "string", description: "ISO-8601 UTC from Date.prototype.toISOString()" },
      epochMs: { type: "integer", description: "Unix epoch milliseconds" },
    },
  },
  requires: { principal: "USER" as const, oauthScope: [], obo: null },
  /** 分段须小写以匹配 descriptor-schema execute ref（工具名仍为 currentDate） */
  execute: "builtin:engine.current_date",
  handler: { kind: "clock" as const, config: {} },
  category: "PLATFORM" as const,
  tags: ["clock", "builtin", "engine"],
} as const;

export function buildCurrentDateDescriptor(): ToolDescriptor {
  const parsed = ToolDescriptorSchema.safeParse(CURRENT_DATE_DESCRIPTOR_RAW);
  if (!parsed.success) {
    throw new Error(`currentDate builtin descriptor invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** 若注册表尚无 `currentDate`，注册引擎内置描述符。 */
export function ensureBuiltinCurrentDateDescriptor(registry: DescriptorRegistryService): void {
  if (registry.resolve("currentDate")) return;
  registry.register(buildCurrentDateDescriptor());
}

const SESSION_RECALL_DESCRIPTOR_RAW = {
  schemaVersion: 1,
  kind: "TOOL" as const,
  name: "session_recall",
  displayName: "Session transcript recall",
  description:
    "Recalls prior messages in the CURRENT session from durable transcript (same source as chat history UI). Use when the user refers to earlier turns (e.g. previous report, prior answer) or when session context seems missing. Optional query filters by substring. Returns { mode, truncated, messages }. mode=summary means content was compressed to fit maxChars — ask again with a tighter query if detail is missing. Scope is this session only; not cross-session memory.",
  isPreset: true,
  version: "1.0.0",
  meta: {
    execution: "LOCAL" as const,
    consent: "NEVER" as const,
    requiresPrincipal: "USER" as const,
    timeoutMs: 15_000,
    idempotent: true,
    sideEffects: ["read:engine.session.messages"],
  },
  inputSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      query: {
        type: "string",
        description: "Optional case-insensitive substring to filter message text (e.g. report title keywords).",
      },
      maxChars: {
        type: "integer",
        minimum: 1,
        maximum: 200_000,
        description: "Max total characters of returned message text before summary mode (default 32000).",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 200,
        description: "Max messages to load chronologically (default 200).",
      },
    },
  },
  outputSchema: {
    type: "object" as const,
    properties: {
      mode: { type: "string", description: "full | summary" },
      truncated: { type: "boolean" },
      messages: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            turnId: { type: "string" },
            role: { type: "string" },
            text: { type: "string" },
            createTime: { type: "integer" },
          },
        },
      },
    },
  },
  requires: { principal: "USER" as const, oauthScope: [], obo: null },
  execute: "builtin:engine.session_recall",
  handler: { kind: "sessionRecall" as const, config: {} },
  category: "PLATFORM" as const,
  tags: ["session", "recall", "builtin", "engine"],
} as const;

export function buildSessionRecallDescriptor(): ToolDescriptor {
  const parsed = ToolDescriptorSchema.safeParse(SESSION_RECALL_DESCRIPTOR_RAW);
  if (!parsed.success) {
    throw new Error(`session_recall builtin descriptor invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** 若注册表尚无 `session_recall`，注册引擎内置描述符（ADR-0036）。 */
export function ensureBuiltinSessionRecallDescriptor(registry: DescriptorRegistryService): void {
  if (registry.resolve("session_recall")) return;
  registry.register(buildSessionRecallDescriptor());
}

const IMAGE_QWEN_DESCRIPTOR_RAW = {
  schemaVersion: 1,
  kind: "TOOL" as const,
  name: "image.qwen",
  displayName: "Qwen image (generate / edit)",
  description:
    "Generates or edits images via Alibaba DashScope Qwen image API (text-to-image, or 1–3 reference images + edit instruction). NOT for understanding or describing images the user already uploaded — use multimodal chat for that. Returns JSON with temporary image URLs (~24h); final answer should embed them directly (e.g. markdown). Requires DASHSCOPE_API_KEY.",
  isPreset: true,
  version: "1.0.0",
  meta: {
    execution: "LOCAL" as const,
    consent: "NEVER" as const,
    requiresPrincipal: "USER" as const,
    timeoutMs: 120_000,
    idempotent: false,
    sideEffects: ["network:dashscope"],
  },
  inputSchema: {
    type: "object" as const,
    properties: {
      prompt: {
        type: "string",
        description: "Main instruction or text-to-image prompt (required).",
      },
      referenceImages: {
        type: "array",
        description: "0–3 image URLs or data:image/...;base64,... inputs for edit / fusion.",
        items: { type: "string" },
        maxItems: 3,
      },
      model: {
        type: "string",
        description: "DashScope model id; defaults from env QWEN_IMAGE_MODEL or qwen-image-2.0-pro.",
      },
      n: {
        type: "integer",
        minimum: 1,
        maximum: 6,
        description: "Number of output images (default 1).",
      },
      size: {
        type: "string",
        description: "Optional size like 1024*1536 when supported by the model.",
      },
      negativePrompt: { type: "string", description: "Optional negative prompt." },
      watermark: { type: "boolean", description: "Whether to add Qwen-Image watermark (default false)." },
      promptExtend: { type: "boolean", description: "Enable prompt rewrite (default true)." },
      seed: { type: "integer", description: "Optional deterministic seed." },
    },
    required: ["prompt"],
  },
  outputSchema: {
    type: "object" as const,
    properties: {
      requestId: { type: "string", description: "Upstream request id when present." },
      model: { type: "string", description: "Model id used for the call." },
      images: {
        type: "array",
        description: "Generated images with DashScope temporary URLs (typically valid ~24h).",
        items: {
          type: "object",
          properties: {
            url: { type: "string", description: "Upstream HTTPS image URL from DashScope." },
          },
          required: ["url"],
        },
      },
    },
  },
  requires: { principal: "USER" as const, oauthScope: [], obo: null },
  execute: "builtin:engine.image_qwen",
  handler: { kind: "qwenImage" as const, config: {} },
  category: "PLATFORM" as const,
  tags: ["image", "dashscope", "builtin", "engine"],
} as const;

export function buildImageQwenDescriptor(): ToolDescriptor {
  const parsed = ToolDescriptorSchema.safeParse(IMAGE_QWEN_DESCRIPTOR_RAW);
  if (!parsed.success) {
    throw new Error(`image.qwen builtin descriptor invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** 若注册表尚无 `image.qwen`，注册引擎内置描述符。 */
export function ensureBuiltinImageQwenDescriptor(registry: DescriptorRegistryService): void {
  if (registry.resolve("image.qwen")) return;
  registry.register(buildImageQwenDescriptor());
}

const PLATFORM_KNOWLEDGE_QUERY_DESCRIPTOR_RAW = {
  schemaVersion: 1,
  kind: "TOOL" as const,
  name: "platform.knowledge.query",
  displayName: "Platform knowledge query",
  description:
    "Queries tenant-scoped AI middle-platform knowledge bases attached to the current turn. The handler enforces the current-turn runtimeRefs knowledge base allowlist.",
  isPreset: true,
  version: "0.1.0",
  meta: {
    execution: "LOCAL" as const,
    consent: "NEVER" as const,
    requiresPrincipal: "USER" as const,
    timeoutMs: 120_000,
    idempotent: true,
    sideEffects: ["read:platform.knowledge"],
  },
  inputSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      query: { type: "string", description: "Search query, 2..512 characters." },
      kbIds: {
        type: "array",
        description: "Optional subset of current-turn knowledge base ids.",
        items: { type: "string" },
      },
      topK: {
        type: "integer",
        minimum: 1,
        maximum: 20,
        description: "Maximum number of snippets to return.",
      },
      scoreThreshold: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Minimum relevance score.",
      },
    },
    required: ["query"],
  },
  outputSchema: {
    type: "object" as const,
    properties: {
      hits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            docId: { type: "string" },
            kbId: { type: "string" },
            title: { type: "string" },
            snippet: { type: "string" },
            score: { type: "number" },
            link: { type: "string" },
          },
        },
      },
      truncated: { type: "boolean" },
    },
  },
  requires: { principal: "USER" as const, oauthScope: [], obo: null },
  execute: "builtin:platform.knowledge.query",
  category: "PLATFORM" as const,
  tags: ["knowledge", "builtin", "platform"],
} as const;

const PLATFORM_FLOW_LIST_DESCRIPTOR_RAW = {
  schemaVersion: 1,
  kind: "TOOL" as const,
  name: "platform.flow.list",
  displayName: "Platform flow list",
  description:
    "Lists AI middle-platform flows configured for the current tenant. Use this to discover available flows before invoking one.",
  isPreset: true,
  version: "0.1.0",
  meta: {
    execution: "LOCAL" as const,
    consent: "NEVER" as const,
    requiresPrincipal: "USER" as const,
    timeoutMs: 15_000,
    idempotent: true,
    sideEffects: ["read:platform.flow"],
  },
  inputSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      keyword: { type: "string" },
      pageNumber: { type: "integer", minimum: 1 },
      pageSize: { type: "integer", minimum: 1, maximum: 100 },
    },
  },
  outputSchema: {
    type: "object" as const,
    properties: {
      flows: {
        type: "array",
        items: {
          type: "object",
          properties: {
            flowId: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            enabled: { type: "boolean" },
            compileStatus: { type: "string" },
          },
        },
      },
      total: { type: "integer" },
    },
  },
  requires: { principal: "USER" as const, oauthScope: [], obo: null },
  execute: "builtin:platform.flow.list",
  category: "PLATFORM" as const,
  tags: ["flow", "builtin", "platform"],
} as const;

const PLATFORM_FLOW_INVOKE_DESCRIPTOR_RAW = {
  schemaVersion: 1,
  kind: "TOOL" as const,
  name: "platform.flow.invoke",
  displayName: "Platform flow invoke",
  description: "Invokes an AI middle-platform flow synchronously. Pass the user utterance in variables.input (preferred).",
  isPreset: true,
  version: "0.1.0",
  meta: {
    execution: "LOCAL" as const,
    consent: "ON_FIRST_USE" as const,
    requiresPrincipal: "USER" as const,
    timeoutMs: 300_000,
    idempotent: false,
    sideEffects: ["invoke:platform.flow"],
  },
  inputSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      flowId: {
        type: "string",
        description: "Flow definition ID from platform.flow.list flows[].flowId",
        maxLength: 64,
      },
      variables: {
        type: "object",
        description:
          "Flow runtime variables. For chat-style flows put the user message in input (string). Server also accepts message, query, question, prompt, text as aliases for input. Other keys are flow-specific tweaks.",
        additionalProperties: true,
        properties: {
          input: {
            type: "string",
            description: "Primary user message text mapped to Langflow input_value",
          },
        },
      },
    },
    required: ["flowId"],
  },
  outputSchema: {
    type: "object" as const,
    properties: {
      result: { type: "object", additionalProperties: true },
      executionTrace: { type: "array" },
      traceTruncated: { type: "boolean" },
      partial: { type: "boolean" },
    },
  },
  requires: { principal: "USER" as const, oauthScope: [], obo: null },
  execute: "builtin:platform.flow.invoke",
  category: "PLATFORM" as const,
  tags: ["flow", "builtin", "platform"],
} as const;

export function buildPlatformToolDescriptors(): ToolDescriptor[] {
  const raws = [PLATFORM_KNOWLEDGE_QUERY_DESCRIPTOR_RAW, PLATFORM_FLOW_LIST_DESCRIPTOR_RAW, PLATFORM_FLOW_INVOKE_DESCRIPTOR_RAW];
  return raws.map((raw) => {
    const parsed = ToolDescriptorSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`platform builtin descriptor ${raw.name} invalid: ${parsed.error.message}`);
    }
    return parsed.data;
  });
}

/** 若注册表尚无平台内置工具，注册 KB（及未禁用的 Flow）描述符。 */
export function ensureBuiltinPlatformToolDescriptors(registry: DescriptorRegistryService): void {
  const disabled = new Set<string>(DISABLED_ENGINE_BUILTIN_TOOL_NAMES);
  for (const descriptor of buildPlatformToolDescriptors()) {
    if (disabled.has(descriptor.name)) continue;
    if (registry.resolve(descriptor.name)) continue;
    registry.register(descriptor);
  }
}
