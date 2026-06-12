import type { z } from 'zod';
import type {
  TenantAgentContentSchema,
  TenantDescriptorKind,
  TenantDescriptorStatus,
  TenantDescriptorView,
  TenantRuleContentSchema,
  TenantSkillContentSchema,
} from '@cube-ai/contracts';
import {
  agentConsoleRequestJson,
  agentConsoleRequestText,
  type AgentConsoleConfig,
} from './http';

/**
 * Create/update bodies use the schema *input* shape (defaults like `ruleRefs` are optional);
 * the server applies defaults and returns the resolved `TenantDescriptorView`.
 */
export type AgentContentInput = z.input<typeof TenantAgentContentSchema>;
export type SkillContentInput = z.input<typeof TenantSkillContentSchema>;
export type RuleContentInput = z.input<typeof TenantRuleContentSchema>;

/** Plural path segment for each descriptor kind. */
const KIND_PLURAL: Record<TenantDescriptorKind, string> = {
  agent: 'agents',
  skill: 'skills',
  rule: 'rules',
};

/** Result of a `:fromDocument` ingest. */
export interface FromDocumentResult {
  id: string;
  name: string;
  action: string;
  headVersionNo: number;
  status: TenantDescriptorStatus;
}

export class AgentConsoleClient {
  constructor(private readonly config: AgentConsoleConfig) {}

  // --- generic CRUD over a plural kind segment ---

  private create<C>(plural: string, body: C): Promise<TenantDescriptorView> {
    return agentConsoleRequestJson<TenantDescriptorView>(
      this.config,
      'POST',
      `/${plural}`,
      body,
    );
  }

  private list(plural: string): Promise<TenantDescriptorView[]> {
    return agentConsoleRequestJson<TenantDescriptorView[]>(this.config, 'GET', `/${plural}`);
  }

  private get(plural: string, id: string): Promise<TenantDescriptorView> {
    return agentConsoleRequestJson<TenantDescriptorView>(
      this.config,
      'GET',
      `/${plural}/${encodeURIComponent(id)}`,
    );
  }

  private update<C>(plural: string, id: string, body: C): Promise<TenantDescriptorView> {
    return agentConsoleRequestJson<TenantDescriptorView>(
      this.config,
      'PATCH',
      `/${plural}/${encodeURIComponent(id)}`,
      body,
    );
  }

  private remove(plural: string, id: string): Promise<void> {
    return agentConsoleRequestJson<void>(
      this.config,
      'DELETE',
      `/${plural}/${encodeURIComponent(id)}`,
    );
  }

  private publish(plural: string, id: string): Promise<TenantDescriptorView> {
    return agentConsoleRequestJson<TenantDescriptorView>(
      this.config,
      'POST',
      `/${plural}/${encodeURIComponent(id)}/publish`,
    );
  }

  // --- agents ---

  createAgent(body: AgentContentInput): Promise<TenantDescriptorView> {
    return this.create(KIND_PLURAL.agent, body);
  }

  listAgents(): Promise<TenantDescriptorView[]> {
    return this.list(KIND_PLURAL.agent);
  }

  getAgent(id: string): Promise<TenantDescriptorView> {
    return this.get(KIND_PLURAL.agent, id);
  }

  updateAgent(id: string, body: AgentContentInput): Promise<TenantDescriptorView> {
    return this.update(KIND_PLURAL.agent, id, body);
  }

  deleteAgent(id: string): Promise<void> {
    return this.remove(KIND_PLURAL.agent, id);
  }

  publishAgent(id: string): Promise<TenantDescriptorView> {
    return this.publish(KIND_PLURAL.agent, id);
  }

  // --- skills ---

  createSkill(body: SkillContentInput): Promise<TenantDescriptorView> {
    return this.create(KIND_PLURAL.skill, body);
  }

  listSkills(): Promise<TenantDescriptorView[]> {
    return this.list(KIND_PLURAL.skill);
  }

  getSkill(id: string): Promise<TenantDescriptorView> {
    return this.get(KIND_PLURAL.skill, id);
  }

  updateSkill(id: string, body: SkillContentInput): Promise<TenantDescriptorView> {
    return this.update(KIND_PLURAL.skill, id, body);
  }

  deleteSkill(id: string): Promise<void> {
    return this.remove(KIND_PLURAL.skill, id);
  }

  publishSkill(id: string): Promise<TenantDescriptorView> {
    return this.publish(KIND_PLURAL.skill, id);
  }

  // --- rules ---

  createRule(body: RuleContentInput): Promise<TenantDescriptorView> {
    return this.create(KIND_PLURAL.rule, body);
  }

  listRules(): Promise<TenantDescriptorView[]> {
    return this.list(KIND_PLURAL.rule);
  }

  getRule(id: string): Promise<TenantDescriptorView> {
    return this.get(KIND_PLURAL.rule, id);
  }

  updateRule(id: string, body: RuleContentInput): Promise<TenantDescriptorView> {
    return this.update(KIND_PLURAL.rule, id, body);
  }

  deleteRule(id: string): Promise<void> {
    return this.remove(KIND_PLURAL.rule, id);
  }

  publishRule(id: string): Promise<TenantDescriptorView> {
    return this.publish(KIND_PLURAL.rule, id);
  }

  // --- document ingest ---

  /**
   * POST the raw document text (text/plain) to `/{prefix}/{plural}:fromDocument`.
   * The colon is a literal part of the path, not a route param.
   */
  createFromDocument(kind: TenantDescriptorKind, raw: string): Promise<FromDocumentResult> {
    const plural = KIND_PLURAL[kind];
    return agentConsoleRequestText<FromDocumentResult>(
      this.config,
      'POST',
      `/${plural}:fromDocument`,
      raw,
    );
  }
}

export function createAgentConsoleClient(config: AgentConsoleConfig): AgentConsoleClient {
  return new AgentConsoleClient(config);
}
