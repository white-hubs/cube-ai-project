import { BadRequestException, HttpException, Inject, Injectable, NotFoundException } from "@dangao/bun-server";

import { SnowflakeUtil } from "@cube-ai/ai-center/platform/server-base";
import { currentTenantId, isGlobalAccessEnabled } from "@cube-ai/tenant-context";

import { buildCubeComponentSchemaFromDslPayload } from "../custom-component/dsl-to-cube-schema";
import { FLOW_REPOSITORY_TOKEN, type FlowRepository } from "../db/repository-contracts";

const MAX_DSL_JSON_BYTES = 512 * 1024;

@Injectable()
export class CustomComponentTemplatesService {
  private readonly repo: FlowRepository;

  constructor(@Inject(FLOW_REPOSITORY_TOKEN) repo: FlowRepository) {
    this.repo = repo;
  }

  private requireProjectId(): string {
    const p = currentTenantId() ?? "";
    if (!p) {
      throw new HttpException(400, "missing tenant context", { code: "TENANT_REQUIRED" });
    }
    return p;
  }

  async list() {
    const tenantId = isGlobalAccessEnabled() ? null : this.requireProjectId();
    return (await this.repo.listCustomComponentTemplates(tenantId)).map((r) => ({
      displayName: r.display_name,
      dsl: JSON.parse(r.dsl_json) as unknown,
      id: r.id,
      update_time: r.update_time,
    }));
  }

  async get(id: string) {
    const row = await this.repo.getCustomComponentTemplate(id, isGlobalAccessEnabled() ? null : this.requireProjectId());
    if (!row) {
      throw new NotFoundException("template not found");
    }
    return {
      displayName: row.display_name,
      dsl: JSON.parse(row.dsl_json) as unknown,
      id: row.id,
      update_time: row.update_time,
    };
  }

  validateDsl(raw: unknown) {
    buildCubeComponentSchemaFromDslPayload(raw);
    return { ok: true as const };
  }

  async create(body: { dsl: unknown; displayName?: string }) {
    const parsed = this.normalizeIncomingDsl(body.dsl);
    const schema = buildCubeComponentSchemaFromDslPayload(parsed);
    const displayName = (body.displayName?.trim() || schema.displayName).trim() || schema.displayName;
    const id = SnowflakeUtil.nextId();
    await this.repo.insertCustomComponentTemplate(this.requireProjectId(), {
      display_name: displayName,
      dsl_json: JSON.stringify(parsed),
      id,
    });
    return { displayName, dsl: parsed, id };
  }

  async update(id: string, body: { dsl?: unknown; displayName?: string }) {
    const row = await this.repo.getCustomComponentTemplate(id, this.requireProjectId());
    if (!row) {
      throw new NotFoundException("template not found");
    }

    let dslJson = row.dsl_json;
    let displayName = row.display_name;

    if (body.dsl !== undefined) {
      const parsed = this.normalizeIncomingDsl(body.dsl);
      buildCubeComponentSchemaFromDslPayload(parsed);
      dslJson = JSON.stringify(parsed);
    }
    if (body.displayName !== undefined) {
      const d = body.displayName.trim();
      if (d) {
        displayName = d;
      }
    }
    await this.repo.updateCustomComponentTemplate(this.requireProjectId(), id, {
      display_name: displayName,
      dsl_json: dslJson,
    });
    return this.get(id);
  }

  async remove(id: string) {
    const pid = this.requireProjectId();
    const row = await this.repo.getCustomComponentTemplate(id, pid);
    if (!row) {
      throw new NotFoundException("template not found");
    }
    await this.repo.deleteCustomComponentTemplate(pid, id);
    return { ok: true as const };
  }

  private normalizeIncomingDsl(dsl: unknown): unknown {
    const str = typeof dsl === "string" ? dsl : JSON.stringify(dsl);
    if (Buffer.byteLength(str, "utf8") > MAX_DSL_JSON_BYTES) {
      throw new BadRequestException(`dsl exceeds max size (${MAX_DSL_JSON_BYTES} bytes)`);
    }
    if (typeof dsl === "string") {
      try {
        return JSON.parse(dsl) as unknown;
      } catch {
        throw new BadRequestException("Invalid JSON in dsl");
      }
    }
    return dsl;
  }
}
