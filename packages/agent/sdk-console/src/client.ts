import type { z } from 'zod';
import type {
  AvailableToolView,
  DescriptorListingView,
  DescriptorVersion,
  InstallRequest,
  LibraryItemView,
  PluginCatalogItemView,
  ProposeRequest,
  ProposeResult,
  ShelfEntryView,
  ShelfPatch,
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

export interface ShelfListOptions {
  enabled?: boolean;
  source?: 'authored' | 'ref' | 'copy';
}

export interface LibraryBrowseOptions {
  q?: string;
  tier?: 'tenant' | 'system';
}

/** Plural path segment for each descriptor kind. */
const KIND_PLURAL: Record<TenantDescriptorKind, string> = {
  agent: 'agents',
  skill: 'skills',
  rule: 'rules',
};

type ItemEnvelope<T> = { items: T[] };

function itemsOf<T>(envelope: ItemEnvelope<T>): T[] {
  return envelope.items;
}

function withQuery(path: string, query?: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {}) as Array<[
    string,
    string | number | boolean | undefined,
  ]>) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

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
    return requestJson<ItemEnvelope<TenantDescriptorView>>(this.config, 'GET', `/${plural}`).then(itemsOf);
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

  private listVersions(plural: string, id: string): Promise<DescriptorVersion[]> {
    return requestJson<ItemEnvelope<DescriptorVersion>>(
      this.config,
      'GET',
      `/${plural}/${encodeURIComponent(id)}/versions`,
    ).then(itemsOf);
  }

  private getVersion(plural: string, id: string, versionNo: number): Promise<{ content: unknown }> {
    return requestJson<{ content: unknown }>(
      this.config,
      'GET',
      `/${plural}/${encodeURIComponent(id)}/versions/${encodeURIComponent(String(versionNo))}`,
    );
  }

  private rollback(plural: string, id: string, versionNo: number): Promise<TenantDescriptorView> {
    return requestJson<TenantDescriptorView>(
      this.config,
      'POST',
      `/${plural}/${encodeURIComponent(id)}/rollback`,
      { versionNo },
    );
  }

  private listDescriptor(
    plural: string,
    id: string,
    versionNo: number,
  ): Promise<DescriptorListingView> {
    return requestJson<DescriptorListingView>(
      this.config,
      'POST',
      `/${plural}/${encodeURIComponent(id)}/list`,
      { versionNo },
    );
  }

  private unlistDescriptor(plural: string, id: string): Promise<DescriptorListingView> {
    return requestJson<DescriptorListingView>(
      this.config,
      'POST',
      `/${plural}/${encodeURIComponent(id)}/unlist`,
    );
  }

  private getDescriptorListing(plural: string, id: string): Promise<DescriptorListingView | null> {
    return requestJson<DescriptorListingView | null>(
      this.config,
      'GET',
      `/${plural}/${encodeURIComponent(id)}/listing`,
    );
  }

  private shelfKind(kind: 'agent' | 'skill'): string {
    return KIND_PLURAL[kind];
  }

  private myShelf(kind: 'agent' | 'skill', opts?: ShelfListOptions): Promise<ShelfEntryView[]> {
    return requestJson<ItemEnvelope<ShelfEntryView>>(
      this.config,
      'GET',
      withQuery(`/my/${this.shelfKind(kind)}`, opts),
    ).then(itemsOf);
  }

  private installShelf(kind: 'agent' | 'skill', req: InstallRequest): Promise<ShelfEntryView> {
    return requestJson<ShelfEntryView>(
      this.config,
      'POST',
      `/my/${this.shelfKind(kind)}`,
      req,
    );
  }

  private patchShelf(
    kind: 'agent' | 'skill',
    sheId: string,
    patch: ShelfPatch,
  ): Promise<ShelfEntryView> {
    return requestJson<ShelfEntryView>(
      this.config,
      'PATCH',
      `/my/${this.shelfKind(kind)}/${encodeURIComponent(sheId)}`,
      patch,
    );
  }

  private removeShelf(kind: 'agent' | 'skill', sheId: string): Promise<void> {
    return requestJson<void>(
      this.config,
      'DELETE',
      `/my/${this.shelfKind(kind)}/${encodeURIComponent(sheId)}`,
    );
  }

  private browseLibrary(kind: 'agent' | 'skill', opts?: LibraryBrowseOptions): Promise<LibraryItemView[]> {
    return requestJson<ItemEnvelope<LibraryItemView>>(
      this.config,
      'GET',
      withQuery(`/library/${KIND_PLURAL[kind]}`, opts),
    ).then(itemsOf);
  }

  private getLibrary(kind: 'agent' | 'skill', ref: string): Promise<LibraryItemView> {
    return requestJson<LibraryItemView>(
      this.config,
      'GET',
      `/library/${KIND_PLURAL[kind]}/${encodeURIComponent(ref)}`,
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

  listAgentVersions(id: string): Promise<DescriptorVersion[]> {
    return this.listVersions(KIND_PLURAL.agent, id);
  }

  getAgentVersion(id: string, versionNo: number): Promise<{ content: unknown }> {
    return this.getVersion(KIND_PLURAL.agent, id, versionNo);
  }

  rollbackAgent(id: string, versionNo: number): Promise<TenantDescriptorView> {
    return this.rollback(KIND_PLURAL.agent, id, versionNo);
  }

  listAgent(id: string, versionNo: number): Promise<DescriptorListingView> {
    return this.listDescriptor(KIND_PLURAL.agent, id, versionNo);
  }

  unlistAgent(id: string): Promise<DescriptorListingView> {
    return this.unlistDescriptor(KIND_PLURAL.agent, id);
  }

  getAgentListing(id: string): Promise<DescriptorListingView | null> {
    return this.getDescriptorListing(KIND_PLURAL.agent, id);
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

  listSkillVersions(id: string): Promise<DescriptorVersion[]> {
    return this.listVersions(KIND_PLURAL.skill, id);
  }

  getSkillVersion(id: string, versionNo: number): Promise<{ content: unknown }> {
    return this.getVersion(KIND_PLURAL.skill, id, versionNo);
  }

  rollbackSkill(id: string, versionNo: number): Promise<TenantDescriptorView> {
    return this.rollback(KIND_PLURAL.skill, id, versionNo);
  }

  listSkill(id: string, versionNo: number): Promise<DescriptorListingView> {
    return this.listDescriptor(KIND_PLURAL.skill, id, versionNo);
  }

  unlistSkill(id: string): Promise<DescriptorListingView> {
    return this.unlistDescriptor(KIND_PLURAL.skill, id);
  }

  getSkillListing(id: string): Promise<DescriptorListingView | null> {
    return this.getDescriptorListing(KIND_PLURAL.skill, id);
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

  listRuleVersions(id: string): Promise<DescriptorVersion[]> {
    return this.listVersions(KIND_PLURAL.rule, id);
  }

  getRuleVersion(id: string, versionNo: number): Promise<{ content: unknown }> {
    return this.getVersion(KIND_PLURAL.rule, id, versionNo);
  }

  rollbackRule(id: string, versionNo: number): Promise<TenantDescriptorView> {
    return this.rollback(KIND_PLURAL.rule, id, versionNo);
  }

  // --- my agents / skills shelf ---

  myAgents(opts?: ShelfListOptions): Promise<ShelfEntryView[]> {
    return this.myShelf('agent', opts);
  }

  mySkills(opts?: ShelfListOptions): Promise<ShelfEntryView[]> {
    return this.myShelf('skill', opts);
  }

  installAgent(req: InstallRequest): Promise<ShelfEntryView> {
    return this.installShelf('agent', req);
  }

  installSkill(req: InstallRequest): Promise<ShelfEntryView> {
    return this.installShelf('skill', req);
  }

  patchShelfAgent(sheId: string, patch: ShelfPatch): Promise<ShelfEntryView> {
    return this.patchShelf('agent', sheId, patch);
  }

  patchShelfSkill(sheId: string, patch: ShelfPatch): Promise<ShelfEntryView> {
    return this.patchShelf('skill', sheId, patch);
  }

  removeShelfAgent(sheId: string): Promise<void> {
    return this.removeShelf('agent', sheId);
  }

  removeShelfSkill(sheId: string): Promise<void> {
    return this.removeShelf('skill', sheId);
  }

  // --- library / marketplace ---

  browseLibraryAgents(opts?: LibraryBrowseOptions): Promise<LibraryItemView[]> {
    return this.browseLibrary('agent', opts);
  }

  getLibraryAgent(ref: string): Promise<LibraryItemView> {
    return this.getLibrary('agent', ref);
  }

  browseLibrarySkills(opts?: LibraryBrowseOptions): Promise<LibraryItemView[]> {
    return this.browseLibrary('skill', opts);
  }

  getLibrarySkill(ref: string): Promise<LibraryItemView> {
    return this.getLibrary('skill', ref);
  }

  // --- plugins / available tools ---

  pluginCatalog(): Promise<PluginCatalogItemView[]> {
    return requestJson<ItemEnvelope<PluginCatalogItemView>>(this.config, 'GET', '/plugins').then(itemsOf);
  }

  myTools(): Promise<AvailableToolView[]> {
    return requestJson<ItemEnvelope<AvailableToolView>>(this.config, 'GET', '/my/tools').then(itemsOf);
  }

  installTool(toolName: string): Promise<AvailableToolView> {
    return requestJson<AvailableToolView>(this.config, 'POST', '/my/tools', { toolName });
  }

  patchTool(toolName: string, enabled: boolean): Promise<AvailableToolView> {
    return requestJson<AvailableToolView>(
      this.config,
      'PATCH',
      `/my/tools/${encodeURIComponent(toolName)}`,
      { enabled },
    );
  }

  removeTool(toolName: string): Promise<void> {
    return requestJson<void>(
      this.config,
      'DELETE',
      `/my/tools/${encodeURIComponent(toolName)}`,
    );
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
