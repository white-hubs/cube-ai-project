import { type Job, JobSchema } from "@cube-ai/contracts";

import { type AgenticClient, type AgenticClientConfig } from "./client";

/**
 * Jobs API for long-running tool management.
 * Ref: docs/detailed-design/08-sdk/sdk-core.md §2.2
 */
export class JobsApi {
  constructor(
    _config: AgenticClientConfig,
    private readonly client: AgenticClient,
  ) {}

  async get(jobId: string): Promise<Job> {
    const raw = await this.client.requestJson<unknown>({
      method: "GET",
      path: `/jobs/${jobId}`,
    });
    return JobSchema.parse(raw);
  }

  async cancel(jobId: string, opts?: { reason?: string }): Promise<void> {
    await this.client.requestJson({
      body: opts?.reason ? { reason: opts.reason } : {},
      method: "POST",
      path: `/jobs/${jobId}:cancel`,
    });
  }
}
