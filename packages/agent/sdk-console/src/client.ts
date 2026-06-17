import type { z } from 'zod';
import type {
  ProposeRequest,
  ProposeResult,
  TenantAgentContentSchema,
  TenantDescriptorKind,
  TenantDescriptorStatus,
  TenantDescriptorView,
  TenantRuleContentSchema,
  TenantSkillContentSchema,
} from '@cube-ai/contracts';
import {
  agentConsoleRequestJson as requestJson,
  agentConsoleRequestText as requestText,
  agentConsoleStreamSse as streamSse,
  type AgentConsoleConfig,
} from './http';

/** Options for {@link AgentConsoleClient.propose} (ADR-0027 §5 SSE). */
export interface ProposeOptions {
  /** Called with each streamed prose token delta (the generated prompt/instructions text). */
  onDelta?: (delta: string) => void;
}

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

class AgentConsoleClientImpl {
  constructor(private readonly config: AgentConsoleConfig) {}

  // --- generic CRUD over a plural kind segment ---

  private create<C>(plural: string, body: C): Promise<TenantDescriptorView> {
    return requestJson<TenantDescriptorView>(
      this.config,
      'POST',
      `/${plural}`,
      body,
    );
  }

  private list(plural: string): Promise<TenantDescriptorView[]> {
    return requestJson<TenantDescriptorView[]>(this.config, 'GET', `/${plural}`);
  }

  private get(plural: string, id: string): Promise<TenantDescriptorView> {
    return requestJson<TenantDescriptorView>(
      this.config,
      'GET',
      `/${plural}/${encodeURIComponent(id)}`,
    );
  }

  private update<C>(plural: string, id: string, body: C): Promise<TenantDescriptorView> {
    return requestJson<TenantDescriptorView>(
      this.config,
      'PATCH',
      `/${plural}/${encodeURIComponent(id)}`,
      body,
    );
  }

  private remove(plural: string, id: string): Promise<void> {
    return requestJson<void>(
      this.config,
      'DELETE',
      `/${plural}/${encodeURIComponent(id)}`,
    );
  }

  private publish(plural: string, id: string): Promise<TenantDescriptorView> {
    return requestJson<TenantDescriptorView>(
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

  // --- propose (AI authoring assistance, ADR-0027 ①) ---

  /**
   * `POST /{plural}:propose` — pure-suggestion authoring (ADR-0027). Consumes the SSE
   * stream: forwards prose token deltas to `opts.onDelta` and resolves to the terminal
   * `proposal` envelope ({@link ProposeResult}).
   */
  async propose(
    kind: TenantDescriptorKind,
    req: ProposeRequest,
    opts: ProposeOptions = {},
  ): Promise<ProposeResult> {
    const plural = KIND_PLURAL[kind];
    let result: ProposeResult | undefined;
    let streamError: string | undefined;
    await streamSse(this.config, 'POST', `/${plural}:propose`, req, (ev) => {
      if (ev.event === 'delta') {
        if (opts.onDelta) {
          const parsed = JSON.parse(ev.data) as { delta?: unknown };
          if (typeof parsed.delta === 'string') opts.onDelta(parsed.delta);
        }
      } else if (ev.event === 'proposal') {
        result = JSON.parse(ev.data) as ProposeResult;
      } else if (ev.event === 'error') {
        const parsed = JSON.parse(ev.data) as { message?: unknown };
        streamError = typeof parsed.message === 'string' ? parsed.message : 'unknown error';
      }
    });
    if (streamError !== undefined) {
      throw new Error(`agent-sdk-console propose: ${streamError}`);
    }
    if (!result) {
      throw new Error('agent-sdk-console propose: stream ended without a proposal event');
    }
    return result;
  }

  // --- document ingest ---

  /**
   * POST the raw document text (text/plain) to `/{prefix}/{plural}:fromDocument`.
   * The colon is a literal part of the path, not a route param.
   */
  createFromDocument(kind: TenantDescriptorKind, raw: string): Promise<FromDocumentResult> {
    const plural = KIND_PLURAL[kind];
    return requestText<FromDocumentResult>(
      this.config,
      'POST',
      `/${plural}:fromDocument`,
      raw,
    );
  }
}

export function createAgentConsoleClient(config: AgentConsoleConfig): AgentConsoleClientImpl {
  return new AgentConsoleClientImpl(config);
}

export { AgentConsoleClientImpl as AgentConsoleClient };
