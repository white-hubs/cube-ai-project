/**
 * DescriptorManagementService —— 租户 descriptor 管理面用例编排（ADR-0016 §1/§4/§6, ADR-0018）。
 *
 * 薄编排层：内容按 kind schema 校验 → 委托 {@link TenantDescriptorRepository} 落库（draft）。
 * `:fromDocument` 走 DescriptorDocumentParser（ADR-0018 §5）再 upsert。
 * tenant 始终由 controller 从请求上下文显式传入（不嵌 id，ADR-0012 addendum）。
 */
import { Injectable } from '@dangao/bun-server';
import {
  TenantAgentContentSchema,
  TenantRuleContentSchema,
  TenantSkillContentSchema,
  type TenantDescriptorKind,
  type TenantDescriptorView,
  type FromDocumentResult,
} from '@cube-ai/contracts';
import type { ZodType } from 'zod';
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import {
  parseAgentDocument,
  parseRuleDocument,
  parseSkillDocument,
} from './descriptor-document-parser';
import type { TenantDescriptorRepository, UpsertDescriptorResult } from './tenant-descriptor.repository';

const CONTENT_SCHEMA: Record<TenantDescriptorKind, ZodType> = {
  agent: TenantAgentContentSchema,
  skill: TenantSkillContentSchema,
  rule: TenantRuleContentSchema,
};

function parseDocument(
  kind: TenantDescriptorKind,
  raw: string,
): { name: string; content: unknown } {
  switch (kind) {
    case 'agent':
      return parseAgentDocument(raw);
    case 'skill':
      return parseSkillDocument(raw);
    case 'rule':
      return parseRuleDocument(raw);
  }
}

@Injectable()
export class DescriptorManagementService {
  constructor(private readonly repo: TenantDescriptorRepository) {}

  private validateContent(kind: TenantDescriptorKind, content: unknown): unknown {
    const res = CONTENT_SCHEMA[kind].safeParse(content);
    if (!res.success) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_DESCRIPTOR_CONTENT',
        `Invalid ${kind} descriptor content: ${res.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
        { kind },
      );
    }
    return res.data;
  }

  async create(
    tenant: number,
    kind: TenantDescriptorKind,
    body: { name?: unknown; content?: unknown },
    actor?: string,
  ): Promise<TenantDescriptorView> {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_DESCRIPTOR_NAME',
        'Descriptor name is required',
        { kind },
      );
    }
    const content = this.validateContent(kind, body.content);
    const { id } = await this.repo.upsert(tenant, kind, name, content, actor);
    const view = await this.repo.findById(tenant, id);
    if (!view) {
      throw AgenticEngineError.fromCode('INTERNAL_UNKNOWN', 'Descriptor not visible after create', { id });
    }
    return view;
  }

  async update(
    tenant: number,
    kind: TenantDescriptorKind,
    id: string,
    content: unknown,
    actor?: string,
  ): Promise<TenantDescriptorView> {
    const existing = await this.repo.findById(tenant, id);
    if (!existing) {
      throw AgenticEngineError.fromCode('RESOURCE_NOT_FOUND_DESCRIPTOR', `Descriptor not found: ${id}`, { id });
    }
    const validated = this.validateContent(kind, content);
    await this.repo.upsert(tenant, kind, existing.name, validated, actor);
    const view = await this.repo.findById(tenant, id);
    if (!view) {
      throw AgenticEngineError.fromCode('INTERNAL_UNKNOWN', 'Descriptor not visible after update', { id });
    }
    return view;
  }

  list(tenant: number, kind: TenantDescriptorKind): Promise<TenantDescriptorView[]> {
    return this.repo.list(tenant, kind);
  }

  async get(tenant: number, id: string): Promise<TenantDescriptorView> {
    const view = await this.repo.findById(tenant, id);
    if (!view) {
      throw AgenticEngineError.fromCode('RESOURCE_NOT_FOUND_DESCRIPTOR', `Descriptor not found: ${id}`, { id });
    }
    return view;
  }

  publish(tenant: number, id: string, actor?: string): Promise<TenantDescriptorView> {
    return this.repo.publish(tenant, id, actor);
  }

  remove(tenant: number, id: string, actor?: string): Promise<void> {
    return this.repo.softDelete(tenant, id, actor);
  }

  /** ADR-0018：text/plain 文档 → parse → upsert（结果恒为 draft）。 */
  async fromDocument(
    tenant: number,
    kind: TenantDescriptorKind,
    raw: string,
    actor?: string,
  ): Promise<FromDocumentResult> {
    let parsed: { name: string; content: unknown };
    try {
      parsed = parseDocument(kind, raw);
    } catch (e) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_DESCRIPTOR_DOCUMENT',
        `Invalid ${kind} descriptor document: ${e instanceof Error ? e.message : String(e)}`,
        { kind },
      );
    }
    const res: UpsertDescriptorResult = await this.repo.upsert(
      tenant,
      kind,
      parsed.name,
      parsed.content,
      actor,
    );
    return res;
  }
}
