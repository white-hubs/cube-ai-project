/**
 * 管理 ops 工具集「一核」（ADR-0027 §7/§8）。
 *
 * 把 {@link DescriptorManagementService} 的 ops（list/get/create/update/publish/
 * delete/propose）收敛为**单一核心**：一份 op 目录（catalog）+ 一个纯派发函数
 * {@link runDescriptorOp}。两面（进程内 Tool Handler、对外 MCP server 门面）都消费
 * 这同一核心——业务逻辑不重复（ADR-0027 §8「一核两面」）。
 *
 * tenant 永远来自调用上下文（ctx.auth.tenant / MCP transport 解析的租户），
 * **绝不**从工具入参读取（ADR-0012 addendum：租户单一隔离主键）。
 */
import type {
  ConsentMode,
  ProposeRequest,
  ProposeResult,
  TenantDescriptorKind,
  TenantDescriptorView,
  ToolDescriptor,
} from '@cube-ai/contracts';
import { ProposeRequestSchema, ToolDescriptor as ToolDescriptorSchema } from '@cube-ai/contracts';
import { AgenticEngineError } from '../../../infra/errors/agentic-error';

/** 管理面 ops 闭集（与 {@link DescriptorManagementService} 公共方法一一对应）。 */
export const DESCRIPTOR_OPS = [
  'list',
  'get',
  'create',
  'update',
  'publish',
  'delete',
  'propose',
] as const;

export type DescriptorOp = (typeof DESCRIPTOR_OPS)[number];

export function isDescriptorOp(value: string): value is DescriptorOp {
  return (DESCRIPTOR_OPS as readonly string[]).includes(value);
}

/**
 * 「动运行时」的 op（publish / 软删）——两面写语义对齐（ADR-0027 §9）：
 *   - 进程内面：descriptor 声明强 consent（EACH_CALL），由 Tool 编排把关；
 *   - MCP 对外面：服务端硬保证，需显式 `confirmed: true`。
 */
export const CONFIRM_REQUIRED_OPS: ReadonlySet<DescriptorOp> = new Set<DescriptorOp>([
  'publish',
  'delete',
]);

/**
 * 核心依赖的最小结构契约（= {@link DescriptorManagementService} 的子集）。
 * 用接口而非具体类，便于两面共享与测试 mock；DI 仍注入具体 service。
 */
export interface DescriptorManagementOps {
  list(tenant: number, kind: TenantDescriptorKind): Promise<TenantDescriptorView[]>;
  get(tenant: number, id: string): Promise<TenantDescriptorView>;
  create(
    tenant: number,
    kind: TenantDescriptorKind,
    body: { name?: unknown; content?: unknown },
    actor?: string,
  ): Promise<TenantDescriptorView>;
  update(
    tenant: number,
    kind: TenantDescriptorKind,
    id: string,
    content: unknown,
    actor?: string,
  ): Promise<TenantDescriptorView>;
  publish(tenant: number, id: string, actor?: string): Promise<TenantDescriptorView>;
  remove(tenant: number, id: string, actor?: string): Promise<void>;
  propose(
    tenant: number,
    kind: TenantDescriptorKind,
    req: ProposeRequest,
  ): Promise<ProposeResult>;
}

type Args = Record<string, unknown>;

function asRecord(input: unknown): Args {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Args)
    : {};
}

function requireKind(args: Args): TenantDescriptorKind {
  const k = args['kind'];
  if (k === 'agent' || k === 'skill' || k === 'rule') return k;
  throw AgenticEngineError.fromCode(
    'INVALID_ARGUMENT_SCHEMA_VIOLATION',
    `descriptor management op requires kind ∈ {agent,skill,rule}; got: ${String(k)}`,
  );
}

function requireId(args: Args): string {
  const id = typeof args['id'] === 'string' ? args['id'].trim() : '';
  if (!id) {
    throw AgenticEngineError.fromCode(
      'INVALID_ARGUMENT_DESCRIPTOR_ID',
      'descriptor management op requires a non-empty id',
    );
  }
  return id;
}

function parseProposeRequest(args: Args): ProposeRequest {
  const parsed = ProposeRequestSchema.safeParse(args);
  if (!parsed.success) {
    throw AgenticEngineError.fromCode(
      'INVALID_ARGUMENT_SCHEMA_VIOLATION',
      'invalid propose request arguments',
      { issues: parsed.error.issues },
    );
  }
  return parsed.data;
}

/**
 * 「核」——按 op 派发到 {@link DescriptorManagementOps}。无 consent / confirm 逻辑
 * （进程内 consent 走 Tool 编排、MCP confirm 由门面前置），保持纯净可两面复用。
 * tenant 由调用方解析后传入，绝不取自 `args`。
 */
