import { type GrantResponseRequest, GrantResponseRequestSchema } from "@cube-ai/contracts";

import { type AgenticClient, type AgenticClientConfig } from "./client";

/**
 * Grants API methods.
 * Ref: docs/detailed-design/08-sdk/sdk-core.md §8.2 / P3-15 §3.5
 */
export class GrantsApi {
  constructor(
    _config: AgenticClientConfig,
    private readonly client: AgenticClient,
  ) {}

  async respond(req: GrantResponseRequest): Promise<void> {
    const validated = GrantResponseRequestSchema.parse(req);
    await this.client.requestJson({
      body: validated,
      method: "POST",
      path: "/grants/responses",
    });
  }

  async approve(
    grantRequestId: string,
    scopeChoice?: GrantResponseRequest["scopeChoice"],
    extras?: Pick<GrantResponseRequest, "rememberTtlSeconds" | "note">,
  ): Promise<void> {
    return this.respond({
      decision: "APPROVE",
      grantRequestId,
      note: extras?.note,
      rememberTtlSeconds: extras?.rememberTtlSeconds,
      scopeChoice,
    });
  }

  async deny(grantRequestId: string, reason?: string): Promise<void> {
    return this.respond({
      decision: "DENY",
      grantRequestId,
      note: reason,
    });
  }
}
