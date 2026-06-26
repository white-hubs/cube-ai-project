import type {
  SkillBrowseOptions,
  SkillContentInput,
  SkillDescriptorView,
  SkillInstallRequest,
  SkillLibraryItemView,
  SkillShelfEntryView,
  SkillUpdateCheckResult,
  SkillVersion,
  UserSkillRelation,
} from './types';
import {
  skillConsoleRequestJson as requestJson,
  skillConsoleStreamSse as streamSse,
  type SkillConsoleConfig,
  type SkillConsoleSseEvent,
} from './http';

/** Options for skill propose with SSE streaming. */
export interface SkillProposeOptions {
  onDelta?: (delta: string) => void;
}

/** Skill propose request for AI-assisted creation. */
export interface SkillProposeRequest {
  name: string;
  description: string;
  category: string;
}

/** Skill propose result. */
export interface SkillProposeResult {
  name?: string;
  description?: string;
  category?: string;
  usageExample?: string;
  outputSpec?: string;
  inputReq?: string;
  pitfallGuide?: string;
  checklist?: string;
  reference?: string;
  finished: boolean;
}

type ItemEnvelope<T> = { items: T[] };

function itemsOf<T>(envelope: ItemEnvelope<T>): T[] {
  return envelope.items;
}

function withQuery(path: string, query?: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {}) as Array<[string, string | number | boolean | undefined]>) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

class SkillConsoleClientImpl {
  constructor(private readonly config: SkillConsoleConfig) {}

  // ==================== Skill Library APIs ====================

  /**
   * Browse skills in the library (system and tenant published skills)
   */
  async browseLibrarySkills(opts?: SkillBrowseOptions): Promise<SkillLibraryItemView[]> {
    return requestJson<SkillLibraryItemView[]>(this.config, 'GET', withQuery('/library/skills', opts));
  }

  /**
   * Get a specific skill from the library
   */
  async getLibrarySkill(ref: string): Promise<SkillLibraryItemView> {
    return requestJson<SkillLibraryItemView>(this.config, 'GET', `/library/skills/${encodeURIComponent(ref)}`);
  }

  // ==================== Skill Management APIs ====================

  /**
   * List all skills (tenant level)
   */
  async listSkills(): Promise<SkillDescriptorView[]> {
    return requestJson<ItemEnvelope<SkillDescriptorView>>(this.config, 'GET', '/skills').then(itemsOf);
  }

  /**
   * Get skill details by ID
   */
  async getSkill(id: string): Promise<SkillDescriptorView> {
    return requestJson<SkillDescriptorView>(this.config, 'GET', `/skills/${encodeURIComponent(id)}`);
  }

  /**
   * Create a new skill
   */
  async createSkill(body: SkillContentInput): Promise<SkillDescriptorView> {
    return requestJson<SkillDescriptorView>(this.config, 'POST', '/skills', body);
  }

  /**
   * Update an existing skill
   */
  async updateSkill(id: string, body: Partial<SkillContentInput>): Promise<SkillDescriptorView> {
    return requestJson<SkillDescriptorView>(this.config, 'PUT', `/skills/${encodeURIComponent(id)}`, body);
  }

  /**
   * Delete a skill
   */
  async deleteSkill(id: string): Promise<void> {
    return requestJson<void>(this.config, 'DELETE', `/skills/${encodeURIComponent(id)}`);
  }

  /**
   * Publish a skill to the library
   */
  async publishSkill(id: string): Promise<SkillDescriptorView> {
    return requestJson<SkillDescriptorView>(this.config, 'POST', `/skills/${encodeURIComponent(id)}/publish`);
  }

  /**
   * Unpublish a skill from the library
   */
  async unpublishSkill(id: string): Promise<SkillDescriptorView> {
    return requestJson<SkillDescriptorView>(this.config, 'POST', `/skills/${encodeURIComponent(id)}/unpublish`);
  }

  /**
   * List skill versions
   */
  async listSkillVersions(id: string): Promise<SkillVersion[]> {
    return requestJson<ItemEnvelope<SkillVersion>>(
      this.config,
      'GET',
      `/skills/${encodeURIComponent(id)}/versions`,
    ).then(itemsOf);
  }

  // ==================== My Skills (Shelf) APIs ====================

  /**
   * List my skills (shelf entries)
   */
  async listMySkills(): Promise<SkillShelfEntryView[]> {
    return requestJson<ItemEnvelope<SkillShelfEntryView>>(this.config, 'GET', '/my/skills').then(itemsOf);
  }

  /**
   * Add a skill to my shelf
   */
  async addToMySkills(req: SkillInstallRequest): Promise<SkillShelfEntryView> {
    return requestJson<SkillShelfEntryView>(this.config, 'POST', '/my/skills', req);
  }

  /**
   * Remove a skill from my shelf
   */
  async removeFromMySkills(shelfId: string): Promise<void> {
    return requestJson<void>(this.config, 'DELETE', `/my/skills/${encodeURIComponent(shelfId)}`);
  }

  /**
   * Enable/disable a skill in my shelf
   */
  async toggleSkillEnabled(shelfId: string, enabled: boolean): Promise<SkillShelfEntryView> {
    return requestJson<SkillShelfEntryView>(this.config, 'PATCH', `/my/skills/${encodeURIComponent(shelfId)}`, {
      enabled,
    });
  }

  /**
   * Update skill version in my shelf (sync to latest)
   */
  async syncSkillVersion(shelfId: string, versionNo?: number): Promise<SkillShelfEntryView> {
    return requestJson<SkillShelfEntryView>(this.config, 'POST', `/my/skills/${encodeURIComponent(shelfId)}/sync`, {
      versionNo,
    });
  }

  /**
   * Check if a skill in my shelf has updates available
   */
  async checkSkillUpdate(shelfId: string): Promise<SkillUpdateCheckResult> {
    return requestJson<SkillUpdateCheckResult>(
      this.config,
      'GET',
      `/my/skills/${encodeURIComponent(shelfId)}/check-update`,
    );
  }

  // ==================== AI-Assisted Creation ====================

  /**
   * Propose skill content using AI (with SSE streaming)
   * This generates the six configurations based on name and description.
   */
  async proposeSkill(
    req: SkillProposeRequest,
    opts?: SkillProposeOptions,
  ): Promise<SkillProposeResult> {
    const result: SkillProposeResult = { finished: false };

    if (!opts?.onDelta) {
      // Non-streaming fallback
      const response = await requestJson<SkillProposeResult>(this.config, 'POST', '/skills/propose', req);
      return response;
    }

    // SSE streaming
    await streamSse(this.config, 'POST', '/skills/propose', req, (event) => {
      if (event.event === 'delta') {
        opts.onDelta?.(event.data);
      } else if (event.event === 'result') {
        try {
          const parsed = JSON.parse(event.data) as SkillProposeResult;
          Object.assign(result, parsed);
        } catch {
          // Ignore invalid JSON
        }
      }
    });

    result.finished = true;
    return result;
  }
}

// Export the client class
export { SkillConsoleClientImpl };