export async function runDescriptorOp(
  svc: DescriptorManagementOps,
  op: DescriptorOp,
  tenant: number,
  rawArgs: unknown,
  actor?: string,
): Promise<unknown> {
  const args = asRecord(rawArgs);
  switch (op) {
    case 'list':
      return { items: await svc.list(tenant, requireKind(args)) };
    case 'get':
      return svc.get(tenant, requireId(args));
    case 'create':
      return svc.create(
        tenant,
        requireKind(args),
        { name: args['name'], content: args['content'] },
        actor,
      );
    case 'update':
      return svc.update(tenant, requireKind(args), requireId(args), args['content'], actor);
    case 'publish':
      return svc.publish(tenant, requireId(args), actor);
    case 'delete': {
      const id = requireId(args);
      await svc.remove(tenant, id, actor);
      return { deleted: true, id };
    }
    case 'propose':
      return svc.propose(tenant, requireKind(args), parseProposeRequest(args));
  }
}

// ─── op catalog（工具名 / 描述 / inputSchema / consent）──────────────────────

const KIND_PROP = {
  type: 'string',
  enum: ['agent', 'skill', 'rule'],
  description: 'Descriptor kind to manage (tenant agent / skill / rule).',
} as const;

const ID_PROP = {
  type: 'string',
  description: 'Prefixed descriptor id (agt_/skl_/rul_).',
} as const;

const CONTENT_PROP = {
  type: 'object',
  additionalProperties: true,
  description: 'Descriptor content object shaped by the target kind schema.',
} as const;

const CONFIRMED_PROP = {
  type: 'boolean',
  description:
    'MCP server-side draft-safe gating: must be true to run runtime-affecting ops (publish / delete).',
} as const;

export interface ManagementToolDef {
  op: DescriptorOp;
  /** 工具名 = 系统级 descriptor name（= execute 后缀）。 */
  name: string;
  displayName: string;
  description: string;
  /** 进程内面 descriptor 声明的 consent（ADR-0027 §9）。 */
  consent: ConsentMode;
  /** MCP 对外面是否需显式 `confirmed:true`（ADR-0027 §9）。 */
  confirmRequired: boolean;
  idempotent: boolean;
  sideEffects: string[];
  inputProperties: Record<string, unknown>;
  required: string[];
}

const READ = 'read:platform.descriptor';
const WRITE = 'write:platform.descriptor';

/** 「一核」目录：两面（in-process YAML/registry + MCP tools/list）的唯一真源。 */
export const MANAGEMENT_TOOL_DEFS: readonly ManagementToolDef[] = [
  {
    op: 'list',
    name: 'platform.descriptor.list',
    displayName: 'List tenant descriptors',
    description:
      'List the current tenant agent / skill / rule descriptors (read-only). Tenant is taken from the caller context, never from arguments.',
    consent: 'NEVER',
    confirmRequired: false,
    idempotent: true,
    sideEffects: [READ],
    inputProperties: { kind: KIND_PROP },
    required: ['kind'],
  },
  {
    op: 'get',
    name: 'platform.descriptor.get',
    displayName: 'Get a tenant descriptor',
    description: 'Fetch a single tenant descriptor by its prefixed id (read-only).',
    consent: 'NEVER',
    confirmRequired: false,
    idempotent: true,
    sideEffects: [READ],
    inputProperties: { kind: KIND_PROP, id: ID_PROP },
    required: ['id'],
  },
  {
    op: 'create',
    name: 'platform.descriptor.create',
    displayName: 'Create a descriptor draft',
    description:
      'Create a new tenant descriptor. Always produces a DRAFT (not live); publish separately to take effect.',
    consent: 'ON_FIRST_USE',
    confirmRequired: false,
    idempotent: false,
    sideEffects: [WRITE],
    inputProperties: {
      kind: KIND_PROP,
      name: { type: 'string', description: 'Unique descriptor name within the kind.' },
      content: CONTENT_PROP,
    },
    required: ['kind', 'name', 'content'],
  },
  {
    op: 'update',
    name: 'platform.descriptor.update',
    displayName: 'Update a descriptor draft',
    description:
      'Update an existing tenant descriptor. Produces a new DRAFT version; publish separately to take effect.',
    consent: 'ON_FIRST_USE',
    confirmRequired: false,
    idempotent: false,
    sideEffects: [WRITE],
    inputProperties: { kind: KIND_PROP, id: ID_PROP, content: CONTENT_PROP },
    required: ['kind', 'id', 'content'],
  },
  {
    op: 'publish',
    name: 'platform.descriptor.publish',
    displayName: 'Publish a descriptor',
    description:
      'Publish the head version of a tenant descriptor — this affects runtime. In-process: requires consent. Over MCP: requires confirmed:true.',
    consent: 'EACH_CALL',
    confirmRequired: true,
    idempotent: false,
    sideEffects: [WRITE],
    inputProperties: { kind: KIND_PROP, id: ID_PROP, confirmed: CONFIRMED_PROP },
    required: ['id'],
  },
  {
    op: 'delete',
    name: 'platform.descriptor.delete',
    displayName: 'Soft-delete a descriptor',
    description:
      'Soft-delete a tenant descriptor — this affects runtime. In-process: requires consent. Over MCP: requires confirmed:true.',
    consent: 'EACH_CALL',
    confirmRequired: true,
    idempotent: false,
    sideEffects: [WRITE],
    inputProperties: { kind: KIND_PROP, id: ID_PROP, confirmed: CONFIRMED_PROP },
    required: ['id'],
  },
  {
    op: 'propose',
    name: 'platform.descriptor.propose',
    displayName: 'Propose descriptor content',
    description:
      'AI-author a descriptor content candidate (ADR-0027 ①). Pure suggestion, never persisted: returns a ready-to-create content envelope plus grounded ref suggestions.',
    consent: 'NEVER',
    confirmRequired: false,
    idempotent: false,
    sideEffects: [READ],
    inputProperties: {
      kind: KIND_PROP,
      intent: { type: 'string', description: 'Natural-language intent (generate mode).' },
      base: { type: 'object', additionalProperties: true, description: 'Existing content (optimize mode).' },
      focus: { type: 'string', description: 'Optional instruction to focus the change.' },
      modelCode: { type: 'string', description: 'Optional authoring model override.' },
    },
    required: ['kind'],
  },
] as const;

const DEF_BY_OP = new Map<DescriptorOp, ManagementToolDef>(
  MANAGEMENT_TOOL_DEFS.map((d) => [d.op, d] as const),
);
const DEF_BY_NAME = new Map<string, ManagementToolDef>(
  MANAGEMENT_TOOL_DEFS.map((d) => [d.name, d] as const),
);

export function managementToolDefByOp(op: DescriptorOp): ManagementToolDef {
  const def = DEF_BY_OP.get(op);
  if (!def) {
    throw AgenticEngineError.fromCode('INTERNAL_UNKNOWN', `no management tool def for op: ${op}`);
  }
  return def;
}

export function managementToolDefByName(name: string): ManagementToolDef | undefined {
  return DEF_BY_NAME.get(name);
}

/** 全部管理工具名（供 agent 预置 availableTools / 测试断言）。 */
export function managementToolNames(): string[] {
  return MANAGEMENT_TOOL_DEFS.map((d) => d.name);
}

/** execute ref `builtin:platform.descriptor.<op>` → op；非管理 op 返回 null。 */
export function descriptorOpFromExecute(execute: string): DescriptorOp | null {
  const m = /^builtin:platform\.descriptor\.([a-z]+)$/.exec(execute);
  const seg = m?.[1];
  return seg && isDescriptorOp(seg) ? seg : null;
}

function executeRefOf(op: DescriptorOp): string {
  return `builtin:platform.descriptor.${op}`;
}

const OUTPUT_SCHEMA = {
  type: 'object' as const,
  additionalProperties: true,
  properties: {},
};

/** MCP `tools/list` 视图（标准 MCP tool 形态）。 */
export interface McpToolListEntry {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

/** 「核」→ MCP 对外面 tools/list（出站门面，ADR-0027 §8）。 */
export function managementMcpToolList(): McpToolListEntry[] {
  return MANAGEMENT_TOOL_DEFS.map((d) => ({
    name: d.name,
    description: d.description,
    inputSchema: {
      type: 'object' as const,
      properties: d.inputProperties,
      ...(d.required.length > 0 ? { required: d.required } : {}),
    },
  }));
}

/** 「核」→ 进程内面系统级 ToolDescriptor（registry 注册 / availableTools 解析）。 */
export function buildManagementToolDescriptors(): ToolDescriptor[] {
  return MANAGEMENT_TOOL_DEFS.map((d) => {
    const raw = {
      schemaVersion: 1,
      kind: 'TOOL' as const,
      name: d.name,
      displayName: d.displayName,
      description: d.description,
      isPreset: true,
      version: '0.1.0',
      meta: {
        execution: 'LOCAL' as const,
        consent: d.consent,
        requiresPrincipal: 'USER' as const,
        timeoutMs: 120_000,
        idempotent: d.idempotent,
        sideEffects: d.sideEffects,
      },
      inputSchema: {
        type: 'object' as const,
        additionalProperties: false,
        properties: d.inputProperties,
        ...(d.required.length > 0 ? { required: d.required } : {}),
      },
      outputSchema: OUTPUT_SCHEMA,
      requires: { principal: 'USER' as const, oauthScope: [], obo: null },
      execute: executeRefOf(d.op),
      handler: { kind: 'descriptorOps' as const, config: {} },
      category: 'PLATFORM' as const,
      tags: ['descriptor', 'management', 'builtin', 'platform'],
    };
    const parsed = ToolDescriptorSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `management tool descriptor ${d.name} invalid: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  });
}
